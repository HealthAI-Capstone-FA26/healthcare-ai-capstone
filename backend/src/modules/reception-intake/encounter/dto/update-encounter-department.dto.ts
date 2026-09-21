import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class UpdateEncounterDepartmentDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Khoa MỚI mà bệnh nhân cần chuyển tới sau khi đã đo sinh hiệu. Hệ thống tự chọn bác sĩ trong khoa đó ' +
      '(đang trong ca, ít bệnh nhân chờ nhất) và xếp bệnh nhân vào hàng đợi của bác sĩ đó.',
  })
  @IsUUID()
  departmentId: string;
}
