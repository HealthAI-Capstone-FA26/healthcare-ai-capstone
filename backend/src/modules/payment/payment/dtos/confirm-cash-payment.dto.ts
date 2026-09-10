import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Actor lấy từ @CurrentUser() (RECEPTIONIST) — không nhận qua body (§3.2a).
 * Body chỉ có ghi chú tuỳ chọn cho việc đối soát cuối ca.
 */
export class ConfirmCashPaymentDto {
  @ApiPropertyOptional({ example: 'Đối soát ca sáng 09/09' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}
