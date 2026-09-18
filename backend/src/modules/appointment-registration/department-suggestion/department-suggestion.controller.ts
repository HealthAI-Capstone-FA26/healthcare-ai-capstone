import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DepartmentSuggestionService } from './department-suggestion.service';
import { SuggestDepartmentDto } from './dto/suggest-department.dto';

// Không gắn JwtAuthGuard: bệnh nhân đặt lịch online (đã đăng nhập), khách vãng lai (guest, chưa
// đăng nhập, xem GuestAppointmentController) và cả lễ tân tại quầy đều cần gọi được API này —
// thường là NGAY TRƯỚC KHI biết mình/bệnh nhân cần khám khoa nào, nên phải public.
@ApiTags('Department Suggestion')
@Controller('department-suggestion')
export class DepartmentSuggestionController {
  constructor(private readonly departmentSuggestionService: DepartmentSuggestionService) {}

  @Post()
  @ApiOperation({
    summary:
      'Gợi ý (các) khoa khám phù hợp dựa trên mô tả triệu chứng, kết hợp keyword search (từ khoá ' +
      'curate sẵn theo khoa) và semantic search (embedding OpenAI/Gemini, bật qua env ' +
      'DEPARTMENT_SUGGESTION_EMBEDDING_PROVIDER) để bắt được cả câu chữ đúng từ khoá lẫn diễn đạt ' +
      'tự do/đồng nghĩa. Dùng ở flow online trước khi chọn bác sĩ/slot (vì slot phụ thuộc khoa), ' +
      'hoặc được gọi ngầm bởi POST /appointments/at-hospital khi lễ tân không truyền sẵn ' +
      'departmentId (xem AppointmentService.createAtHospital).',
  })
  suggest(@Body() dto: SuggestDepartmentDto) {
    return this.departmentSuggestionService.suggest(dto.symptoms);
  }
}
