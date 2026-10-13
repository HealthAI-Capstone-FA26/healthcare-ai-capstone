import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    ArrayUnique,
    IsArray,
    IsBoolean,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    Max,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';

/**
 * Cấu trúc dữ liệu của "PHIẾU THĂM KHÁM LÂM SÀNG TIM MẠCH" (mục II.1 Nhìn · II.2 Sờ · II.3 Gõ · II.4 Nghe ·
 * III.1 Nhận định & hội chứng sơ bộ). Mỗi checkbox/radio của phiếu là 1 trường boolean/enum — giá trị enum
 * dùng snake_case tiếng Anh để frontend map 1-1 với phiếu, nhãn tiếng Việt do backend sinh ra khi lưu
 * (xem findings-composer.ts) nên các module khác (timeline, AI review) vẫn đọc được văn bản như cũ.
 */

// ───────────────────────── II.1 NHÌN ─────────────────────────
export const CHEST_SHAPES = ['symmetric', 'deformed_bulging', 'barrel'] as const;

export class SkinMucosaDto {
    @ApiPropertyOptional({ description: 'Bình thường' }) @IsOptional() @IsBoolean() normal?: boolean;
    @ApiPropertyOptional({ description: 'Môi/đầu chi tím tái (nghi suy tim / tim bẩm sinh)' }) @IsOptional() @IsBoolean() cyanosis?: boolean;
    @ApiPropertyOptional({ description: 'Ngón tay dùi trống' }) @IsOptional() @IsBoolean() clubbing?: boolean;
    @ApiPropertyOptional({ description: 'Khác', maxLength: 255 }) @IsOptional() @IsString() @MaxLength(255) other?: string;
}

export class ApexPulsationInspectionDto {
    @ApiPropertyOptional({ description: 'Mỏm tim đập mạnh / diện đập rộng' }) @IsOptional() @IsBoolean() forcefulApex?: boolean;
    @ApiPropertyOptional({ description: 'Nhịp tim yếu / mờ (nghi tràn dịch màng ngoài tim)' }) @IsOptional() @IsBoolean() weakApex?: boolean;
    @ApiPropertyOptional({ description: 'Khối u đập theo nhịp tim ở sườn / sát xương ức (nghi túi phình ĐM chủ)' }) @IsOptional() @IsBoolean() pulsatileMass?: boolean;
}

export class NeckInspectionDto {
    @ApiPropertyOptional({ description: 'Tĩnh mạch cổ nổi' }) @IsOptional() @IsBoolean() jugularVenousDistension?: boolean;
    @ApiPropertyOptional({ description: 'Động mạch chủ / động mạch cổ đập mạnh' }) @IsOptional() @IsBoolean() carotidPulsation?: boolean;
    @ApiPropertyOptional({ description: 'Tuyến giáp to bất thường' }) @IsOptional() @IsBoolean() thyromegaly?: boolean;
}

export class AbdomenInspectionDto {
    @ApiPropertyOptional({ description: 'Vùng thượng vị đập theo nhịp tim' }) @IsOptional() @IsBoolean() epigastricPulsation?: boolean;
    @ApiPropertyOptional({ description: 'Gan to / hạ sườn phải dày' }) @IsOptional() @IsBoolean() hepatomegaly?: boolean;
}

export class InspectionDto {
    @ApiPropertyOptional({ type: SkinMucosaDto }) @IsOptional() @ValidateNested() @Type(() => SkinMucosaDto) skinMucosa?: SkinMucosaDto;
    @ApiPropertyOptional({ enum: CHEST_SHAPES }) @IsOptional() @IsIn(CHEST_SHAPES) chestShape?: (typeof CHEST_SHAPES)[number];
    @ApiPropertyOptional({ description: 'Sẹo mổ cũ (vị trí/kích thước) — để trống nếu không có', maxLength: 255 })
    @IsOptional() @IsString() @MaxLength(255) surgicalScar?: string;
    @ApiPropertyOptional({ type: ApexPulsationInspectionDto }) @IsOptional() @ValidateNested() @Type(() => ApexPulsationInspectionDto) apexPulsation?: ApexPulsationInspectionDto;
    @ApiPropertyOptional({ type: NeckInspectionDto }) @IsOptional() @ValidateNested() @Type(() => NeckInspectionDto) neck?: NeckInspectionDto;
    @ApiPropertyOptional({ type: AbdomenInspectionDto }) @IsOptional() @ValidateNested() @Type(() => AbdomenInspectionDto) abdomen?: AbdomenInspectionDto;
    @ApiPropertyOptional({ description: 'Bất thường khác khi nhìn', maxLength: 1000 }) @IsOptional() @IsString() @MaxLength(1000) other?: string;
}

// ───────────────────────── II.2 SỜ ─────────────────────────
export const APEX_DYNAMICS = ['normal', 'forceful_displaced', 'retraction', 'indistinct'] as const;
export const THRILL_LOCATIONS = ['apex', 'base', 'left_sternal_border', 'other'] as const;
export const THRILL_CYCLES = ['systolic', 'diastolic', 'continuous'] as const;
export const HARTZER_RESULTS = ['positive', 'negative'] as const;

export class ApexPalpationDto {
    @ApiPropertyOptional({ description: 'Khoang liên sườn, VD: 5', maxLength: 20 }) @IsOptional() @IsString() @MaxLength(20) intercostalSpace?: string;
    @ApiPropertyOptional({ description: 'Đường, VD: trung đòn trái', maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) line?: string;
    @ApiPropertyOptional({ enum: APEX_DYNAMICS, description: 'Bình thường | Đập mạnh nảy xa | Co kéo | Đập không rõ' })
    @IsOptional() @IsIn(APEX_DYNAMICS) dynamics?: (typeof APEX_DYNAMICS)[number];
}

export class ThrillDto {
    @ApiPropertyOptional({ description: 'false = Không có rung miêu; true = Có (bắt buộc kèm location + cycle)' })
    @IsBoolean() present: boolean;
    @ApiPropertyOptional({ enum: THRILL_LOCATIONS }) @IsOptional() @IsIn(THRILL_LOCATIONS) location?: (typeof THRILL_LOCATIONS)[number];
    @ApiPropertyOptional({ description: 'Bắt buộc khi location = other', maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) locationOther?: string;
    @ApiPropertyOptional({ enum: THRILL_CYCLES }) @IsOptional() @IsIn(THRILL_CYCLES) cycle?: (typeof THRILL_CYCLES)[number];
}

export class PalpationDto {
    @ApiPropertyOptional({ type: ApexPalpationDto }) @IsOptional() @ValidateNested() @Type(() => ApexPalpationDto) apex?: ApexPalpationDto;
    @ApiPropertyOptional({ type: ThrillDto }) @IsOptional() @ValidateNested() @Type(() => ThrillDto) thrill?: ThrillDto;
    @ApiPropertyOptional({ enum: HARTZER_RESULTS, description: 'Dấu hiệu Hartzer' }) @IsOptional() @IsIn(HARTZER_RESULTS) hartzerSign?: (typeof HARTZER_RESULTS)[number];
    @ApiPropertyOptional({ description: 'Bất thường khác khi sờ', maxLength: 1000 }) @IsOptional() @IsString() @MaxLength(1000) other?: string;
}

// ───────────────────────── II.3 GÕ ─────────────────────────
export const CARDIAC_DULLNESS = ['normal', 'left_enlarged', 'right_enlarged', 'global_enlarged', 'other'] as const;

export class PercussionDto {
    @ApiPropertyOptional({
        enum: CARDIAC_DULLNESS,
        description: 'Diện đục của tim: bình thường | giãn sang trái | giãn sang phải | giãn toàn bộ / hình bầu rượu | khác',
    })
    @IsOptional() @IsIn(CARDIAC_DULLNESS) cardiacDullness?: (typeof CARDIAC_DULLNESS)[number];
    @ApiPropertyOptional({ description: 'Mô tả thêm / nội dung khi cardiacDullness = other', maxLength: 1000 })
    @IsOptional() @IsString() @MaxLength(1000) other?: string;
}

// ───────────────────────── II.4 NGHE ─────────────────────────
export const HEART_RHYTHMS = ['regular', 'irregular', 'completely_irregular', 'extrasystoles'] as const;
export const SOUND_ABNORMALITIES = ['muffled', 'loud', 'split'] as const;

export class HeartSoundsDto {
    @ApiPropertyOptional({ description: 'T1, T2 bình thường' }) @IsOptional() @IsBoolean() normal?: boolean;
    @ApiPropertyOptional({ enum: SOUND_ABNORMALITIES, description: 'T1: mờ | đanh | tách đôi' }) @IsOptional() @IsIn(SOUND_ABNORMALITIES) s1?: (typeof SOUND_ABNORMALITIES)[number];
    @ApiPropertyOptional({ enum: SOUND_ABNORMALITIES, description: 'T2: mờ | đanh/mạnh | tách đôi' }) @IsOptional() @IsIn(SOUND_ABNORMALITIES) s2?: (typeof SOUND_ABNORMALITIES)[number];
}

export class MurmurDto {
    @ApiPropertyOptional({ description: 'Cường độ x/6', minimum: 1, maximum: 6 }) @IsInt() @Min(1) @Max(6) grade: number;
    @ApiPropertyOptional({ description: 'Hướng lan', maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) radiation?: string;
}

export class MurmursDto {
    @ApiPropertyOptional({ description: 'Không phát hiện tiếng thổi' }) @IsOptional() @IsBoolean() none?: boolean;
    @ApiPropertyOptional({ type: MurmurDto }) @IsOptional() @ValidateNested() @Type(() => MurmurDto) systolic?: MurmurDto;
    @ApiPropertyOptional({ type: MurmurDto }) @IsOptional() @ValidateNested() @Type(() => MurmurDto) diastolic?: MurmurDto;
    @ApiPropertyOptional({ description: 'Tiếng thổi liên tục' }) @IsOptional() @IsBoolean() continuous?: boolean;
    @ApiPropertyOptional({ description: 'Tiếng cọ màng tim' }) @IsOptional() @IsBoolean() pericardialRub?: boolean;
    @ApiPropertyOptional({ description: 'Tiếng T3 / T4 (nhịp ngựa phi)' }) @IsOptional() @IsBoolean() gallop?: boolean;
    @ApiPropertyOptional({ description: 'Bất thường khác', maxLength: 1000 }) @IsOptional() @IsString() @MaxLength(1000) other?: string;
}

export class AuscultationDto {
    @ApiPropertyOptional({ description: 'Tần số tim (lần/phút)', minimum: 20, maximum: 300 }) @IsOptional() @IsInt() @Min(20) @Max(300) heartRate?: number;
    @ApiPropertyOptional({ enum: HEART_RHYTHMS }) @IsOptional() @IsIn(HEART_RHYTHMS) rhythm?: (typeof HEART_RHYTHMS)[number];
    @ApiPropertyOptional({ type: HeartSoundsDto }) @IsOptional() @ValidateNested() @Type(() => HeartSoundsDto) heartSounds?: HeartSoundsDto;
    @ApiPropertyOptional({ type: MurmursDto }) @IsOptional() @ValidateNested() @Type(() => MurmursDto) murmurs?: MurmursDto;
}

// ───────────────────────── III.1 NHẬN ĐỊNH ─────────────────────────
export const CLINICAL_SYNDROMES = [
    'heart_failure_left',
    'heart_failure_right',
    'heart_failure_global',
    'valvular_disease',
    'pericardial_effusion_watch',
    'aortic_aneurysm_watch',
    'arrhythmia',
] as const;

export class AssessmentDto {
    @ApiPropertyOptional({ enum: CLINICAL_SYNDROMES, isArray: true, description: 'Hội chứng / tình trạng ghi nhận (checkbox mục III.1)' })
    @IsOptional() @IsArray() @ArrayUnique() @IsIn(CLINICAL_SYNDROMES, { each: true }) syndromes?: (typeof CLINICAL_SYNDROMES)[number][];
    @ApiPropertyOptional({ description: 'Hội chứng khác', maxLength: 255 }) @IsOptional() @IsString() @MaxLength(255) syndromeOther?: string;
    @ApiPropertyOptional({ description: 'Tóm tắt diễn tiến & đánh giá sơ bộ' }) @IsOptional() @IsString() @MaxLength(5000) summary?: string;
}

/** Gói tất cả các mục của phiếu. Mỗi mục là tuỳ chọn; mục nào gửi lên sẽ GHI ĐÈ nguyên mục đó, mục không gửi giữ nguyên. */
export class StructuredExaminationDto {
    @ApiPropertyOptional({ type: InspectionDto }) @IsOptional() @ValidateNested() @Type(() => InspectionDto) inspection?: InspectionDto;
    @ApiPropertyOptional({ type: PalpationDto }) @IsOptional() @ValidateNested() @Type(() => PalpationDto) palpation?: PalpationDto;
    @ApiPropertyOptional({ type: PercussionDto }) @IsOptional() @ValidateNested() @Type(() => PercussionDto) percussion?: PercussionDto;
    @ApiPropertyOptional({ type: AuscultationDto }) @IsOptional() @ValidateNested() @Type(() => AuscultationDto) auscultation?: AuscultationDto;
    @ApiPropertyOptional({ type: AssessmentDto }) @IsOptional() @ValidateNested() @Type(() => AssessmentDto) assessment?: AssessmentDto;
}

export const STRUCTURED_SECTIONS = ['inspection', 'palpation', 'percussion', 'auscultation', 'assessment'] as const;
export type StructuredSection = (typeof STRUCTURED_SECTIONS)[number];
