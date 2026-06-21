import { OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
export declare class PrismaService implements OnModuleInit {
    client: PrismaClient;
    constructor();
    onModuleInit(): Promise<void>;
}
