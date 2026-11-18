import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CallQueueTicketDto {
  @ApiPropertyOptional({ example: 'Quầy 2' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  counterNumber?: string;
}
