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

@WebSocketGateway(3000, {
  cors: {
    origin: '*',
  },
})
export class BoardGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(BoardGateway.name);

  // Inject the global Prisma Service instance
  constructor(private readonly prisma: PrismaService) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  // Handle room assignment and catch up state data from the database
  @SubscribeMessage('JOIN_BOARD')
  async handleJoinBoard(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { boardId: string },
  ) {
    const { boardId } = data;
    client.join(boardId);
    this.logger.log(`User ${client.id} joining room: ${boardId}`);

    try {
      // 1. Ensure the board exists in the database. If not, create it on the fly!
      const board = await this.prisma.client.board.upsert({
        where: { id: boardId },
        update: {},
        create: {
          id: boardId,
          name: `Workspace Space - ${boardId}`,
        },
        include: {
          elements: true, // Fetch all existing shapes saved to this board
        },
      });

      // 2. Return historical shapes back to the connecting client
      client.emit('LOAD_BOARD_ELEMENTS', board.elements);
      this.logger.log(
        `Sent ${board.elements.length} historical elements to client ${client.id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to seed or sync board room state updates:`,
        error,
      );
    }
  }

  // Intercept and save vector creations to database memory before forwarding
  @SubscribeMessage('ELEMENT_CREATE')
  async handleElementCreate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { boardId: string; element: any },
  ) {
    const { boardId, element } = data;

    try {
      // Persist the shape to the database table model
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
        },
      });

      // Broadcast the shape payload out to all other connected tabs in the room
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

  // Inside src/board.gateway.ts

  @SubscribeMessage('BOARD_CLEAR')
  async handleBoardClear(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { boardId: string },
  ) {
    const { boardId } = data;
    try {
      // Cascade delete all elements associated with this specific board ID
      await this.prisma.client.element.deleteMany({
        where: { boardId: boardId },
      });

      // Broadcast the clear signal to everyone else inside this room
      client.to(boardId).emit('BOARD_CLEARED_REMOTE');
      this.logger.log(
        `Board ${boardId} wiped successfully by client ${client.id}`,
      );
    } catch (error) {
      this.logger.error(`Failed to execute canvas drop sequence:`, error);
    }
  }

  // Inside src/board.gateway.ts

  @SubscribeMessage('CURSOR_MOVE')
  handleCursorMove(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { boardId: string; x: number; y: number },
  ) {
    // Broadcast coordinates to everyone in the room EXCEPT the sender
    client.to(data.boardId).emit('CURSOR_UPDATED_REMOTE', {
      userId: client.id,
      x: data.x,
      y: data.y,
    });
  }

  // When a client leaves, notify the others to clean up their cursor marker immediately
  @SubscribeMessage('CURSOR_LEAVE')
  handleCursorLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { boardId: string },
  ) {
    client
      .to(data.boardId)
      .emit('CURSOR_REMOVED_REMOTE', { userId: client.id });
  }

  // Inside src/board.gateway.ts

  @SubscribeMessage('ELEMENT_UPDATE')
  async handleElementUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { boardId: string; element: any },
  ) {
    const { boardId, element } = data;
    try {
      // Persist coordinate shifts straight to database storage columns
      await this.prisma.client.element.update({
        where: { id: element.id },
        data: {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
        },
      });

      // Broadcast update parameters to all other users instantly
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
      // Drop record permanently out of your database table rows
      await this.prisma.client.element.delete({
        where: { id: elementId },
      });

      // Broadcast the deletion down to every other client active in the workspace
      client.to(boardId).emit('ELEMENT_DELETED_REMOTE', elementId);
    } catch (error) {
      this.logger.error(
        `Failed to execute asset database eviction for ID ${elementId}:`,
        error,
      );
    }
  }
}

// Make sure to clean up cursor arrays if a user closes their tab abruptly
const originalDisconnect = BoardGateway.prototype.handleDisconnect;
BoardGateway.prototype.handleDisconnect = function (client: Socket) {
  this.server.emit('CURSOR_REMOVED_REMOTE', { userId: client.id });
  this.server.emit('DRAWING_PREVIEW_REMOTE', {
    userId: client.id,
    element: null,
  });
  if (originalDisconnect) originalDisconnect.apply(this, [client]);
};
