import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PatientGender } from '../../patient/dto/create-patient.dto';
import { AppointmentPriority } from './create-appointment.dto';

// Chọn 1 trong 2 kênh nhận OTP để xác thực việc đặt lịch (giống ContactVerifyMethod bên
// patientContact, tách riêng enum vì đây là 2 luồng nghiệp vụ độc lập).
export enum GuestVerifyMethod {
  EMAIL = 'email',
  SMS = 'sms',
}

// Bước 1: khách vãng lai (chưa có tài khoản) chỉ cần khai SĐT + chọn kênh nhận OTP — CHƯA nhập
// thông tin đặt lịch (fullName/dob/identityNumber/slot...) ở bước này. Toàn bộ thông tin đặt lịch
// được khai đầy đủ ở bước 2 (verify-otp) cùng lúc với mã OTP; Patient/Appointment CHỈ được tạo
// sau khi verify OTP đúng.
export class GuestRequestOtpDto {
  @ApiProperty({ example: '0901234567' })
  @IsString()
  @MaxLength(20)
  phoneNumber: string;

  // Không bắt buộc — NHƯNG bắt buộc phải có nếu chọn verifyMethod = email, vì đây cũng chính là
  // địa chỉ nhận OTP (validate ở service, không dùng @ValidateIf vì field tự tham chiếu chính nó).
  @ApiPropertyOptional({ example: 'guest@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ example: 'Nguyễn Văn A' })
  @IsString()
  @MaxLength(255)
  fullName: string;

  @ApiProperty({ example: '1990-05-20' })
  @IsDateString()
  dateOfBirth: string;

  @ApiProperty({ enum: PatientGender, example: PatientGender.MALE })
  @IsEnum(PatientGender)
  gender: PatientGender;

  @ApiProperty({ example: '079090001234' })
  @IsString()
  @MaxLength(20)
  identityNumber: string;

  @ApiProperty()
  @IsUUID()
  departmentId: string;

  @ApiProperty({
    description: 'Bác sĩ được chọn để đặt lịch; slot phải thuộc bác sĩ này',
    example: '8b7e2f7d-3a2a-4f5f-8f0c-123456789abc',
  })
  @IsUUID()
  doctorId: string;

  @ApiProperty()
  @IsUUID()
  slotId: string;

  @ApiPropertyOptional({ example: 'Đau bụng 2 ngày' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reasonForVisit?: string;

  @ApiPropertyOptional({ enum: AppointmentPriority, default: AppointmentPriority.NORMAL })
  @IsOptional()
  @IsEnum(AppointmentPriority)
  priority?: AppointmentPriority;

  @ApiProperty({
    enum: GuestVerifyMethod,
    description:
      'Chọn kênh nhận OTP: sms (tới phoneNumber) hoặc email (tới field email — bắt buộc phải khai email nếu chọn kênh này)',
  })
  @IsEnum(GuestVerifyMethod)
  verifyMethod: GuestVerifyMethod;
}
