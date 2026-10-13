import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// Schema v2: Doctor.userId là NOT NULL -> luôn truyền `email` + `password`: API tự tạo User
// (role cardiologist) rồi gán userId đó cho Doctor.
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

  @ApiProperty({ example: 'bs.b@hospital.vn', description: 'Email đăng nhập — sẽ tự tạo tài khoản User cho bác sĩ' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Password123' })
  @IsString()
  @MinLength(8, { message: 'Mật khẩu phải có ít nhất 8 ký tự' })
  @MaxLength(72)
  password: string;

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