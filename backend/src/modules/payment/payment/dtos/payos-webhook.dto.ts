import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsString } from 'class-validator';

/**
 * §3.3 — payload PayOS gửi vào webhook. `data` khai kiểu Record<string, any> (KHÔNG dùng
 * @Type + @ValidateNested sang 1 class con) để giữ NGUYÊN VẸN mọi field PayOS gửi kèm — cần
 * đúng nguyên payload gốc để tính lại HMAC signature (bước 2); nếu khai class con thiếu field
 * mà global ValidationPipe bật whitelist:true thì field lạ bị strip, signature sẽ tính sai.
 */
export class PayOsWebhookDto {
  @ApiProperty({ example: '00' })
  @IsString()
  code: string;

  @ApiProperty()
  @IsString()
  desc: string;

  @ApiProperty()
  @IsBoolean()
  success: boolean;

  @ApiProperty({
    description: 'Payload gốc PayOS trả về (orderCode, amount, reference, transactionDateTime, ...)',
  })
  @IsObject()
  data: Record<string, any>;

  @ApiProperty({ description: 'HMAC_SHA256(checksumKey, data đã sort field theo alphabet)' })
  @IsString()
  signature: string;
}
