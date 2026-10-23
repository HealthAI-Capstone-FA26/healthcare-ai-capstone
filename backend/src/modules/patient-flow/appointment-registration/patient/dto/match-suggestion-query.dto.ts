import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

// FE gọi endpoint này ngay sau khi user vừa đăng ký xong (verify OTP thành công)
// để hỏi "đây có phải hồ sơ của bạn?" trước khi cho phép link-user.
export class MatchSuggestionQueryDto {
  @ApiPropertyOptional({ example: '079090001234' })
  @IsOptional()
  @IsString()
  identityNumber?: string;

  @ApiPropertyOptional({ example: 'HS4010123456789' })
  @IsOptional()
  @IsString()
  insuranceNumber?: string;

  // Nếu không truyền, service sẽ tự lấy phoneNumber từ UserProfile của user hiện tại
  @ApiPropertyOptional({ example: '0901234567' })
  @IsOptional()
  @IsString()
  phoneNumber?: string;
}
