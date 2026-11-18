import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

// Schema v2: dị ứng lưu dạng 1 chuỗi text theo nhóm — nhóm ngăn cách bằng ';', mục trong nhóm ngăn cách bằng ',':
//   "[DRUG] drugA, drugB; [FOOD] foodA, foodB; [ENVIRONMENT] envA, envB"
// Mỗi bản ghi là TOÀN BỘ danh sách tại thời điểm ghi nhận (không phải phần bổ sung); bản ghi mới nhất
// có status = active là danh sách hiện hành.
export class CreatePatientAllergyDto {
  @ApiProperty({
    example: '[DRUG] penicillin, aspirin; [FOOD] tôm; [ENVIRONMENT] phấn hoa',
    description: 'Toàn bộ danh sách dị ứng hiện tại, theo định dạng "[NHÓM] mục1, mục2; [NHÓM] mục3"',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  allergyText: string;
}
