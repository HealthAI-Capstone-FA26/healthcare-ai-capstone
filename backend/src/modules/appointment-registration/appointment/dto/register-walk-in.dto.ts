import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { CreatePatientDto } from '../../patient/dto/create-patient.dto';

// Lễ tân khai báo thông tin cùng bệnh nhân sau khi bốc số: tạo (hoặc tái dùng) Patient và tạo
// Appointment (at_hospital) trong CÙNG 1 transaction, rồi gắn vào ticket. Khoa lấy từ ticket,
// priority lấy từ ticket — không nhận lại từ client.
export class RegisterWalkInDto {
  @ApiPropertyOptional({ description: 'Bệnh nhân đã có hồ sơ — bỏ trống nếu khai báo mới qua `patient`' })
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiPropertyOptional({ type: CreatePatientDto, description: 'Thông tin định danh (bắt buộc nếu không có patientId)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreatePatientDto)
  patient?: CreatePatientDto;

  @ApiPropertyOptional({ example: 'Đau bụng 2 ngày' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reasonForVisit?: string;
}
