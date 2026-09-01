import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class ServeQueueTicketDto {
  // Bắt buộc CHỈ KHI appointment chưa có doctorId (at_hospital — lễ tân chọn/gán lúc tiếp nhận).
  // Với online đã chọn bác sĩ từ lúc đặt lịch, để trống — service tự dùng đúng bác sĩ đã đặt
  // (xem QueueTicketService.done), tránh lễ tân gõ nhầm đổi sang bác sĩ khác ý bệnh nhân.
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  doctorId?: string;
}
