import { Module, Global } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global() // This decorator ensures we don't need to manually re-import it everywhere
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}