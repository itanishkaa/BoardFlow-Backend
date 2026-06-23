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

  constructor(private readonly prisma: PrismaService) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    
    const rooms = Array.from(client.rooms);
    rooms.forEach((roomId) => {
      if (roomId !== client.id) {
        client.to(roomId).emit('CURSOR_REMOVED_REMOTE', { userId: client.id });
        client.to(roomId).emit('DRAWING_PREVIEW_REMOTE', { userId: client.id, element: null });
        client.to(roomId).emit('TYPING_STATUS_REMOTE', { userId: client.id, isTyping: false, text: '' });
      }
    });
  }

  @SubscribeMessage('JOIN_BOARD')
  async handleJoinBoard(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { boardId: string },
  ) {
    const { boardId } = data;
    client.join(boardId);
    this.logger.log(`User ${client.id} joining room: ${boardId}`);

    try {
      const board = await this.prisma.client.board.upsert({
        where: { id: boardId },
        update: {},
        create: {
          id: boardId,
          name: `Workspace Space - ${boardId}`,
        },
        include: {
          elements: true,
        },
      });

      const parsedElements = board.elements.map((el: typeof board.elements[number] & PersistedElement) => ({
        ...el,
        points: el.points ? JSON.parse(el.points) : undefined,
      }));

      client.emit('LOAD_BOARD_ELEMENTS', parsedElements);
      this.logger.log(`Sent ${parsedElements.length} historical elements to client ${client.id}`);
    } catch (error) {
      this.logger.error(`Failed to seed or sync board room state updates:`, error);
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
    @MessageBody() data: { boardId: string; worldX: number; worldY: number; isTyping: boolean; text: string },
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
      this.logger.log(`Board ${boardId} wiped successfully by client ${client.id}`);
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
    client.to(data.boardId).emit('CURSOR_REMOVED_REMOTE', { userId: client.id });
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
          text: element.text !== undefined ? element.text : undefined,
          points: element.points ? JSON.stringify(element.points) : undefined,
        },
      });

      client.to(boardId).emit('ELEMENT_UPDATED_REMOTE', element);
    } catch (error) {
      this.logger.error(`Failed to execute element alignment translation update:`, error);
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
      this.logger.error(`Failed to execute asset database eviction for ID ${elementId}:`, error);
    }
  }
}
