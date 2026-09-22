import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class SearchDoctorDto {
  @ApiPropertyOptional({ description: 'Lọc bác sĩ theo khoa' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ example: 'Nguyễn' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Lọc bác sĩ theo userId (dùng để tra doctorId sau khi login)' })
  @IsOptional()
  @IsUUID()
  userId?: string;
}
