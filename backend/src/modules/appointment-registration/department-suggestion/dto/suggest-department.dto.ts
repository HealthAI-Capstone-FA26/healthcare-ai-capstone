import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class SuggestDepartmentDto {
  @ApiProperty({
    example: 'Đau bụng dữ dội kèm buồn nôn từ sáng đến giờ',
    description:
      'Mô tả triệu chứng của người đặt lịch (ngôn ngữ tự nhiên) — dùng để gợi ý khoa khám phù hợp, ' +
      'thay vì bắt người đặt lịch (vốn không rành chuyên khoa) phải tự chọn departmentId. ' +
      'KHÔNG nhập họ tên, số điện thoại, CCCD vào trường này.',
  })
  @IsString()
  @MinLength(3, { message: 'Vui lòng mô tả triệu chứng chi tiết hơn (tối thiểu 3 ký tự)' })
  @MaxLength(500)
  @Matches(/\p{L}/u, { message: 'Mô tả triệu chứng phải chứa chữ cái' })
  symptoms: string;

  @ApiPropertyOptional({
    example: 4,
    description:
      'Tuổi (năm, có thể lẻ, vd 0.05 ≈ 18 ngày tuổi) của NGƯỜI SẼ ĐI KHÁM — không phải người đặt lịch. ' +
      'Nên truyền từ ngày sinh trong hồ sơ; < 16 tuổi ưu tiên Khoa Nhi/Sơ sinh. Bỏ trống nếu chưa biết.',
    minimum: 0,
    maximum: 120,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(120)
  patientAgeYears?: number;
}

export type SuggestionMethod = 'emergency' | 'keyword' | 'semantic' | 'hybrid' | 'context' | 'fallback';
export type SuggestionConfidence = 'high' | 'medium' | 'low';

export class DepartmentSuggestionResult {
  @ApiProperty() departmentId: string;
  @ApiProperty() departmentCode: string;
  @ApiProperty() departmentName: string;

  @ApiProperty({ description: 'Điểm xếp hạng cuối cùng trong [0, 1]' })
  score: number;

  @ApiProperty({ description: 'Điểm từ khoá thuần (0 nếu không khớp từ khoá)' })
  keywordScore: number;

  @ApiProperty({ description: 'Cosine similarity cao nhất giữa mô tả và các cụm triệu chứng của khoa (0 nếu tắt semantic)' })
  semanticScore: number;

  @ApiProperty({ type: [String] })
  matchedKeywords: string[];

  @ApiProperty({ enum: ['emergency', 'keyword', 'semantic', 'hybrid', 'context', 'fallback'] })
  method: SuggestionMethod;

  @ApiProperty({
    enum: ['high', 'medium', 'low'],
    description:
      'high: có thể tự chọn khoa; medium: nên cho người dùng xác nhận; low/fallback: BẮT BUỘC cho người dùng/lễ tân chọn lại.',
  })
  confidence: SuggestionConfidence;

  @ApiProperty({ description: 'true = phát hiện dấu hiệu nguy hiểm, nên hướng dẫn đi cấp cứu thay vì đặt lịch thường' })
  isEmergency: boolean;

  @ApiPropertyOptional({ description: 'Lý do cấp cứu / thông điệp cần hiển thị cho người dùng (chỉ có khi isEmergency)' })
  advice?: string;

  @ApiProperty({ type: [String], description: 'Giải thích ngắn gọn vì sao khoa này được gợi ý (phục vụ kiểm toán/debug)' })
  reasons: string[];
}
