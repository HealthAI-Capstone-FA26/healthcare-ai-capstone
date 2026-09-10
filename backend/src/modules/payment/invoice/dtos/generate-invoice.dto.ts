import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

export class GenerateInvoiceDto {
  @ApiProperty({ description: 'Lượt khám cần lập hoá đơn' })
  @IsUUID()
  encounterId: string;

  /**
   * BHYT/discountAmount: schema Patient hiện chưa có field phân loại BHYT (xem §9 spec),
   * nên tạm nhận số tiền giảm trừ qua input thủ công của lễ tân.
   * TODO: liên kết module BHYT thật khi có, thay vì nhận tay ở đây.
   */
  @ApiPropertyOptional({ example: 0, description: 'Số tiền giảm trừ (VD: BHYT) — nhập tay tạm thời' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;
}
