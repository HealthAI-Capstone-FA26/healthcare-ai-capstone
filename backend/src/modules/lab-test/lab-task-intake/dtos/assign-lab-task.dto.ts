import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignLabTaskDto {
    @ApiProperty({ description: 'ID kỹ thuật viên được gán phụ trách nhiệm vụ', format: 'uuid' })
    @IsUUID()
    assignedLabStaffId: string;
}
