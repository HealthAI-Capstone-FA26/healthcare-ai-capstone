import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength } from 'class-validator';

// POST /appointments/sync-patient — chỉ áp dụng cho appointment có suggestedPatientId.
// Lễ tân phải đối chiếu đồng thời CCCD và số điện thoại với patient được gợi ý.
export class SyncPatientDto {
  @ApiProperty()
  @IsUUID()
  appointmentId: string;

  @ApiProperty({ example: '079090001234', description: 'CCCD/CMND cần đối chiếu với hồ sơ được gợi ý' })
  @IsString()
  @MaxLength(20)
  identityNumber: string;

  @ApiProperty({ example: 'Nguyễn Văn A', description: 'Họ tên cần đối chiếu với hồ sơ được gợi ý' })
  @IsString()
  @MaxLength(255)
  fullName: string;

  @ApiProperty({ example: '0901234567', description: 'Số điện thoại cần đối chiếu với hồ sơ được gợi ý' })
  @IsString()
  @MaxLength(20)
  phoneNumber: string;
}
