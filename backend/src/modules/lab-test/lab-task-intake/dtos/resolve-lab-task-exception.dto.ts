import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Quyết định của bác sĩ (qua module Order) sau khi phòng Lab báo cáo ngoại lệ
 * (xem ReportLabTaskExceptionDto / LabTaskExceptionReportedEvent) và task đang 'on_hold':
 *
 *   - 'retry'  : yêu cầu lấy lại mẫu / thực hiện lại — task quay về 'ready' để phòng Lab
 *                tiếp nhận như một lượt mới. KHÔNG coi là huỷ chỉ định.
 *   - 'cancel' : bác sĩ xác nhận không cần xét nghiệm này nữa — task chuyển 'cancelled',
 *                dùng lại đúng một đường xử lý với `applyCancellationFromOrder`
 *                (cùng logic sẽ chạy khi module Order emit OrderItemCancelledEvent thật sự).
 */
export const LAB_TASK_EXCEPTION_RESOLUTIONS = ['retry', 'cancel'] as const;
export type LabTaskExceptionResolution = (typeof LAB_TASK_EXCEPTION_RESOLUTIONS)[number];

export class ResolveLabTaskExceptionDto {
    @ApiProperty({ description: 'Quyết định của bác sĩ đối với ngoại lệ đã báo cáo', enum: LAB_TASK_EXCEPTION_RESOLUTIONS })
    @IsIn(LAB_TASK_EXCEPTION_RESOLUTIONS)
    decision: LabTaskExceptionResolution;

    @ApiPropertyOptional({ description: 'Ghi chú của bác sĩ kèm theo quyết định', maxLength: 255 })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    reason?: string;
}
