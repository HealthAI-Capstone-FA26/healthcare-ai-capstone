import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export enum AllergyType {
  DRUG = 'drug',
  FOOD = 'food',
  ENVIRONMENTAL = 'environmental',
  OTHER = 'other',
}

export enum AllergySeverity {
  MILD = 'mild',
  MODERATE = 'moderate',
  SEVERE = 'severe',
  LIFE_THREATENING = 'life_threatening',
}

export class CreatePatientAllergyDto {
  @ApiProperty({ enum: AllergyType })
  @IsEnum(AllergyType)
  allergyType: AllergyType;

  @ApiProperty({ maxLength: 255 })
  @IsString()
  @MaxLength(255)
  allergenName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reactionDescription?: string;

  @ApiProperty({ enum: AllergySeverity })
  @IsEnum(AllergySeverity)
  severity: AllergySeverity;

  // Ghi hồ sơ dài hạn cho bệnh nhân, không gắn cứng vào 1 lượt khám — chỉ audit lượt khám nào
  // khai báo, nên optional (đúng ghi chú module3.md mục 5).
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  encounterId?: string;
}
