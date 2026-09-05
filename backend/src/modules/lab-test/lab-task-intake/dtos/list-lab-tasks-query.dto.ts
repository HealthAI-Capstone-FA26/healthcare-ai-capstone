import { IsUUID, IsOptional, IsIn, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const LAB_TASK_STATUSES = ['payment_pending', 'ready', 'in_progress', 'completed', 'cancelled'] as const;
export type LabTaskStatus = (typeof LAB_TASK_STATUSES)[number];

/**
 * Worklist của kỹ thuật viên: bắt buộc lọc theo labRoomId vì mỗi kỹ thuật viên
 * chỉ được phân quyền theo phòng chuyên môn của mình (LabStaffRoomAssignment).
 */
export class ListLabTasksQueryDto {
    @ApiProperty({ description: 'ID phòng Lab cần xem worklist', format: 'uuid' })
    @IsUUID()
    labRoomId: string;

    @ApiPropertyOptional({ description: 'Lọc theo trạng thái nhiệm vụ', enum: LAB_TASK_STATUSES })
    @IsOptional()
    @IsIn(LAB_TASK_STATUSES)
    status?: LabTaskStatus;

    @ApiPropertyOptional({ description: 'Lọc theo kỹ thuật viên được phân công', format: 'uuid' })
    @IsOptional()
    @IsUUID()
    assignedLabStaffId?: string;

    @ApiPropertyOptional({ description: 'Số bản ghi tối đa trả về', default: 50, minimum: 1, maximum: 200 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(200)
    limit?: number;
}
