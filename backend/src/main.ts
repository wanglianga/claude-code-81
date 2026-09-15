import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import { join } from 'path';
import { existsSync } from 'fs';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { cors: true });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: false }));

  // 生产环境托管前端构建产物（SPA）
  const publicDir = join(__dirname, '..', 'public');
  if (existsSync(publicDir)) {
    app.useStaticAssets(publicDir);
    const server = app.getHttpAdapter().getInstance();
    server.get(/^\/(?!api).*/, (_req: any, res: any) => {
      res.sendFile(join(publicDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`Commute platform listening on :${port}`);
}
bootstrap();
