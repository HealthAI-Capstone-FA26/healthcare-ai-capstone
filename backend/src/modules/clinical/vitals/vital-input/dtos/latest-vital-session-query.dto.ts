import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LatestVitalSessionQueryDto {
    @ApiProperty({ description: 'ID lượt khám (encounterId hoặc encounterCode) cần lấy lần đo gần nhất' })
    @IsString()
    encounterId: string;
}
