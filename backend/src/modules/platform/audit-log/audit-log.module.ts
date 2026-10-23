import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { installBigIntJsonSerializer } from '../../../common/utils/bigint-json.util';
import { UserModule } from '../../identity-access/user/user.module';
import { AuditLogController } from './audit-log.controller';
import { AuditLogMiddleware } from './audit-log.middleware';
import { AuditLogService } from './audit-log.service';

// AuditLog.auditId là BigInt -> cần serializer JSON khi trả response.
installBigIntJsonSerializer();

/**
 * SE07 — Audit Log. @Global để code nghiệp vụ/AI service có thể inject AuditLogService.record() khi cần ghi
 * before/after chi tiết hoặc actorType 'ai_service'. Việc ghi log HTTP là tự động qua AuditLogMiddleware.
 */
@Global()
@Module({
  imports: [UserModule], // ActorRoleService cho AuditLogController
  controllers: [AuditLogController],
  providers: [AuditLogService, AuditLogMiddleware],
  exports: [AuditLogService],
})
export class AuditLogModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuditLogMiddleware).forRoutes('*');
  }
}
