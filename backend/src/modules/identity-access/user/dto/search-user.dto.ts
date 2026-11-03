import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class SearchUserDto {
  @ApiPropertyOptional({
    description: 'Từ khóa tìm kiếm theo họ tên, email hoặc số điện thoại',
    example: 'nguyen',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Lọc theo vai trò (PATIENT, DOCTOR, NURSE, RECEPTION, LAB, ADMIN)',
    example: 'DOCTOR',
  })
  @IsOptional()
  @IsString()
  actorRole?: string;
}
