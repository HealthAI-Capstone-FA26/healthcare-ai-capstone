import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AppointmentPriority } from './create-appointment.dto';

// doctorId/slotId không có ở bước tạo (gán sau lúc `serve`, xem QueueTicketService.serve).
// bookingChannel = 'at_hospital' được service tự gán, không nhận từ client.
export class CreateAtHospitalAppointmentDto {
  @ApiPropertyOptional({
    description: 'PatientContact của người đang đứng tại quầy — dùng 1 trong 2: contactId hoặc patientId',
  })
  @IsOptional()
  @IsUUID()
  contactId?: string;

  @ApiPropertyOptional({ description: 'Dùng khi lễ tân đã biết trực tiếp patientId' })
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiProperty()
  @IsUUID()
  departmentId: string;

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
