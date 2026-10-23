import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class FindPrescriptionsQueryDto {
    @ApiPropertyOptional({ description: 'ID lượt khám cần liệt kê đơn thuốc', format: 'uuid' })
    @IsOptional()
    @IsUUID()
    encounterId?: string;

    @ApiPropertyOptional({ description: 'ID bác sĩ kê đơn', format: 'uuid' })
    @IsOptional()
    @IsUUID()
    doctorId?: string;

    @ApiPropertyOptional({ description: 'Trạng thái đơn thuốc: draft | signed | cancelled' })
    @IsOptional()
    @IsString()
    status?: string;
}
