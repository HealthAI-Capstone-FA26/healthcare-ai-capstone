import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DepartmentSuggestionService } from './department-suggestion.service';
import { SuggestDepartmentDto } from './dto/suggest-department.dto';

// Không gắn JwtAuthGuard: bệnh nhân đặt lịch online (đã đăng nhập), khách vãng lai (guest, chưa
// đăng nhập, xem GuestAppointmentController) và cả lễ tân tại quầy đều cần gọi được API này —
// thường là NGAY TRƯỚC KHI biết mình/bệnh nhân cần khám khoa nào, nên phải public.
//
// VÌ endpoint public + có thể gọi API embedding trả phí bên thứ 3, BẮT BUỘC đặt rate-limit theo IP
// (vd. @nestjs/throttler ~10 req/phút/IP) ở tầng gateway hoặc guard toàn cục — xem REVIEW.md.
@ApiTags('Department Suggestion')
@Controller('department-suggestion')
export class DepartmentSuggestionController {
  constructor(private readonly departmentSuggestionService: DepartmentSuggestionService) {}

  @Post()
  @HttpCode(HttpStatus.OK) // đây là truy vấn gợi ý, không tạo tài nguyên nào -> 200 thay vì 201
  @ApiOperation({
    summary:
      'Gợi ý (các) khoa khám phù hợp dựa trên mô tả triệu chứng. Kết hợp: (1) lớp cảnh báo cấp cứu, ' +
      '(2) keyword search theo token trên từ khoá curate sẵn của từng khoa, (3) ngữ cảnh tuổi/nhi khoa, ' +
      '(4) semantic search (Gemini embedding, bật qua env DEPARTMENT_SUGGESTION_EMBEDDING_PROVIDER=gemini) để bắt ' +
      'diễn đạt tự do/đồng nghĩa. Kết quả chỉ là GỢI Ý điều hướng, không phải chẩn đoán: client phải xử lý ' +
      '`isEmergency` (hiển thị `advice`) và `confidence` (low/fallback => cho người dùng chọn lại). ' +
      'Được gọi ngầm bởi POST /appointments/at-hospital khi lễ tân không truyền sẵn departmentId.',
  })
  suggest(@Body() dto: SuggestDepartmentDto) {
    return this.departmentSuggestionService.suggest(dto.symptoms, undefined, {
      patientAgeYears: dto.patientAgeYears,
    });
  }
}
