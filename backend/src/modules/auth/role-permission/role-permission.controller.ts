import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
    Post,
    Put,
    UseGuards,
} from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiForbiddenResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiTags,
    ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { AdminRbacService } from './role-permission.service';
import { AssignPermissionsDto } from '../dto/assign-permissions.dto';
import { AssignRoleDto } from '../dto/assign-role.dto';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';

@ApiTags('Admin - RBAC')
@ApiBearerAuth() // đổi tên security scheme cho khớp với SwaggerModule.setup(...) nếu bạn dùng addBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'Chưa đăng nhập / token không hợp lệ' })
@ApiForbiddenResponse({ description: 'Không đủ quyền thực hiện thao tác' })
@Controller('admin')
// @UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminRbacController {
    constructor(private readonly adminRbacService: AdminRbacService) { }

    // ============================================================
    // ROLE <-> PERMISSION
    // ============================================================

    @ApiOperation({ summary: 'Lấy danh sách tất cả permissions khả dụng trong hệ thống' })
    @ApiOkResponse({ description: 'Danh sách tất cả permissions' })
    @Get('permissions')
    listAllPermissions() {
        return this.adminRbacService.listAllPermissions();
    }

    @ApiOperation({ summary: 'Lấy danh sách tất cả role kèm permissions' })
    @ApiOkResponse({ description: 'Danh sách role kèm permissions' })
    @RequirePermissions('role:read:all')
    @Get('roles')
    listRoles() {
        return this.adminRbacService.listRolesWithPermissions();
    }

    @ApiOperation({ summary: 'Lấy danh sách permissions hiện tại của 1 role' })
    @ApiParam({ name: 'roleId', format: 'uuid', description: 'ID của role' })
    @ApiOkResponse({ description: 'Danh sách permissions của role' })
    @ApiNotFoundResponse({ description: 'Không tìm thấy role' })
    @RequirePermissions('role:read:all')
    @Get('roles/:roleId/permissions')
    getRolePermissions(@Param('roleId', ParseUUIDPipe) roleId: string) {
        return this.adminRbacService.getRolePermissions(roleId);
    }

    @ApiOperation({
        summary: 'Thêm permissions vào role',
        description: 'Giữ nguyên các permissions cũ, chỉ thêm các permission mới trong danh sách truyền vào.',
    })
    @ApiParam({ name: 'roleId', format: 'uuid', description: 'ID của role' })
    @ApiOkResponse({ description: 'Danh sách permissions của role sau khi thêm' })
    @ApiNotFoundResponse({ description: 'Không tìm thấy role hoặc permission' })
    // @RequirePermissions('role:update:all')
    @Post('roles/:roleId/permissions')
    addPermissionsToRole(
        @Param('roleId', ParseUUIDPipe) roleId: string,
        @Body() dto: AssignPermissionsDto,
    ) {
        return this.adminRbacService.addPermissionsToRole(
            roleId,
            dto.permissionIds,
        );
    }

    @ApiOperation({
        summary: 'Set lại toàn bộ permissions của role',
        description: 'Thay thế hoàn toàn danh sách permissions cũ bằng danh sách mới truyền vào.',
    })
    @ApiParam({ name: 'roleId', format: 'uuid', description: 'ID của role' })
    @ApiOkResponse({ description: 'Danh sách permissions của role sau khi thay thế' })
    @ApiNotFoundResponse({ description: 'Không tìm thấy role hoặc permission' })
    @RequirePermissions('role:update:all')
    @Put('roles/:roleId/permissions')
    replaceRolePermissions(
        @Param('roleId', ParseUUIDPipe) roleId: string,
        @Body() dto: AssignPermissionsDto,
    ) {
        return this.adminRbacService.replaceRolePermissions(
            roleId,
            dto.permissionIds,
        );
    }

    @ApiOperation({ summary: 'Gỡ 1 permission khỏi role' })
    @ApiParam({ name: 'roleId', format: 'uuid', description: 'ID của role' })
    @ApiParam({ name: 'permissionId', format: 'uuid', description: 'ID của permission cần gỡ' })
    @ApiOkResponse({ description: 'Danh sách permissions của role sau khi gỡ' })
    @ApiNotFoundResponse({ description: 'Không tìm thấy role hoặc role chưa có permission này' })
    @RequirePermissions('role:update:all')
    @Delete('roles/:roleId/permissions/:permissionId')
    removePermissionFromRole(
        @Param('roleId', ParseUUIDPipe) roleId: string,
        @Param('permissionId', ParseUUIDPipe) permissionId: string,
    ) {
        return this.adminRbacService.removePermissionFromRole(
            roleId,
            permissionId,
        );
    }

    // ============================================================
    // USER <-> ROLE (1 user = 1 role; không có API gỡ rời rạc,
    // muốn đổi role thì gọi lại PUT với roleId mới)
    // ============================================================

    @ApiOperation({ summary: 'Lấy role hiện tại của user' })
    @ApiParam({ name: 'userId', format: 'uuid', description: 'ID của user' })
    @ApiOkResponse({ description: 'Role hiện tại của user (null nếu chưa được gán)' })
    @ApiNotFoundResponse({ description: 'Không tìm thấy user' })
    @RequirePermissions('user:read:all')
    @Get('users/:userId/role')
    getUserRole(@Param('userId', ParseUUIDPipe) userId: string) {
        return this.adminRbacService.getUserRole(userId);
    }

    @ApiOperation({
        summary: 'Gán / thay thế role của user',
        description:
            'Vì 1 user chỉ có 1 role nên gán role mới sẽ tự thay thế role cũ (nếu có), đồng thời đồng bộ actor_role trên UserProfile.',
    })
    @ApiParam({ name: 'userId', format: 'uuid', description: 'ID của user' })
    @ApiOkResponse({ description: 'Role vừa được gán cho user' })
    @ApiNotFoundResponse({ description: 'Không tìm thấy user hoặc role' })
    // @RequirePermissions('user:update:all')
    @Put('users/:userId/role')
    assignRoleToUser(
        @Param('userId', ParseUUIDPipe) userId: string,
        @Body() dto: AssignRoleDto,
        @CurrentUser('userId') currentUserId: string, // lấy id admin đang đăng nhập từ JWT
    ) {
        return this.adminRbacService.assignRoleToUser(
            userId,
            dto.roleId,
            currentUserId,
        );
    }
}