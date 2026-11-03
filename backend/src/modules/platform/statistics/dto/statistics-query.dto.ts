import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';
import { STAGES, WAIT_STAGE_TO_SERVICE_STAGE } from '../statistics.constants';

const DATE_MSG = 'phải có dạng YYYY-MM-DD';

export class DateRangeQueryDto {
  @ApiProperty({ example: '2026-10-01', description: 'Ngày bắt đầu (giờ bệnh viện), gồm cả ngày này' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: `from ${DATE_MSG}` })
  from!: string;

  @ApiProperty({ example: '2026-10-22', description: 'Ngày kết thúc (giờ bệnh viện), gồm cả ngày này; tối đa 92 ngày' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: `to ${DATE_MSG}` })
  to!: string;
}

export class StageStatsQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({ enum: STAGES })
  @IsOptional()
  @IsIn(STAGES as unknown as string[])
  stage?: string;

  @ApiPropertyOptional({ description: 'Lọc theo dịch vụ cận lâm sàng (chặng diagnostic_*)' })
  @IsOptional()
  @IsUUID()
  serviceId?: string;
}

export class EtaQueryDto {
  @ApiProperty({ enum: Object.keys(WAIT_STAGE_TO_SERVICE_STAGE), description: 'Chặng đang chờ' })
  @IsIn(Object.keys(WAIT_STAGE_TO_SERVICE_STAGE))
  stage!: string;

  @ApiPropertyOptional({ description: 'Dịch vụ cận lâm sàng (khi stage = diagnostic_wait)' })
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @ApiPropertyOptional({ default: 0, description: 'Số người đang xếp phía trước' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  ahead?: number;

  @ApiPropertyOptional({ default: 1, description: 'Số điểm phục vụ song song (quầy / bác sĩ / phòng)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  servers?: number;
}

export class RollupRequestDto extends DateRangeQueryDto {
  @ApiPropertyOptional({ description: 'Ghi chú nội bộ (không lưu)' })
  @IsOptional()
  @IsString()
  note?: string;
}
