import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';

@Injectable()
export class PrismaService implements OnModuleInit {
  public client: PrismaClient;

  constructor() {
    const adapter = new PrismaLibSql({
      url: 'file:./dev.db',
    });

    this.client = new PrismaClient({ adapter });
  }

  async onModuleInit() {
    try {
      await this.client.$queryRaw`SELECT 1`;
      console.log('Prisma database connection verified successfully.');
    } catch (error) {
      console.error('Database verification failed:', error);
    }
  }
}
