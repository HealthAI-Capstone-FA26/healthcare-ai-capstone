import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { checkMinioConnection } from './common/configs/upload.config'; // <-- Import hàm check
import { EcgStreamIoAdapter } from './modules/lab-test/ecg-stream/ecg-stream-io.adapter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  // Nâng giới hạn message Socket.IO để nhận tệp ECG upload qua '/ecg-stream' (xem EcgStreamIoAdapter).
  app.useWebSocketAdapter(new EcgStreamIoAdapter(app));
  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // SWAGGER CONFIG
  const config = new DocumentBuilder()
    .setTitle('Hospital Management API')
    .setDescription('API documentation - Healthcare Management Module (Outpatient process)')
    .setVersion('0.0.1')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`Application is listening on http://0.0.0.0:${port}`);

  // Kiểm tra kết nối S3/MinIO sau khi đã mở port để không chặn quá trình healthcheck/port-scan (vd Render).
  void checkMinioConnection();
}
bootstrap();