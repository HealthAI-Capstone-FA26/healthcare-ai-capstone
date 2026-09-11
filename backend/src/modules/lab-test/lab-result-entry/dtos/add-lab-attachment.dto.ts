import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const LAB_ATTACHMENT_FILE_TYPES = ['pdf', 'raw_export', 'image', 'other'] as const;
export type LabAttachmentFileType = (typeof LAB_ATTACHMENT_FILE_TYPES)[number];

/**
 * Tệp/hình ảnh đính kèm kết quả (VD: phim X-quang, kết quả máy sinh hoá dạng PDF).
 * Client gửi multipart/form-data kèm field `file` — API tự upload lên S3 (xem
 * LabResultController.addAttachment / LabResultService.addAttachment).
 * `fileUrl` chỉ dùng cho trường hợp không có file đính kèm trực tiếp (VD: link tới
 * kết quả raw_export đã có sẵn trên hệ thống máy xét nghiệm) — bắt buộc phải có
 * MỘT trong hai: `file` (multipart) hoặc `fileUrl`.
 */
export class AddLabAttachmentDto {
    @ApiProperty({ description: 'Loại tệp đính kèm', enum: LAB_ATTACHMENT_FILE_TYPES })
    @IsIn(LAB_ATTACHMENT_FILE_TYPES)
    fileType: LabAttachmentFileType;

    @ApiPropertyOptional({
        description: 'URL tệp đã lưu trữ sẵn (chỉ dùng khi KHÔNG upload file trực tiếp qua field `file`)',
        maxLength: 255,
    })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    fileUrl?: string;

    @ApiPropertyOptional({ description: 'Mô tả tệp đính kèm', maxLength: 255 })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    description?: string;
}