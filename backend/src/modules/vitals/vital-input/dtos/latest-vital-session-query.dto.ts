import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LatestVitalSessionQueryDto {
    @ApiProperty({ description: 'ID lượt khám cần lấy lần đo gần nhất', format: 'uuid' })
    @IsUUID()
    encounterId: string;
}
