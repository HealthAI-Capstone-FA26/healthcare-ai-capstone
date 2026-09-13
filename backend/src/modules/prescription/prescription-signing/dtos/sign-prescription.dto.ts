import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SignPrescriptionDto {
    @ApiProperty({ description: 'Mật khẩu hiện tại của bác sĩ — dùng để xác thực lại trước khi ký số (giả lập)' })
    @IsString()
    @IsNotEmpty({ message: 'Cần nhập mật khẩu để xác thực trước khi ký số.' })
    password: string;
}
