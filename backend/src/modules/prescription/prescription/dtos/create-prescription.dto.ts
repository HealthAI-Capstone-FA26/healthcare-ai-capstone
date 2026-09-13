import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsUUID, ValidateNested } from 'class-validator';
import { PrescriptionItemDto } from './prescription-item.dto';

export class CreatePrescriptionDto {
    @ApiProperty({ description: 'ID lượt khám (Encounter) đang kê đơn', format: 'uuid' })
    @IsUUID()
    encounterId: string;

    @ApiProperty({ description: 'ID chẩn đoán (Diagnosis) làm căn cứ kê đơn', format: 'uuid' })
    @IsUUID()
    diagnosisId: string;

    @ApiProperty({ description: 'Danh sách dòng thuốc', type: [PrescriptionItemDto] })
    @IsArray()
    @ArrayMinSize(1, { message: 'Đơn thuốc cần có ít nhất một dòng thuốc.' })
    @ValidateNested({ each: true })
    @Type(() => PrescriptionItemDto)
    items: PrescriptionItemDto[];
}
