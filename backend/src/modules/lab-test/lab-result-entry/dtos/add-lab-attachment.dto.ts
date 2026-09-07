import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const LAB_ATTACHMENT_FILE_TYPES = ['pdf', 'raw_export', 'image', 'other'] as const;
export type LabAttachmentFileType = (typeof LAB_ATTACHMENT_FILE_TYPES)[number];

/**
 * Tệp/hình ảnh đính kèm kết quả (VD: phim X-quang, kết quả máy sinh hoá dạng PDF).
 * Việc upload vật lý (lên S3/storage) được xử lý ở tầng trước khi gọi API này —
 * DTO chỉ nhận URL cuối cùng của file đã lưu trữ.
 */
export class AddLabAttachmentDto {
    @ApiProperty({ description: 'Loại tệp đính kèm', enum: LAB_ATTACHMENT_FILE_TYPES })
    @IsIn(LAB_ATTACHMENT_FILE_TYPES)
    fileType: LabAttachmentFileType;

    @ApiProperty({ description: 'URL tệp đã lưu trữ (storage/CDN)', maxLength: 255 })
    @IsString()
    @MaxLength(255)
    fileUrl: string;

    @ApiPropertyOptional({ description: 'Mô tả tệp đính kèm', maxLength: 255 })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    description?: string;
}
