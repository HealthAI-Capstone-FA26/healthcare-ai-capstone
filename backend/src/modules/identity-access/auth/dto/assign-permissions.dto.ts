import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, ArrayUnique, IsUUID } from 'class-validator';

/**
 * Dùng cho:
 *  - POST /admin/roles/:roleId/permissions  (thêm permissions vào role, giữ nguyên cái cũ)
 *  - PUT  /admin/roles/:roleId/permissions  (set lại toàn bộ danh sách permissions của role)
 */
export class AssignPermissionsDto {
    @ApiProperty({
        description: 'Danh sách permissionId cần gán cho role',
        type: [String],
        format: 'uuid',
        example: [
            '3fa85f64-5717-4562-b3fc-2c963f66afa6',
            '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        ],
    })
    @ArrayNotEmpty({ message: 'permissionIds không được rỗng' })
    @ArrayUnique({ message: 'permissionIds không được trùng lặp' })
    @IsUUID('4', { each: true, message: 'permissionIds phải là UUID hợp lệ' })
    permissionIds: string[];
}