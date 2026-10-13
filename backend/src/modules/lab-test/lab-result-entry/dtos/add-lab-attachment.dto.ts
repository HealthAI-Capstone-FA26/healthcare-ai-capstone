import { IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const LAB_ATTACHMENT_FILE_TYPES = ['dicom', 'image', 'video', 'pdf', 'raw_export', 'other'] as const;
export type LabAttachmentFileType = (typeof LAB_ATTACHMENT_FILE_TYPES)[number];

export const LAB_ATTACHMENT_ROLES = ['primary', 'key_image', 'cine_loop', 'report', 'printout'] as const;
export type LabAttachmentRole = (typeof LAB_ATTACHMENT_ROLES)[number];

/**
 * Tệp đính kèm kết quả: ảnh X-quang, DICOM, ảnh/cine-loop siêu âm, PDF báo cáo, bản in ECG...
 * Client gửi multipart/form-data kèm field `file` — API tự upload lên MinIO/S3. `fileUrl` chỉ dùng khi KHÔNG có
 * `file` (tệp đã có sẵn trên hệ thống khác). Bắt buộc MỘT trong hai. Vì multipart chỉ gửi chuỗi nên `metadata`
 * là chuỗi JSON (vd '{"view":"PA"}').
 */
export class AddLabAttachmentDto {
    @ApiProperty({ description: 'Loại tệp', enum: LAB_ATTACHMENT_FILE_TYPES })
    @IsIn(LAB_ATTACHMENT_FILE_TYPES)
    fileType: LabAttachmentFileType;

    @ApiPropertyOptional({ description: 'Vai trò của tệp trong kết quả', enum: LAB_ATTACHMENT_ROLES, default: 'primary' })
    @IsOptional()
    @IsIn(LAB_ATTACHMENT_ROLES)
    attachmentRole?: LabAttachmentRole;

    @ApiPropertyOptional({ description: 'URL/object key có sẵn (chỉ khi KHÔNG upload `file`)', maxLength: 255 })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    fileUrl?: string;

    @ApiPropertyOptional({ description: 'MIME type — mặc định lấy từ tệp tải lên', maxLength: 100 })
    @IsOptional()
    @IsString()
    @MaxLength(100)
    mimeType?: string;

    @ApiPropertyOptional({ description: 'Mô tả tệp', maxLength: 255 })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    description?: string;

    @ApiPropertyOptional({
        description: 'Metadata dạng chuỗi JSON. X-quang: {"view":"PA"} · Siêu âm: {"view":"A4C","frameRate":30}',
    })
    @IsOptional()
    @IsString()
    metadata?: string;

    @ApiPropertyOptional({ description: 'Thời điểm chụp/ghi (ISO 8601)' })
    @IsOptional()
    @IsISO8601()
    capturedAt?: string;
}
