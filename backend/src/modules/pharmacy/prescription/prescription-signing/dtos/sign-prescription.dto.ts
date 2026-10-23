import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SignPrescriptionDto {
    @ApiProperty({ description: 'Mật khẩu hiện tại của bác sĩ — xác thực lại (re-authentication) trước khi dùng chứng thư số để ký' })
    @IsString()
    @IsNotEmpty({ message: 'Cần nhập mật khẩu để xác thực trước khi ký số.' })
    password: string;
}
