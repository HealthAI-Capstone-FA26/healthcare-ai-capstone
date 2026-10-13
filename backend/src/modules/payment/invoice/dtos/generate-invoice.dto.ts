import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

export class GenerateInvoiceDto {
  @ApiPropertyOptional({ description: 'Lượt khám cần lập hoá đơn (phí khám + dịch vụ CLS chưa tính tiền)' })
  @IsOptional()
  @IsUUID()
  encounterId?: string;

  @ApiPropertyOptional({ description: 'Thay cho encounterId: tra lượt khám theo lịch hẹn (lịch hẹn phải đã check-in)' })
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
