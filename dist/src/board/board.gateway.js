"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var BoardGateway_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BoardGateway = void 0;
const websockets_1 = require("@nestjs/websockets");
const socket_io_1 = require("socket.io");
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let BoardGateway = BoardGateway_1 = class BoardGateway {
    prisma;
    server;
    logger = new common_1.Logger(BoardGateway_1.name);
    constructor(prisma) {
        this.prisma = prisma;
    }
    handleConnection(client) {
        this.logger.log(`Client connected: ${client.id}`);
    }
    handleDisconnect(client) {
        this.logger.log(`Client disconnected: ${client.id}`);
    }
    async handleJoinBoard(client, data) {
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
            client.emit('LOAD_BOARD_ELEMENTS', board.elements);
            this.logger.log(`Sent ${board.elements.length} historical elements to client ${client.id}`);
        }
        catch (error) {
            this.logger.error(`Failed to seed or sync board room state updates:`, error);
        }
    }
    async handleElementCreate(client, data) {
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
                },
            });
            client.to(boardId).emit('ELEMENT_CREATED_REMOTE', element);
            client.to(boardId).emit('DRAWING_PREVIEW_REMOTE', {
                userId: client.id,
                element: null,
            });
        }
        catch (error) {
            this.logger.error(`Failed to persist element creation to DB:`, error);
        }
    }
    handleDrawingPreview(client, data) {
        client.to(data.boardId).emit('DRAWING_PREVIEW_REMOTE', {
            userId: client.id,
            element: data.element,
        });
    }
    async handleBoardClear(client, data) {
        const { boardId } = data;
        try {
            await this.prisma.client.element.deleteMany({
                where: { boardId: boardId },
            });
            client.to(boardId).emit('BOARD_CLEARED_REMOTE');
            this.logger.log(`Board ${boardId} wiped successfully by client ${client.id}`);
        }
        catch (error) {
            this.logger.error(`Failed to execute canvas drop sequence:`, error);
        }
    }
    handleCursorMove(client, data) {
        client.to(data.boardId).emit('CURSOR_UPDATED_REMOTE', {
            userId: client.id,
            x: data.x,
            y: data.y,
        });
    }
    handleCursorLeave(client, data) {
        client
            .to(data.boardId)
            .emit('CURSOR_REMOVED_REMOTE', { userId: client.id });
    }
    async handleElementUpdate(client, data) {
        const { boardId, element } = data;
        try {
            await this.prisma.client.element.update({
                where: { id: element.id },
                data: {
                    x: element.x,
                    y: element.y,
                    width: element.width,
                    height: element.height,
                },
            });
            client.to(boardId).emit('ELEMENT_UPDATED_REMOTE', element);
        }
        catch (error) {
            this.logger.error(`Failed to execute element alignment translation update:`, error);
        }
    }
    async handleElementDelete(client, data) {
        const { boardId, elementId } = data;
        try {
            await this.prisma.client.element.delete({
                where: { id: elementId },
            });
            client.to(boardId).emit('ELEMENT_DELETED_REMOTE', elementId);
        }
        catch (error) {
            this.logger.error(`Failed to execute asset database eviction for ID ${elementId}:`, error);
        }
    }
};
exports.BoardGateway = BoardGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", socket_io_1.Server)
], BoardGateway.prototype, "server", void 0);
__decorate([
    (0, websockets_1.SubscribeMessage)('JOIN_BOARD'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", Promise)
], BoardGateway.prototype, "handleJoinBoard", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('ELEMENT_CREATE'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", Promise)
], BoardGateway.prototype, "handleElementCreate", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('DRAWING_PREVIEW'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", void 0)
], BoardGateway.prototype, "handleDrawingPreview", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('BOARD_CLEAR'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", Promise)
], BoardGateway.prototype, "handleBoardClear", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('CURSOR_MOVE'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", void 0)
], BoardGateway.prototype, "handleCursorMove", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('CURSOR_LEAVE'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", void 0)
], BoardGateway.prototype, "handleCursorLeave", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('ELEMENT_UPDATE'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", Promise)
], BoardGateway.prototype, "handleElementUpdate", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('ELEMENT_DELETE'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", Promise)
], BoardGateway.prototype, "handleElementDelete", null);
exports.BoardGateway = BoardGateway = BoardGateway_1 = __decorate([
    (0, websockets_1.WebSocketGateway)(3000, {
        cors: {
            origin: '*',
        },
    }),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], BoardGateway);
const originalDisconnect = BoardGateway.prototype.handleDisconnect;
BoardGateway.prototype.handleDisconnect = function (client) {
    this.server.emit('CURSOR_REMOVED_REMOTE', { userId: client.id });
    this.server.emit('DRAWING_PREVIEW_REMOTE', {
        userId: client.id,
        element: null,
    });
    if (originalDisconnect)
        originalDisconnect.apply(this, [client]);
};
//# sourceMappingURL=board.gateway.js.map