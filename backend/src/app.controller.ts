import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Endpoint kiểm tra trạng thái sống của server (GET /api/v1/health), không truy vấn DB và không dùng guard
  @Get('health')
  healthCheck() {
    return { status: 'ok', time: new Date().toISOString() };
  }
}
