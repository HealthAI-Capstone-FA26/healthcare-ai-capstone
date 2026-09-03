import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEmail, IsEnum, IsString, MaxLength, ValidateIf } from 'class-validator';
import { NonSelfRelationshipType } from '../../../../common/constants/relationship.constants';

// Chọn 1 trong 2 kênh nhận OTP để xác thực contact request.
export enum ContactVerifyMethod {
  EMAIL = 'email',
  SMS = 'sms',
}

// Bắt nhập đủ 4 field định danh của patient (không cho chọn 1-trong-nhiều) để
// giảm rủi ro đoán trúng 1-2 field rồi chiếm quyền. Không còn accept/reject —
// verifyMethod quyết định OTP gửi qua đâu để xác thực (xem patient-contact.service.ts).
export class CreateContactRequestDto {
  @ApiProperty({ enum: NonSelfRelationshipType })
  @IsEnum(NonSelfRelationshipType)
  relationship: NonSelfRelationshipType;

  @ApiProperty({ example: 'Nguyễn Văn A' })
  @IsString()
  @MaxLength(255)
  fullName: string;

  @ApiProperty({ example: '1990-05-20' })
  @IsDateString()
  dateOfBirth: string;

  @ApiProperty({ example: '079090001234' })
  @IsString()
  @MaxLength(20)
  identityNumber: string;

  @ApiProperty({ example: '0901234567' })
  @IsString()
  @MaxLength(20)
  phoneNumber: string;

  @ApiProperty({ enum: ContactVerifyMethod, description: 'Chọn kênh nhận OTP: email hoặc sms' })
  @IsEnum(ContactVerifyMethod)
  verifyMethod: ContactVerifyMethod;

  // Bắt buộc khi verifyMethod = email — OTP gửi tới email này (do người gửi request tự nhập,
  // KHÔNG lấy từ patient.email trong DB vì field đó là optional và có thể không tồn tại).
  @ApiPropertyOptional({ example: 'nguoithan@gmail.com' })
  @ValidateIf((dto: CreateContactRequestDto) => dto.verifyMethod === ContactVerifyMethod.EMAIL)
  @IsEmail()
  email?: string;
}
