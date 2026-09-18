import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { AppointmentPriority } from './create-appointment.dto';

// doctorId/slotId không có ở bước tạo (gán sau lúc `done`, xem QueueTicketService.done).
// bookingChannel = 'at_hospital' được service tự gán, không nhận từ client.
// departmentId KHÔNG còn bắt buộc: người đặt lịch (đặc biệt bệnh nhân/khách vãng lai, không rành
// chuyên khoa) thường không tự biết mình cần khám khoa nào. Thay vào đó truyền `symptoms` (mô tả
// triệu chứng) để AppointmentService.createAtHospital tự suy ra departmentId qua
// DepartmentSuggestionService. Lễ tân đã biết chắc khoa (vd bệnh nhân tái khám, chỉ định từ tuyến
// dưới...) vẫn có thể truyền thẳng departmentId để bỏ qua bước gợi ý — 2 field không bắt buộc cùng
// lúc nhưng bắt buộc có ÍT NHẤT 1 trong 2 (validate ở service, xem createAtHospital).
export class CreateAtHospitalAppointmentDto {
  @ApiPropertyOptional({ description: 'Dùng khi lễ tân đã biết trực tiếp patientId' })
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiPropertyOptional({
    description:
      'Truyền thẳng khi đã biết chắc khoa khám. Bỏ trống thì bắt buộc phải có `symptoms` để hệ ' +
      'thống tự gợi ý khoa.',
  })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({
    example: 'Đau bụng dữ dội kèm buồn nôn từ sáng đến giờ',
    description:
      'Mô tả triệu chứng — dùng để tự động suy ra departmentId khi không truyền departmentId ' +
      '(bắt buộc nếu departmentId để trống). Nếu reasonForVisit cũng để trống, giá trị này sẽ ' +
      'được dùng luôn làm reasonForVisit.',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  symptoms?: string;

  @ApiPropertyOptional({ example: 'Đau bụng 2 ngày' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reasonForVisit?: string;

  @ApiPropertyOptional({ enum: AppointmentPriority, default: AppointmentPriority.NORMAL })
  @IsOptional()
  @IsEnum(AppointmentPriority)
  priority?: AppointmentPriority;
}