import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CancelTestOrderItemDto {
    @ApiProperty({ description: 'Lý do huỷ hạng mục xét nghiệm', maxLength: 255 })
    @IsNotEmpty({ message: 'reason không được để trống' })
    @IsString()
    @MaxLength(255)
    reason: string;
}
