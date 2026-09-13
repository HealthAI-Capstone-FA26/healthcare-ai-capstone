import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class FindPrescriptionsQueryDto {
    @ApiProperty({ description: 'ID lượt khám cần liệt kê đơn thuốc', format: 'uuid' })
    @IsUUID()
    encounterId: string;
}
