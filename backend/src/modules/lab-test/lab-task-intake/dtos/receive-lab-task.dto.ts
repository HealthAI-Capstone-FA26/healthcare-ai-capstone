import { IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * TODO: khi có auth module, bỏ field này và lấy kỹ thuật viên thực hiện từ req.user (JWT).
 */
export class ReceiveLabTaskDto {
    @ApiPropertyOptional({
        description:
            'ID kỹ thuật viên tiếp nhận. Nếu nhiệm vụ chưa được gán trước đó, hệ thống sẽ gán luôn người này.',
        format: 'uuid',
    })
    @IsOptional()
    @IsUUID()
    receivingLabStaffId?: string;
}
