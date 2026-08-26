import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ServeQueueTicketDto {
  // Bác sĩ được lễ tân chọn/gán lúc tiếp nhận (at_hospital chưa có doctorId từ lúc tạo).
  // Quyết định cho Câu hỏi mở #1 Phase 5: bắt buộc doctor đang có DoctorSchedule active đúng
  // khung giờ hiện tại tại khoa này — không cho lễ tân chọn tự do (xem QueueTicketService.serve).
  @ApiProperty()
  @IsUUID()
  doctorId: string;
}
