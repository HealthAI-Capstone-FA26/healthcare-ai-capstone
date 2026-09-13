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

  @ApiPropertyOptional({ description: 'Mã khoa phòng (UUID)' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ description: 'Trạng thái lượt khám (arrived, waiting_for_doctor, in_progress, finished, cancelled)' })
  @IsOptional()
  @IsString()
  status?: string;
}