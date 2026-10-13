import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export enum AppointmentPriority {
  NORMAL = 'normal',
  URGENT = 'urgent',
  EMERGENCY = 'emergency',
}

// bookingChannel = 'online' được service tự gán, không nhận từ client.
export class CreateAppointmentDto {
  @ApiProperty({ description: 'Hồ sơ bệnh nhân đặt lịch (phải thuộc tài khoản đang đăng nhập)' })
  @IsUUID()
  patientId: string;

  @ApiProperty()
  @IsUUID()
  doctorId: string;

  @ApiProperty()
  @IsUUID()
  slotId: string;

  @ApiPropertyOptional({ example: 'Đau bụng 2 ngày' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reasonForVisit?: string;

  @ApiPropertyOptional({ enum: AppointmentPriority, default: AppointmentPriority.NORMAL })
  @IsOptional()
  @IsEnum(AppointmentPriority)
  priority?: AppointmentPriority;
}
