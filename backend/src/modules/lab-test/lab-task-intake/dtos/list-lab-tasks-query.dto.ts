import { IsUUID, IsOptional, IsIn, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// 'on_hold': phòng Lab báo cáo không thể tiếp tục thực hiện (mẫu bị từ chối, bệnh nhân không có mặt...).
// Đây KHÔNG phải trạng thái kết thúc — chỉ bác sĩ/module Order mới có quyền quyết định bước tiếp theo
// (huỷ hẳn chỉ định -> 'cancelled', hoặc yêu cầu lấy lại mẫu -> quay về 'ready').
export const LAB_TASK_STATUSES = [
    'payment_pending',
    'ready',
    'in_progress',
    'on_hold',
    'completed',
    'cancelled',
] as const;
export type LabTaskStatus = (typeof LAB_TASK_STATUSES)[number];

/**
 * Worklist của kỹ thuật viên: bắt buộc lọc theo labRoomId vì mỗi kỹ thuật viên
 * chỉ được phân quyền theo phòng chuyên môn của mình (LabStaffRoomAssignment).
 */
export class ListLabTasksQueryDto {
    @ApiPropertyOptional({ description: 'ID phòng Lab cần xem worklist (để trống nếu muốn lấy tất cả phòng)', format: 'uuid' })
    @IsOptional()
    @IsUUID()
    labRoomId?: string;

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
