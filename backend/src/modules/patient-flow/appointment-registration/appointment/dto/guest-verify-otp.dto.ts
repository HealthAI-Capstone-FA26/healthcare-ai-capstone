import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';

// Bước 2: nhập OTP và thông tin email (nếu có) để xác nhận yêu cầu đã lưu ở bước 1.
export class GuestVerifyOtpDto {
  @ApiProperty({ example: '0901234567', description: 'Phải trùng SĐT đã dùng ở bước request-otp' })
  @IsString()
  @MaxLength(20)
  phoneNumber: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6, { message: 'OTP gồm đúng 6 chữ số' })
  otp: string;

  @ApiPropertyOptional({ example: 'guest@example.com' })
  @IsEmail()
  email?: string;
}
