import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

// Bệnh nhân tự đổi ngày/giờ tái khám. Truyền slotId (chọn khung giờ còn trống) HOẶC appointmentDate (+ appointmentTime).
export class RescheduleAppointmentDto {
  @ApiPropertyOptional({ description: 'Slot mới còn trống của đúng bác sĩ phụ trách. Nếu có slotId thì ngày/giờ lấy theo slot.' })
  @IsOptional()
  @IsUUID()
  slotId?: string;

  @ApiPropertyOptional({ description: 'Ngày hẹn mới (YYYY-MM-DD) — dùng khi không chọn slot', example: '2026-11-05' })
  @IsOptional()
  @IsDateString()
  appointmentDate?: string;

  @ApiPropertyOptional({ description: 'Giờ hẹn mới (HH:mm:ss) — dùng khi không chọn slot', example: '09:00:00' })
  @IsOptional()
  @IsString()
  appointmentTime?: string;

  @ApiPropertyOptional({ example: 'Bận công tác, xin dời lịch' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
