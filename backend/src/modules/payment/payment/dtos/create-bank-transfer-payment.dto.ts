import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/**
 * §3.2b — không nhận `amount` từ FE: PaymentService tự tính số tiền còn thiếu của invoice
 * (giống logic ở CreateCashPaymentDto nhưng amount server tự suy ra, tránh FE gửi sai lệch
 * với số tiền PayOS thực sự tạo link).
 */
export class CreateBankTransferPaymentDto {
  @ApiProperty()
  @IsUUID()
  invoiceId: string;
}
