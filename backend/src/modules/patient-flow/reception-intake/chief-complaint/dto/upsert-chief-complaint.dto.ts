import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

// self_kiosk: bệnh nhân tự khai qua kiosk/app — recordedByUserId sẽ là null (xem service).
// receptionist_assisted: lễ tân nhập hộ tại quầy.
// online_pre_visit: khai trước qua web khi đặt lịch online.
export enum ChiefComplaintInputChannel {
  SELF_KIOSK = 'self_kiosk',
  RECEPTIONIST_ASSISTED = 'receptionist_assisted',
  ONLINE_PRE_VISIT = 'online_pre_visit',
}

export class UpsertChiefComplaintDto {
  @ApiProperty({ maxLength: 255 })
  @IsString()
  @MaxLength(255)
  reasonForVisit: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  symptoms?: string;

  @ApiPropertyOptional({ example: '2026-08-25' })
  @IsOptional()
  @IsDateString()
  symptomOnsetDate?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 10, description: 'Thang điểm đau 0-10' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  painLevel?: number;

  @ApiProperty({ enum: ChiefComplaintInputChannel })
  @IsEnum(ChiefComplaintInputChannel)
  inputChannel: ChiefComplaintInputChannel;
}