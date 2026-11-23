import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SendEncounterPdfZaloDto {
  @ApiPropertyOptional({
    description: 'Zalo user id nhận PDF. Bỏ trống = dùng Zalo id bệnh nhân đã khai trong notification preference.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  zaloUserId?: string;
}
