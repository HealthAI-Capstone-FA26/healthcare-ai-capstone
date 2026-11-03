import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { AuditLogService } from './audit-log.service';

/**
 * Gắn requestId (x-request-id) và ghi audit log khi response kết thúc ('finish').
 * Dùng middleware (không dùng interceptor) vì interceptor chạy SAU guard nên không thấy request bị 401/403
 * hay đăng nhập thất bại — đúng những sự kiện audit cần nhất. Tại thời điểm 'finish', passport đã gắn req.user.
 * Ghi log chạy nền sau khi response đã gửi nên không làm chậm API.
 */
@Injectable()
export class AuditLogMiddleware implements NestMiddleware {
  constructor(private readonly auditLogService: AuditLogService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-request-id'];
    const requestId = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
    res.setHeader('x-request-id', requestId);

    res.on('finish', () => {
      void this.auditLogService.recordHttp(req, res, requestId);
    });
    next();
  }
}
