import { OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
export declare class BoardGateway implements OnGatewayConnection, OnGatewayDisconnect {
    private readonly prisma;
    server: Server;
    private readonly logger;
    constructor(prisma: PrismaService);
    handleConnection(client: Socket): void;
    handleDisconnect(client: Socket): void;
    handleJoinBoard(client: Socket, data: {
        boardId: string;
    }): Promise<void>;
    handleElementCreate(client: Socket, data: {
        boardId: string;
        element: any;
    }): Promise<void>;
    handleDrawingPreview(client: Socket, data: {
        boardId: string;
        element: any | null;
    }): void;
    handleBoardClear(client: Socket, data: {
        boardId: string;
    }): Promise<void>;
    handleCursorMove(client: Socket, data: {
        boardId: string;
        x: number;
        y: number;
    }): void;
    handleCursorLeave(client: Socket, data: {
        boardId: string;
    }): void;
    handleElementUpdate(client: Socket, data: {
        boardId: string;
        element: any;
    }): Promise<void>;
    handleElementDelete(client: Socket, data: {
        boardId: string;
        elementId: string;
    }): Promise<void>;
}
