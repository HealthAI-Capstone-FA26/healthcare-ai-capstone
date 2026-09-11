import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsBoolean, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';

export class TestOrderItemInputDto {
    @ApiProperty({ description: 'ID danh mục xét nghiệm (TestCatalog.testTypeId)', format: 'uuid' })
    @IsUUID()
    testTypeId: string;

    @ApiPropertyOptional({
        description: 'Hạng mục này có nằm trong danh sách được hệ thống gợi ý (test-recommendations) hay không',
        default: false,
    })
    @IsOptional()
    @IsBoolean()
    wasAiSuggested?: boolean;
}

/**
 * Module 5, mục "Gợi ý chỉ định": bác sĩ chốt danh mục xét nghiệm cần chỉ định. Mỗi hạng mục
 * (TestOrderItem) tạo ra sẽ kéo theo 1 LabTask ở trạng thái 'payment_pending' để bàn giao sang
 * quy trình tiếp nhận xét nghiệm (module lab-test) — xem TestOrderService.create.
 */
export class CreateTestOrderDto {
    @ApiPropertyOptional({
        description: 'Chẩn đoán sơ bộ làm căn cứ chỉ định (nếu có) — phải thuộc cùng lượt khám',
        format: 'uuid',
    })
    @IsOptional()
    @IsUUID()
    diagnosisId?: string;

    @ApiPropertyOptional({ maxLength: 255 })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    notes?: string;

    @ApiProperty({ type: [TestOrderItemInputDto], description: 'Danh sách hạng mục xét nghiệm được chỉ định' })
    @ArrayMinSize(1, { message: 'Cần chỉ định ít nhất 1 hạng mục xét nghiệm' })
    @ValidateNested({ each: true })
    @Type(() => TestOrderItemInputDto)
    items: TestOrderItemInputDto[];
}
