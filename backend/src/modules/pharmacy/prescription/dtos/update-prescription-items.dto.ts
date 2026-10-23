import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { PrescriptionItemDto } from './prescription-item.dto';

export class UpdatePrescriptionItemsDto {
    @ApiProperty({
        description: 'Toàn bộ danh sách dòng thuốc mới của đơn — thay thế hoàn toàn danh sách cũ',
        type: [PrescriptionItemDto],
    })
    @IsArray()
    @ArrayMinSize(1, { message: 'Đơn thuốc cần có ít nhất một dòng thuốc.' })
    @ValidateNested({ each: true })
    @Type(() => PrescriptionItemDto)
    items: PrescriptionItemDto[];
}
