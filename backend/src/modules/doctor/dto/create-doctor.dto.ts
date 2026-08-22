import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

// `userId` chỉ set khi bác sĩ chính thức (trỏ tới 1 User có role phù hợp).
// Bác sĩ thỉnh giảng -> không truyền userId.
export class CreateDoctorDto {
  @ApiProperty({ example: 'Nguyễn Thị B' })
  @IsString()
  @MaxLength(255)
  fullName: string;

  @ApiPropertyOptional({ example: 'ThS.BS' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  title?: string;

  @ApiPropertyOptional({ example: 'VN-HN-001234' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  licenseNumber?: string;

  @ApiPropertyOptional({ example: 'Tim mạch' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  specialization?: string;

  @ApiPropertyOptional({ description: 'Chỉ set nếu là bác sĩ chính thức có tài khoản User' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
