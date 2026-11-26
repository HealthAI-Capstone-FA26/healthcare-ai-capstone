import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import { RequestUser } from '../../identity-access/auth/strategies/jwt.strategy';
import { ActorRoleService } from '../../identity-access/user/actor-role.service';
import { DateRangeQueryDto, EtaQueryDto, RollupRequestDto, StageStatsQueryDto } from './dto/statistics-query.dto';
import { StatisticsRollupService } from './statistics-rollup.service';
import { StatisticsService } from './statistics.service';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { Action, Resource, Scope } from '../../../common/constants/permissions.dictionary';

/** SE07 — Thống kê & báo cáo. Báo cáo/dashboard chỉ ADMIN; ETA hàng đợi mở cho mọi người dùng đã đăng nhập. */
@ApiTags('Statistics & Reporting')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('statistics')
export class StatisticsController {
  constructor(
    private readonly statisticsService: StatisticsService,
    private readonly rollupService: StatisticsRollupService,
    private readonly actorRoleService: ActorRoleService,
  ) { }

  private assertAdmin(user: RequestUser) {
    return this.actorRoleService.assertActorRole(user.userId, [ACTOR_ROLE.ADMIN]);
  }

  @Get('overview')
  @RequirePermissions(`${Resource.ORGANIZATION}:${Action.READ}:${Scope.GROUP}`)
  @ApiOperation({ summary: 'Báo cáo tổng quan: lượt khám theo ngày, lịch hẹn, doanh thu theo phương thức, cận lâm sàng, thông báo — ADMIN' })
  async overview(@Query() q: DateRangeQueryDto, @CurrentUser() user: RequestUser) {
    await this.assertAdmin(user);
    return this.statisticsService.overview(q.from, q.to);
  }

  @Get('stages')
  @RequirePermissions(`${Resource.ORGANIZATION}:${Action.READ}:${Scope.GROUP}`)
  @ApiOperation({ summary: 'Thời gian chờ / xử lý trung bình từng chặng (từ rollup) — ADMIN' })
  async stages(@Query() q: StageStatsQueryDto, @CurrentUser() user: RequestUser) {
    await this.assertAdmin(user);
    return this.statisticsService.stages(q.from, q.to, q.stage, q.serviceId);
  }

  @Get('dashboard')
  @RequirePermissions(`${Resource.ORGANIZATION}:${Action.READ}:${Scope.GROUP}`)
  @ApiOperation({ summary: 'Dashboard theo dõi luồng khám thời gian thực (hôm nay) — ADMIN' })
  async dashboard(@CurrentUser() user: RequestUser) {
    await this.assertAdmin(user);
    return this.statisticsService.dashboard();
  }

  @Get('eta')
  @RequirePermissions(`${Resource.ORGANIZATION}:${Action.READ}:${Scope.OWN}`)
  @ApiOperation({ summary: 'Ước lượng thời gian chờ ở 1 chặng dựa trên số người phía trước và thời gian xử lý lịch sử' })
  eta(@Query() q: EtaQueryDto) {
    return this.statisticsService.estimateWait(q.stage, { serviceId: q.serviceId, ahead: q.ahead, servers: q.servers });
  }

  @Get('eta/queue-ticket/:ticketId')
  @RequirePermissions(`${Resource.ORGANIZATION}:${Action.READ}:${Scope.OWN}`)
  @ApiOperation({ summary: 'Ước lượng thời gian chờ của 1 số thứ tự (tính theo thứ tự ưu tiên gọi số thực tế)' })
  etaForTicket(@Param('ticketId', ParseUUIDPipe) ticketId: string) {
    return this.statisticsService.estimateForQueueTicket(ticketId);
  }

  @Post('rollup')
  @RequirePermissions(`${Resource.ORGANIZATION}:${Action.UPDATE}:${Scope.GROUP}`)
  @ApiOperation({ summary: 'Tính lại thống kê cho khoảng ngày (backfill / sửa số liệu) — ADMIN' })
  async rollup(@Body() dto: RollupRequestDto, @CurrentUser() user: RequestUser) {
    await this.assertAdmin(user);
    return this.rollupService.rollupRange(dto.from, dto.to);
  }
}
