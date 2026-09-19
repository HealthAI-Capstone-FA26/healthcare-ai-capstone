import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

export class GenerateInvoiceDto {
  @ApiPropertyOptional({ description: 'Lượt khám cần lập hoá đơn; dùng cho invoice bổ sung xét nghiệm' })
  @IsOptional()
  @IsUUID()
  encounterId?: string;

  @ApiPropertyOptional({ description: 'Lịch hẹn cần lập hoá đơn phí khám trước khi tạo encounter' })
  @IsOptional()
  @IsUUID()
  appointmentId?: string;

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
