import { IsUUID, IsOptional, IsIn, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

// 'on_hold': phòng thực hiện báo cáo không thể tiếp tục (mẫu bị từ chối, bệnh nhân không có mặt...).
// KHÔNG phải trạng thái kết thúc — chỉ bác sĩ mới quyết định bước tiếp theo (huỷ -> 'cancelled', lấy lại mẫu -> 'ready').
export const LAB_TASK_STATUSES = [
    'payment_pending',
    'ready',
    'in_progress',
    'on_hold',
    'completed',
    'cancelled',
] as const;
export type LabTaskStatus = (typeof LAB_TASK_STATUSES)[number];

export const LAB_TASK_MODALITIES = ['blood_test', 'ecg', 'xray', 'echo'] as const;
export const LAB_TASK_PRIORITIES = ['routine', 'urgent', 'stat'] as const;

/**
 * Worklist của phòng cận lâm sàng: kỹ thuật viên chỉ được phân quyền theo phòng
 * (DiagnosticStaffRoomAssignment). Sắp xếp: stat > urgent > routine, rồi theo thời điểm vào hàng đợi (readyAt).
 */
export class ListLabTasksQueryDto {
    @ApiPropertyOptional({ description: 'ID phòng cần xem worklist (bỏ trống = tất cả phòng)', format: 'uuid' })
    @IsOptional()
    @IsUUID()
    diagnosticRoomId?: string;

    @ApiPropertyOptional({ description: 'Lọc theo loại cận lâm sàng', enum: LAB_TASK_MODALITIES })
    @IsOptional()
    @IsIn(LAB_TASK_MODALITIES)
    modality?: (typeof LAB_TASK_MODALITIES)[number];

    @ApiPropertyOptional({ description: 'Lọc theo trạng thái nhiệm vụ', enum: LAB_TASK_STATUSES })
    @IsOptional()
    @IsIn(LAB_TASK_STATUSES)
    status?: LabTaskStatus;

    @ApiPropertyOptional({ description: 'Lọc theo độ ưu tiên', enum: LAB_TASK_PRIORITIES })
    @IsOptional()
    @IsIn(LAB_TASK_PRIORITIES)
    priority?: (typeof LAB_TASK_PRIORITIES)[number];

    @ApiPropertyOptional({ description: 'Lọc theo kỹ thuật viên được phân công (User.userId)', format: 'uuid' })
    @IsOptional()
    @IsUUID()
    assignedStaffUserId?: string;

    @ApiPropertyOptional({ description: 'Số bản ghi tối đa trả về', default: 200, minimum: 1, maximum: 200 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(200)
    limit?: number;
}
