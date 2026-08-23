import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';
import { ScheduleSession } from 'src/common/constants/schedule-session.constants';

const HHMM_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

// Không truyền startTime/endTime/slotDurationMins/maxPatientsPerSlot -> service tự áp default theo session
// (xem SESSION_DEFAULTS, câu hỏi mở cần chốt với PO ở phase-3.md).
export class CreateDoctorScheduleDto {
  @ApiProperty({ description: 'Id bác sĩ' })
  @IsUUID()
  doctorId: string;

  @ApiPropertyOptional({
    description: 'Id khoa — nếu bỏ trống, hệ thống tự lấy khoa chính (isPrimary=true) của bác sĩ',
  })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiProperty({ example: '2026-09-01' })
  @IsDateString()
  workDate: string;

  @ApiProperty({ enum: ScheduleSession, example: ScheduleSession.MORNING })
  @IsEnum(ScheduleSession)
  session: ScheduleSession;

  @ApiPropertyOptional({ example: '07:30', description: 'Định dạng HH:mm, mặc định theo session' })
  @IsOptional()
  @Matches(HHMM_REGEX, { message: 'startTime phải theo định dạng HH:mm' })
  startTime?: string;

  @ApiPropertyOptional({ example: '11:30', description: 'Định dạng HH:mm, mặc định theo session' })
  @IsOptional()
  @Matches(HHMM_REGEX, { message: 'endTime phải theo định dạng HH:mm' })
  endTime?: string;

  @ApiPropertyOptional({ example: 30, description: 'Thời lượng mỗi slot (phút), mặc định 30' })
  @IsOptional()
  @IsInt()
  @Min(5)
  slotDurationMins?: number;

  @ApiPropertyOptional({ example: 1, description: 'Số bệnh nhân tối đa mỗi slot, mặc định 1' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxPatientsPerSlot?: number;
}
