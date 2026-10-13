import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { AppointmentPriority } from './create-appointment.dto';

// doctorId/slotId không có ở bước tạo (gán sau lúc `done`, xem QueueTicketService.done).
// bookingChannel = 'walk_in' được service tự gán, không nhận từ client.
// Schema v2 chỉ có 1 chuyên khoa nên không còn departmentId / gợi ý khoa theo triệu chứng.
export class CreateAtHospitalAppointmentDto {
  @ApiPropertyOptional({ description: 'Dùng khi lễ tân đã biết trực tiếp patientId' })
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiPropertyOptional({
    example: 'Đau bụng dữ dội kèm buồn nôn từ sáng đến giờ',
    description: 'Mô tả triệu chứng — nếu reasonForVisit để trống, giá trị này được dùng làm reasonForVisit.',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  symptoms?: string;

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