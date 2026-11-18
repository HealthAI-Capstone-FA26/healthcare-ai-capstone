import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token nhận được sau khi verify OTP quên mật khẩu' })
  @IsString()
  resetToken: string;

  @ApiProperty({ example: 'NewPassword123' })
  @IsString()
  @MinLength(8, { message: 'Mật khẩu phải có ít nhất 8 ký tự' })
  @MaxLength(72)
  newPassword: string;

  @ApiProperty({ example: 'NewPassword123' })
  @IsString()
  confirmNewPassword: string;
}
