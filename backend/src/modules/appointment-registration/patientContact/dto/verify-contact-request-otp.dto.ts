import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class VerifyContactRequestOtpDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6, { message: 'OTP gồm đúng 6 chữ số' })
  otp: string;
}
