import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class SuggestDepartmentDto {
  @ApiProperty({
    example: 'Đau bụng dữ dội kèm buồn nôn từ sáng đến giờ',
    description:
      'Mô tả triệu chứng của người đặt lịch (ngôn ngữ tự nhiên) — dùng để gợi ý khoa khám phù hợp, ' +
      'thay vì bắt người đặt lịch (vốn không rành chuyên khoa) phải tự chọn departmentId.',
  })
  @IsString()
  @MinLength(3, { message: 'Vui lòng mô tả triệu chứng chi tiết hơn (tối thiểu 3 ký tự)' })
  @MaxLength(500)
  symptoms: string;
}
