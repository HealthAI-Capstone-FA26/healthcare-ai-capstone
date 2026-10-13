import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const ECG_RECORDING_TYPES = ['resting_12_lead', 'continuous_monitoring', 'holter', 'rhythm_strip'] as const;
export const ECG_SIGNAL_FORMATS = ['wfdb', 'edf', 'csv', 'json', 'dicom_ecg', 'scp_ecg'] as const;

/** multipart chỉ gửi chuỗi: nhận mảng JSON '["I","II"]' hoặc danh sách 'I,II,III'. */
const toStringArray = ({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
        try {
            return JSON.parse(trimmed);
        } catch {
            return value;
        }
    }
    return trimmed === '' ? [] : trimmed.split(',').map((s) => s.trim());
};

const toBoolean = ({ value }: { value: unknown }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value);

/**
 * Tải lên 1 bản ghi ECG hoàn chỉnh (recordingMode = file_upload) cho nhiệm vụ ECG đang 'in_progress'.
 * Gửi multipart/form-data: field `file` + các field dưới đây (đều là chuỗi trong multipart).
 */
export class CreateEcgRecordingDto {
    @ApiProperty({ enum: ECG_RECORDING_TYPES })
    @IsIn(ECG_RECORDING_TYPES)
    recordingType: (typeof ECG_RECORDING_TYPES)[number];

    @ApiProperty({
        enum: ECG_SIGNAL_FORMATS,
        description: 'Định dạng tệp — phần mở rộng phải khớp: csv→.csv, json→.json, edf→.edf, wfdb→.zip (.hea+.dat), dicom_ecg→.dcm, scp_ecg→.scp',
    })
    @IsIn(ECG_SIGNAL_FORMATS)
    signalFormat: (typeof ECG_SIGNAL_FORMATS)[number];

    @ApiProperty({ description: 'Tần số lấy mẫu (Hz)', minimum: 50, maximum: 4000, example: 500 })
    @Type(() => Number)
    @IsInt()
    @Min(50)
    @Max(4000)
    sampleRateHz: number;

    @ApiProperty({ description: 'Số chuyển đạo', minimum: 1, maximum: 12, example: 12 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(12)
    numLeads: number;

    @ApiPropertyOptional({ description: "Tên chuyển đạo: 'I,II,III,aVR,aVL,aVF,V1,V2,V3,V4,V5,V6' hoặc mảng JSON. Nếu có, độ dài phải bằng numLeads.", type: String })
    @IsOptional()
    @Transform(toStringArray)
    @IsArray()
    @ArrayMaxSize(12)
    @IsString({ each: true })
    leadNames?: string[];

    @ApiPropertyOptional({ description: 'Thời lượng bản ghi (ms)' })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    durationMs?: number;

    @ApiPropertyOptional({ description: 'Thời điểm bắt đầu ghi (ISO 8601)' })
    @IsOptional()
    @IsISO8601()
    startedAt?: string;

    @ApiPropertyOptional({ description: 'Thời điểm kết thúc ghi (ISO 8601)' })
    @IsOptional()
    @IsISO8601()
    endedAt?: string;

    @ApiPropertyOptional({ maxLength: 100 })
    @IsOptional()
    @IsString()
    @MaxLength(100)
    deviceModel?: string;

    @ApiPropertyOptional({ maxLength: 100 })
    @IsOptional()
    @IsString()
    @MaxLength(100)
    deviceSerial?: string;

    @ApiPropertyOptional({ description: 'Chuỗi JSON: gain, filter, units, độ phân giải ADC...' })
    @IsOptional()
    @IsString()
    acquisitionMeta?: string;

    @ApiPropertyOptional({ description: 'Tự xếp hàng phân tích AI sau khi lưu (mặc định true)', default: true })
    @IsOptional()
    @Transform(toBoolean)
    @IsBoolean()
    autoAnalyze?: boolean;
}
