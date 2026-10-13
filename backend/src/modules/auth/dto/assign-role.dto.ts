import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/**
 * Dùng cho: PUT /admin/users/:userId/role
 */
export class AssignRoleDto {
    @ApiProperty({
        description: 'ID của role muốn gán cho user (sẽ thay thế role hiện tại nếu có)',
        format: 'uuid',
        example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    })
    @IsUUID('4', { message: 'roleId phải là UUID hợp lệ' })
    roleId: string;
}