import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { RelationshipType } from '../../../common/constants/relationship.constants';

export enum AppointmentPriority {
  NORMAL = 'normal',
  URGENT = 'urgent',
  EMERGENCY = 'emergency',
}

// bookingChannel = 'online' được service tự gán, không nhận từ client.
export class CreateAppointmentDto {
  @ApiProperty({ description: 'Patient được đặt lịch (cho mình hoặc người thân)' })
  @IsUUID()
  patientId: string;

  @ApiProperty({
    enum: RelationshipType,
    description:
      'Quan hệ giữa user đang đặt lịch (currentUser) và patientId — dùng để tạo/upsert PatientContact',
  })
  @IsEnum(RelationshipType)
  relationship: RelationshipType;

  @ApiProperty()
  @IsUUID()
  departmentId: string;

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
