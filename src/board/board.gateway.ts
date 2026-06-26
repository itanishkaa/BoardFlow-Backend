import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type PersistedElement = {
  points?: string | null;
};

@WebSocketGateway(3000, {
  cors: {
    origin: '*',
  },
})
export class BoardGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(BoardGateway.name);
  private readonly boardPresence = new Map<string, Map<string, string>>();
  private readonly presenceWatchers = new Map<string, Set<string>>();

  constructor(private readonly prisma: PrismaService) {}

  private getBoardUsers(boardId: string) {
    return Array.from(this.boardPresence.get(boardId)?.values() || []);
  }

  private emitPresenceForBoard(boardId: string) {
    const users = this.getBoardUsers(boardId);

    this.server.to(boardId).emit('ACTIVE_USERS_UPDATED', {
      boardId,
      users,
      onlineCount: users.length,
    });

    this.presenceWatchers.forEach((boardIds, socketId) => {
      if (boardIds.has(boardId)) {
        this.server.to(socketId).emit('PRESENCE_SUMMARY', {
          boardId,
          users,
          onlineCount: users.length,
        });
      }
    });
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);

    const rooms = Array.from(client.rooms);
    rooms.forEach((roomId) => {
      if (roomId !== client.id) {
        this.boardPresence.get(roomId)?.delete(client.id);
        client.to(roomId).emit('CURSOR_REMOVED_REMOTE', { userId: client.id });
        client
          .to(roomId)
          .emit('DRAWING_PREVIEW_REMOTE', { userId: client.id, element: null });
        client.to(roomId).emit('TYPING_STATUS_REMOTE', {
          userId: client.id,
          isTyping: false,
          text: '',
        });
        this.emitPresenceForBoard(roomId);
      }
    });

    this.presenceWatchers.delete(client.id);
  }

  // 1. Inside your room connection/initialization block (where elements are loaded):
  @SubscribeMessage('JOIN_BOARD')
  async handleJoinBoard(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { boardId: string; username?: string },
  ) {
    const { boardId, username } = data;
    client.join(boardId);
    if (!this.boardPresence.has(boardId)) {
      this.boardPresence.set(boardId, new Map());
    }
    this.boardPresence
      .get(boardId)
      ?.set(client.id, username?.trim() || `Guest ${client.id.slice(0, 4)}`);
    this.emitPresenceForBoard(boardId);

    // 🔍 Find the board, or upsert/create it if it doesn't exist yet
    let board = await this.prisma.client.board.findUnique({
      where: { id: boardId },
      include: { elements: true },
    });

    if (!board) {
      board = await this.prisma.client.board.create({
        data: { id: boardId, name: `Workspace Layout (${boardId})` },
        include: { elements: true },
      });
    }

    // Parse points arrays for freehand shapes before sending down
    const parsedElements = board.elements.map((el) => ({
      ...el,
      points: el.points ? JSON.parse(el.points) : undefined,
    }));

    // Send BOTH elements and the persistent database name back to the client
    client.emit('BOARD_LOADED', {
      elements: parsedElements,
      boardName: board.name,
    });

    client.to(boardId).emit('BOARD_STATE_REQUEST', {
      requesterId: client.id,
    });
  }

  @SubscribeMessage('WATCH_BOARD_PRESENCE')
  handleWatchBoardPresence(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { boardIds: string[] },
  ) {
    const boardIds = new Set(data.boardIds);
    this.presenceWatchers.set(client.id, boardIds);

    boardIds.forEach((boardId) => {
      client.emit('PRESENCE_SUMMARY', {
        boardId,
        users: this.getBoardUsers(boardId),
        onlineCount: this.getBoardUsers(boardId).length,
      });
    });
  }

  // 2. 📝 NEW: Add a dedicated broadcast listener for real-time renames
  @SubscribeMessage('BOARD_RENAME')
  async handleBoardRename(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { boardId: string; name: string },
  ) {
    const { boardId, name } = data;
    try {
      // Save to SQLite persistently
      await this.prisma.client.board.update({
        where: { id: boardId },
        data: { name },
      });

      // Broadcast the name change to everyone else in the room in real time
      client.to(boardId).emit('BOARD_RENAMED_REMOTE', { name });
    } catch (error) {
      this.logger.error(`Failed to persist board rename workflow:`, error);
    }
  }

  @SubscribeMessage('ELEMENT_CREATE')
  async handleElementCreate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { boardId: string; element: any },
  ) {
    const { boardId, element } = data;

    try {
      await this.prisma.client.element.create({
        data: {
          id: element.id,
          boardId: boardId,
          type: element.type,
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          strokeColor: element.strokeColor,
          strokeWidth: element.strokeWidth,
          fillColor: element.fillColor || null,
          text: element.text || null,
          points: element.points ? JSON.stringify(element.points) : null,
        },
      });

      client.to(boardId).emit('ELEMENT_CREATED_REMOTE', element);
      client.to(boardId).emit('DRAWING_PREVIEW_REMOTE', {
        userId: client.id,
        element: null,
      });
    } catch (error) {
      this.logger.error(`Failed to persist element creation to DB:`, error);
    }
  }

  @SubscribeMessage('DRAWING_PREVIEW')
  handleDrawingPreview(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { boardId: string; element: any | null },
  ) {
    client.to(data.boardId).emit('DRAWING_PREVIEW_REMOTE', {
      userId: client.id,
      element: data.element,
    });
  }

  @SubscribeMessage('TYPING_STATUS')
  handleTypingStatus(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      boardId: string;
      worldX: number;
      worldY: number;
      isTyping: boolean;
      text: string;
    },
  ) {
    client.to(data.boardId).emit('TYPING_STATUS_REMOTE', {
      userId: client.id,
      worldX: data.worldX,
      worldY: data.worldY,
      isTyping: data.isTyping,
      text: data.text,
    });
  }

  @SubscribeMessage('BOARD_CLEAR')
  async handleBoardClear(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { boardId: string },
  ) {
    const { boardId } = data;
    try {
      await this.prisma.client.element.deleteMany({
        where: { boardId: boardId },
      });

      client.to(boardId).emit('BOARD_CLEARED_REMOTE');
      this.logger.log(
        `Board ${boardId} wiped successfully by client ${client.id}`,
      );
    } catch (error) {
      this.logger.error(`Failed to execute canvas drop sequence:`, error);
    }
  }

  @SubscribeMessage('CURSOR_MOVE')
  handleCursorMove(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { boardId: string; x: number; y: number },
  ) {
    client.to(data.boardId).emit('CURSOR_UPDATED_REMOTE', {
      userId: client.id,
      x: data.x,
      y: data.y,
    });
  }

  @SubscribeMessage('CURSOR_LEAVE')
  handleCursorLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { boardId: string },
  ) {
    client
      .to(data.boardId)
      .emit('CURSOR_REMOVED_REMOTE', { userId: client.id });
  }

  @SubscribeMessage('ELEMENT_UPDATE')
  async handleElementUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { boardId: string; element: any },
  ) {
    const { boardId, element } = data;
    try {
      await this.prisma.client.element.update({
        where: { id: element.id },
        data: {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          strokeColor:
            element.strokeColor !== undefined ? element.strokeColor : undefined,
          strokeWidth:
            element.strokeWidth !== undefined ? element.strokeWidth : undefined,
          fillColor:
            element.fillColor !== undefined ? element.fillColor : undefined,
          text: element.text !== undefined ? element.text : undefined,
          points: element.points ? JSON.stringify(element.points) : undefined,
        },
      });

      client.to(boardId).emit('ELEMENT_UPDATED_REMOTE', element);
    } catch (error) {
      this.logger.error(
        `Failed to execute element alignment translation update:`,
        error,
      );
    }
  }

  @SubscribeMessage('ELEMENT_DELETE')
  async handleElementDelete(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { boardId: string; elementId: string },
  ) {
    const { boardId, elementId } = data;
    try {
      await this.prisma.client.element.delete({
        where: { id: elementId },
      });

      client.to(boardId).emit('ELEMENT_DELETED_REMOTE', elementId);
    } catch (error) {
      this.logger.error(
        `Failed to execute asset database eviction for ID ${elementId}:`,
        error,
      );
    }
  }

  @SubscribeMessage('BOARD_REPLACE_ALL')
  async handleBoardReplaceAll(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { boardId: string; elements: any[] },
  ) {
    const { boardId, elements } = data;

    // Wipe current board contents in DB
    await this.prisma.client.element.deleteMany({ where: { boardId } });

    // Re-insert history snapshot elements
    if (elements.length > 0) {
      const now = new Date();
      await this.prisma.client.element.createMany({
        data: elements.map((el) => ({
          id: el.id,
          boardId: boardId,
          type: el.type,
          x: el.x,
          y: el.y,
          width: el.width,
          height: el.height,
          strokeColor: el.strokeColor,
          strokeWidth: el.strokeWidth,
          fillColor: el.fillColor,
          text: el.text,
          points: el.points ? JSON.stringify(el.points) : null,
          createdAt: now,
          updatedAt: now,
        })),
      });
    }

    // Notify other collaborators to replace their local view completely
    client.to(boardId).emit('BOARD_LOADED', { elements, boardName: undefined });
  }

  @SubscribeMessage('BOARD_STATE_RESPONSE')
  async handleBoardStateResponse(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      boardId: string;
      requesterId: string;
      elements: any[];
      boardName?: string;
    },
  ) {
    client.to(data.requesterId).emit('BOARD_STATE_RESPONSE', {
      elements: data.elements,
      boardName: data.boardName,
    });

    try {
      await this.prisma.client.element.deleteMany({
        where: { boardId: data.boardId },
      });

      if (data.elements.length > 0) {
        const now = new Date();
        await this.prisma.client.element.createMany({
          data: data.elements.map((el) => ({
            id: el.id,
            boardId: data.boardId,
            type: el.type,
            x: el.x,
            y: el.y,
            width: el.width,
            height: el.height,
            strokeColor: el.strokeColor,
            strokeWidth: el.strokeWidth,
            fillColor: el.fillColor,
            text: el.text,
            points: el.points ? JSON.stringify(el.points) : null,
            createdAt: now,
            updatedAt: now,
          })),
        });
      }
    } catch (error) {
      this.logger.error('Failed to persist peer board state response:', error);
    }
  }
}
