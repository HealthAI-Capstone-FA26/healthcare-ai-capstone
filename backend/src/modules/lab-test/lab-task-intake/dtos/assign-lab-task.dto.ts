import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignLabTaskDto {
    @ApiProperty({ description: 'User.userId của kỹ thuật viên được gán phụ trách nhiệm vụ', format: 'uuid' })
    @IsUUID()
    assignedStaffUserId: string;
}
