import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { CreatePatientDto } from '../../patient/dto/create-patient.dto';
import { AppointmentPriority } from '../../appointment/dto/create-appointment.dto';

export class ServeQueueTicketDto {
  // Bắt buộc CHỈ KHI appointment chưa có doctorId (at_hospital — lễ tân chọn/gán lúc tiếp nhận).
  // Với online đã chọn bác sĩ từ lúc đặt lịch, để trống — service tự dùng đúng bác sĩ đã đặt
  // (xem QueueTicketService.done), tránh lễ tân gõ nhầm đổi sang bác sĩ khác ý bệnh nhân.
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  doctorId?: string;

  @ApiPropertyOptional({ description: 'ID của lịch hẹn đã tạo (đặt online) cần gán vào số thứ tự này' })
  @IsOptional()
  @IsUUID()
  appointmentId?: string;

  // ===== [MỚI] Chỉ dùng cho ticket at-hospital (bốc số trước, chưa có appointment) =====
  // Bắt buộc 1 trong 2: patientId (BN đã có hồ sơ) hoặc patient (BN mới, service tạo hồ sơ ngầm).
  @ApiPropertyOptional({ description: 'BN đã có hồ sơ — dùng thay cho `patient`' })
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiPropertyOptional({ type: CreatePatientDto, description: 'Thông tin BN mới — dùng thay cho `patientId`' })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreatePatientDto)
  patient?: CreatePatientDto;

  @ApiPropertyOptional({ example: 'Đau bụng 2 ngày' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reasonForVisit?: string;

  @ApiPropertyOptional({ example: 'Đau bụng dữ dội kèm buồn nôn từ sáng đến giờ', description: 'Dùng làm reasonForVisit nếu reasonForVisit trống' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  symptoms?: string;

  @ApiPropertyOptional({ enum: AppointmentPriority, default: AppointmentPriority.NORMAL })
  @IsOptional()
  @IsEnum(AppointmentPriority)
  priority?: AppointmentPriority;
}
