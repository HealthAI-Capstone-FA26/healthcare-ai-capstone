import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class FindEncountersQueryDto {
  @ApiPropertyOptional({ description: 'Mã bệnh nhân (UUID)' })
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiPropertyOptional({ description: 'Mã bác sĩ phụ trách (UUID)' })
  @IsOptional()
  @IsUUID()
  doctorId?: string;

  @ApiPropertyOptional({ description: 'Trạng thái lượt khám (arrived, waiting_for_doctor, in_progress, finished, cancelled)' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Lọc theo ngày cụ thể (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional({ description: 'Lọc từ ngày (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'Lọc đến ngày (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  to?: string;
}