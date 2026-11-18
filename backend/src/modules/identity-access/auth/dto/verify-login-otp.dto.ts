import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length } from 'class-validator';

export class VerifyLoginOtpDto {
  @ApiProperty({ example: 'patient01@gmail.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6, { message: 'OTP gồm đúng 6 chữ số' })
  otp: string;
}
