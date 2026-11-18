import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { NOTIFICATION_CHANNELS, NOTIFICATION_TYPES } from '../notification.constants';

export class ListNotificationsQueryDto {
  @ApiPropertyOptional({ enum: NOTIFICATION_CHANNELS, default: 'in_app', description: 'Mặc định chỉ trả kênh in_app (tránh trùng lặp khi 1 sự kiện gửi nhiều kênh)' })
  @IsOptional()
  @IsIn(NOTIFICATION_CHANNELS as unknown as string[])
  channel?: string;

  @ApiPropertyOptional({ enum: NOTIFICATION_TYPES })
  @IsOptional()
  @IsString()
  notificationType?: string;

  @ApiPropertyOptional({ enum: ['queued', 'sent', 'failed', 'cancelled'], default: 'sent' })
  @IsOptional()
  @IsIn(['queued', 'sent', 'failed', 'cancelled'])
  status?: string;

  @ApiPropertyOptional({ description: 'true = chỉ thông báo chưa đọc' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  unreadOnly?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
