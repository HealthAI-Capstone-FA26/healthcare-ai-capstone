import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, MaxLength } from 'class-validator';
import { NonSelfRelationshipType } from '../../../common/constants/relationship.constants';

// Bắt buộc cả identityNumber lẫn phoneNumber (không cho chọn 1-trong-2) để giảm
// rủi ro đoán trúng 1 field rồi chiếm quyền — xem Phase 4 mục "Yêu cầu làm người thân".
export class CreateContactRequestDto {
  @ApiProperty({ enum: NonSelfRelationshipType })
  @IsEnum(NonSelfRelationshipType)
  relationship: NonSelfRelationshipType;

  @ApiProperty({ example: '079090001234' })
  @IsString()
  @MaxLength(20)
  identityNumber: string;

  @ApiProperty({ example: '0901234567' })
  @IsString()
  @MaxLength(20)
  phoneNumber: string;
}
