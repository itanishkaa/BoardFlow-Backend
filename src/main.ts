import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Enable global CORS handles if you intend to map basic HTTP diagnostics down the line
  app.enableCors();
  
  // Note: WebSockets gateway overrides this port configuration because we specifically passed port 3000 inside the decorator
  await app.listen(3001);
  console.log(`🚀 NestJS Backend Diagnostics layer listening on http://localhost:3001`);
}
bootstrap();