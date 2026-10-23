import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import { RequestUser } from '../../identity-access/auth/strategies/jwt.strategy';
import { ActorRoleService } from '../../identity-access/user/actor-role.service';
import { AuditLogService } from './audit-log.service';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

/** Audit log chỉ ĐỌC (append-only) và chỉ ADMIN được xem — không có API sửa/xoá. */
@ApiTags('Audit Log')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('audit-logs')
export class AuditLogController {
  constructor(
    private readonly auditLogService: AuditLogService,
    private readonly actorRoleService: ActorRoleService,
  ) { }

  @Get()
  @ApiOperation({ summary: 'Tra cứu nhật ký truy cập/thay đổi dữ liệu (lọc theo thời gian, người dùng, bệnh nhân, hành động...) — ADMIN' })
  async query(@Query() dto: QueryAuditLogsDto, @CurrentUser() user: RequestUser) {
    await this.actorRoleService.assertActorRole(user.userId, [ACTOR_ROLE.ADMIN]);
    return this.auditLogService.query(dto);
  }

  @Get('patients/:patientId/access-history')
  @ApiOperation({ summary: 'Ai đã truy cập hồ sơ bệnh nhân (gom theo người dùng/hành động) — ADMIN' })
  async patientAccessHistory(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query() dto: QueryAuditLogsDto,
    @CurrentUser() user: RequestUser,
  ) {
    await this.actorRoleService.assertActorRole(user.userId, [ACTOR_ROLE.ADMIN]);
    return this.auditLogService.patientAccessSummary(patientId, dto);
  }
}
