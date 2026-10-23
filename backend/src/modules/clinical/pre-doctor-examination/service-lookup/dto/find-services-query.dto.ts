import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const SERVICE_MODALITIES = ['blood_test', 'ecg', 'xray', 'echo'] as const;
export type ServiceModality = (typeof SERVICE_MODALITIES)[number];

export class FindServicesQueryDto {
    @ApiPropertyOptional({ enum: SERVICE_MODALITIES, description: 'Lọc theo loại cận lâm sàng' })
    @IsOptional()
    @IsIn(SERVICE_MODALITIES)
    modality?: ServiceModality;

    @ApiPropertyOptional({ description: 'Nhóm dịch vụ, VD: cardiac_biomarker | lipid_profile | resting_ecg | tte | chest_xray' })
    @IsOptional()
    @IsString()
    @MaxLength(50)
    panelGroup?: string;

    @ApiPropertyOptional({ description: 'Tìm theo tên hoặc mã dịch vụ' })
    @IsOptional()
    @IsString()
    @MaxLength(100)
    q?: string;
}
