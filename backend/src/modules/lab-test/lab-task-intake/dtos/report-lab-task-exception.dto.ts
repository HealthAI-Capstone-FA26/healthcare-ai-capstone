import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Lý do phòng Lab KHÔNG THỂ tiếp tục thực hiện một nhiệm vụ xét nghiệm.
 * Đây là ngoại lệ về mặt vận hành (mẫu, bệnh nhân, dữ liệu) — không phải quyết định lâm sàng.
 * Phòng Lab không có thẩm quyền huỷ chỉ định của bác sĩ; nó chỉ báo cáo để bác sĩ/module Order
 * quyết định bước tiếp theo.
 */
export const LAB_TASK_EXCEPTION_REASONS = [
    'specimen_rejected', // mẫu bị từ chối: huyết tán, đông mẫu, thiếu thể tích, sai ống nghiệm/nhãn...
    'patient_unavailable', // bệnh nhân xuất viện/chuyển viện/từ chối lấy mẫu trước khi kịp thực hiện
    'duplicate_order', // trùng lặp với 1 chỉ định khác đã/đang thực hiện
    'equipment_failure', // sự cố thiết bị phòng Lab không thể khắc phục trong thời gian yêu cầu
    'other',
] as const;
export type LabTaskExceptionReason = (typeof LAB_TASK_EXCEPTION_REASONS)[number];

export class ReportLabTaskExceptionDto {
    @ApiProperty({ description: 'Nhóm lý do ngoại lệ', enum: LAB_TASK_EXCEPTION_REASONS })
    @IsIn(LAB_TASK_EXCEPTION_REASONS)
    reasonCode: LabTaskExceptionReason;

    @ApiPropertyOptional({ description: 'Mô tả chi tiết thêm (VD: "Ống nghiệm bị vỡ khi vận chuyển")', maxLength: 255 })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    detail?: string;
}
