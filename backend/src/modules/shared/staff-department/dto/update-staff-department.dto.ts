import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateStaffDepartmentDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  isPrimary: boolean;
}
