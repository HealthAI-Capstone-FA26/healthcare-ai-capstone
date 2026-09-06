import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AssignLabStaffToRoomDto {
    @ApiProperty({ description: 'ID người dùng (kỹ thuật viên) cần phân công vào phòng Lab', format: 'uuid' })
    @IsUUID()
    userId: string;

    @ApiPropertyOptional({
        description: 'Đây có phải phòng chính của kỹ thuật viên hay không (mặc định true)',
        default: true,
    })
    @IsOptional()
    @IsBoolean()
    isPrimary?: boolean;
}
