import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateDoctorDto } from './create-doctor.dto';

// Bỏ email/password/phoneNumber vì đây là field tạo tài khoản User, không thuộc bảng doctors.
export class UpdateDoctorDto extends PartialType(
  OmitType(CreateDoctorDto, ['email', 'password', 'phoneNumber'] as const),
) {}