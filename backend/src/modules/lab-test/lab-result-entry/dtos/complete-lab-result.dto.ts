import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Hoàn tất kết quả dạng báo cáo hình ảnh (siêu âm tim, X-quang ngực).
 * Mặc định yêu cầu đã có ít nhất 1 tệp hình ảnh (dicom/image/video). Trường hợp thật sự không có hình
 * (hỏng máy, bệnh nhân không thể chụp…) phải nêu lý do bằng `noImageReason` — lý do được ghi vào `findings`.
 */
export class CompleteLabResultDto {
    @ApiPropertyOptional({
        description: 'Lý do hoàn tất mà KHÔNG có hình ảnh đính kèm (bắt buộc nếu chưa có tệp hình nào). Tối thiểu 10 ký tự.',
        minLength: 10,
        maxLength: 200,
    })
    @IsOptional()
    @IsString()
    @MinLength(10)
    @MaxLength(200)
    noImageReason?: string;
}
