import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ConfirmAlertDto {
    @ApiProperty({
        description: 'Lý do bác sĩ xác nhận đã biết rủi ro và vẫn quyết định giữ nguyên đơn thuốc',
        example: 'Đã cân nhắc lợi ích điều trị lớn hơn nguy cơ tương tác, theo dõi sát bệnh nhân.',
    })
    @IsString()
    @IsNotEmpty({ message: 'Cần nhập lý do override khi xác nhận cảnh báo an toàn.' })
    @MaxLength(2000)
    overrideReason: string;
}
