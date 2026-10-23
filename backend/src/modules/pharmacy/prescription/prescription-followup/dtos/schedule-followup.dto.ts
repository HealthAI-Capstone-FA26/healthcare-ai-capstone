import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class ScheduleFollowupDto {
    @ApiPropertyOptional({
        description:
            'Ngày hẹn tái khám (YYYY-MM-DD hoặc ISO string). Nếu không truyền, hệ thống tự động tính ngày dựa trên duration_days của đơn thuốc hoặc phác đồ điều trị (TreatmentConsultation).',
        example: '2026-11-01',
    })
    @IsOptional()
    @IsDateString()
    appointmentDate?: string;

    @ApiPropertyOptional({
        description: 'Giờ hẹn tái khám (HH:mm hoặc ISO string). Có thể để trống.',
        example: '09:00:00',
    })
    @IsOptional()
    @IsString()
    appointmentTime?: string;

    @ApiPropertyOptional({
        description: 'ID bác sĩ phụ trách tái khám. Mặc định là bác sĩ đang kê đơn.',
    })
    @IsOptional()
    @IsUUID()
    doctorId?: string;

    @ApiPropertyOptional({
        description: 'ID slot khám nếu chọn trước khung giờ (tuỳ chọn)',
    })
    @IsOptional()
    @IsUUID()
    slotId?: string;

    @ApiPropertyOptional({
        description: 'Lý do tái khám. Mặc định: "Tái khám: [Tên chẩn đoán]".',
    })
    @IsOptional()
    @IsString()
    reasonForVisit?: string;

    @ApiPropertyOptional({
        description: 'Mức độ ưu tiên: normal | urgent | emergency',
        default: 'normal',
    })
    @IsOptional()
    @IsString()
    priority?: string;

    @ApiPropertyOptional({
        description:
            'Tự động kết thúc lượt khám hiện tại (chuyển trạng thái encounter sang "finished") sau khi tạo lịch tái khám thành công.',
        default: true,
    })
    @IsOptional()
    @IsBoolean()
    closeEncounter?: boolean = true;
}
