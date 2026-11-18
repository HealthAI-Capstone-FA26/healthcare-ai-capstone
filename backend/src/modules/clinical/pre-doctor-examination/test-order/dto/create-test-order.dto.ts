import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';

export const DIAGNOSTIC_ORDER_PRIORITIES = ['routine', 'urgent', 'stat'] as const;
export type DiagnosticOrderPriority = (typeof DIAGNOSTIC_ORDER_PRIORITIES)[number];

export class TestOrderItemInputDto {
    @ApiProperty({ description: 'ID dịch vụ cận lâm sàng (ServiceCatalog.serviceId)', format: 'uuid' })
    @IsUUID()
    serviceId: string;
}

/**
 * SE02 — Bác sĩ chốt chỉ định cận lâm sàng. BẮT BUỘC dựa trên 1 chẩn đoán ban đầu (diagnosisType='initial')
 * của cùng lượt khám. Mỗi hạng mục tạo ra 1 DiagnosticTask 'payment_pending' (bàn giao sang lab-test).
 */
export class CreateTestOrderDto {
    @ApiProperty({ description: 'Chẩn đoán ban đầu (initial) làm căn cứ chỉ định — cùng lượt khám', format: 'uuid' })
    @IsUUID()
    diagnosisId: string;

    @ApiPropertyOptional({ enum: DIAGNOSTIC_ORDER_PRIORITIES, default: 'routine' })
    @IsOptional()
    @IsIn(DIAGNOSTIC_ORDER_PRIORITIES)
    priority?: DiagnosticOrderPriority;

    @ApiPropertyOptional({ description: 'Lý do chỉ định, VD: loại trừ hội chứng vành cấp', maxLength: 255 })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    clinicalIndication?: string;

    @ApiPropertyOptional({ maxLength: 255 })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    notes?: string;

    @ApiProperty({ type: [TestOrderItemInputDto], description: 'Danh sách dịch vụ được chỉ định (không trùng serviceId)' })
    @ArrayMinSize(1, { message: 'Cần chỉ định ít nhất 1 dịch vụ cận lâm sàng' })
    @ArrayMaxSize(30, { message: 'Mỗi phiếu chỉ định tối đa 30 dịch vụ' })
    @ValidateNested({ each: true })
    @Type(() => TestOrderItemInputDto)
    items: TestOrderItemInputDto[];
}
