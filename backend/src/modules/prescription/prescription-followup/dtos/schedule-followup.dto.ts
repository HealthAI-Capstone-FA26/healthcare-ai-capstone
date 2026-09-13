import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/**
 * LƯU Ý QUAN TRỌNG (khác với plan ban đầu — đã kiểm tra AppointmentService thật trước khi
 * code, đúng tinh thần "đọc code trước khi lên plan"):
 *
 * `AppointmentService.createAtHospital()` hiện tại là luồng "khám tại viện" kiểu walk-in:
 * LUÔN đặt `appointmentDate = hôm nay` và phát ngay 1 QueueTicket trong cùng transaction
 * (xem comment "Luôn tạo kèm đúng 1 QueueTicket... không tách rời 2 bước" trong service đó).
 * Nó KHÔNG nhận `appointmentDate` tương lai, và cũng không nhận `doctorId` cố định trước
 * (doctorId chỉ được gán sau ở bước QueueTicketService.done()).
 *
 * Vì kế hoạch gốc yêu cầu "không viết lại logic đặt lịch/khoá slot", DTO này KHÔNG có field
 * `appointmentDate`/`doctorId` như plan phác thảo ban đầu — nhận field đó rồi âm thầm bỏ qua
 * sẽ gây hiểu lầm cho FE. Lịch tái khám tạo ra ở đây là 1 lượt "tái khám tại viện, lấy số hôm
 * nay" (giống hệt nghiệp vụ tại quầy lễ tân), không phải lịch hẹn ngày giờ cụ thể trong tương
 * lai. Muốn đặt lịch tái khám cho 1 ngày cụ thể trong tương lai với bác sĩ chỉ định, cần dùng
 * luồng online (`AppointmentService.createOnline` + chọn AppointmentSlot) — nhưng luồng đó lại
 * yêu cầu đã có PatientContact được duyệt giữa user đặt và patient, không phù hợp với việc bác
 * sĩ đặt hộ ngay tại phòng khám. Đây là điểm cần đội dự án quyết định thêm nếu muốn hỗ trợ đặt
 * lịch tái khám ngày tương lai thật sự.
 */
export class ScheduleFollowupDto {
    @ApiPropertyOptional({
        description: 'Khoa tái khám. Mặc định lấy departmentId của encounter gốc nếu không truyền.',
    })
    @IsOptional()
    @IsUUID()
    departmentId?: string;
}
