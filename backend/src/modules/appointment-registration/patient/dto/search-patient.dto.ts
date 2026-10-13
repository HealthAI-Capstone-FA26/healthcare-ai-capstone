import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class SearchPatientDto {
  // Tìm theo tên/CCCD/mã bệnh nhân — dùng cho lễ tân/admin
  @ApiPropertyOptional({ example: 'Nguyễn Văn A' })
  @IsOptional()
  @IsString()
  search?: string;
}
