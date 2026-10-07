import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { AppointmentPriority } from '../../appointment/dto/create-appointment.dto';

// Bốc số offline: chưa có thông tin bệnh nhân, chưa có appointment — chỉ cần mức ưu tiên (nếu có).
// departmentId không bắt buộc: bỏ trống thì dùng khoa active duy nhất (nếu bệnh viện chỉ có 1 khoa).
export class IssueWalkInTicketDto {
  @ApiPropertyOptional({ description: 'Khoa bốc số. Bỏ trống nếu bệnh viện chỉ có 1 khoa active.' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ enum: AppointmentPriority, default: AppointmentPriority.NORMAL })
  @IsOptional()
  @IsEnum(AppointmentPriority)
  priority?: AppointmentPriority;
}
