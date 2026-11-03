import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { NOTIFICATION_CHANNELS, NOTIFICATION_TYPES, NOTIFICATION_TYPE_WILDCARD } from '../notification.constants';

export class NotificationPreferenceItemDto {
  @ApiProperty({ enum: NOTIFICATION_CHANNELS })
  @IsIn(NOTIFICATION_CHANNELS as unknown as string[])
  channel!: string;

  @ApiProperty({ enum: [NOTIFICATION_TYPE_WILDCARD, ...NOTIFICATION_TYPES], description: "'*' = áp dụng mọi loại thông báo" })
  @IsIn([NOTIFICATION_TYPE_WILDCARD, ...NOTIFICATION_TYPES])
  notificationType!: string;

  @ApiProperty()
  @IsBoolean()
  isEnabled!: boolean;

  @ApiPropertyOptional({ description: 'Ghi đè email / số điện thoại / Zalo user id nhận thông báo' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  destination?: string;
}

export class UpdateNotificationPreferencesDto {
  @ApiProperty({ type: [NotificationPreferenceItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => NotificationPreferenceItemDto)
  preferences!: NotificationPreferenceItemDto[];
}
