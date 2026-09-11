import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CancelLabTaskDto {
    @ApiPropertyOptional({ description: 'Lý do huỷ nhiệm vụ xét nghiệm', maxLength: 255 })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    reason?: string;
}
