import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');

  // Bật validation toàn cục (khuyến nghị đi kèm khi setup Swagger,
  // để DTO decorator từ class-validator hoạt động đúng)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // ================== SWAGGER CONFIG ==================
  const config = new DocumentBuilder()
    .setTitle('Hospital Management API')
    .setDescription('API documentation - Healthcare Management Module (Outpatient process)')
    .setVersion('0.0.1')
    .addBearerAuth() // nếu dùng JWT auth, thêm nút "Authorize" trên UI
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document); // truy cập tại http://localhost:3000/api/docs
  // ======================================================

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();