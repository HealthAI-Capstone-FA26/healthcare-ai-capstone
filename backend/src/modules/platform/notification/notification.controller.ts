import { Body, Controller, Get, Param, Patch, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequestUser } from '../../identity-access/auth/strategies/jwt.strategy';
import { NotificationService } from './notification.service';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';

/**
 * SE07 — màn hình "Multi-channel notification settings & history" của bệnh nhân / nhân viên.
 * Mọi API chỉ thao tác trên thông báo của CHÍNH người đăng nhập (req.user).
 */
@ApiTags('Notification')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) { }

  @Get()
  @ApiOperation({ summary: 'Lịch sử thông báo của tôi (phân trang, lọc kênh/loại/chưa đọc)' })
  list(@CurrentUser() user: RequestUser, @Query() query: ListNotificationsQueryDto) {
    return this.notificationService.list(user.userId, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Số thông báo in-app chưa đọc' })
  unreadCount(@CurrentUser() user: RequestUser) {
    return this.notificationService.unreadCount(user.userId);
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Cài đặt kênh nhận thông báo của tôi' })
  getPreferences(@CurrentUser() user: RequestUser) {
    return this.notificationService.getPreferences(user.userId);
  }

  @Put('preferences')
  @ApiOperation({ summary: 'Bật/tắt kênh theo loại thông báo, khai báo email/SĐT/Zalo user id nhận thông báo' })
  updatePreferences(@CurrentUser() user: RequestUser, @Body() dto: UpdateNotificationPreferencesDto) {
    return this.notificationService.upsertPreferences(user.userId, dto);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Đánh dấu tất cả thông báo in-app đã đọc' })
  markAllRead(@CurrentUser() user: RequestUser) {
    return this.notificationService.markAllRead(user.userId);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Đánh dấu 1 thông báo đã đọc' })
  markRead(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.notificationService.markRead(user.userId, id);
  }
}
