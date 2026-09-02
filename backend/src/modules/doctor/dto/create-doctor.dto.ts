import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

// Bác sĩ chính thức -> truyền kèm `email` + `password`: API sẽ tự tạo User (role DOCTOR)
// và gán userId đó cho Doctor. Bác sĩ thỉnh giảng -> không truyền email/password, userId để null.
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

  @ApiPropertyOptional({ example: 'bs.b@hospital.vn', description: 'Chỉ truyền nếu là bác sĩ chính thức -> sẽ tự tạo tài khoản User' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'Password123', description: 'Bắt buộc nếu có email' })
  @ValidateIf((dto) => !!dto.email)
  @IsString()
  @MinLength(8, { message: 'Mật khẩu phải có ít nhất 8 ký tự' })
  @MaxLength(72)
  password?: string;

  @ApiPropertyOptional({ example: '0901234567' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phoneNumber?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}