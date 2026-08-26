import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiForbiddenResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTags,
    ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { SecurityConfigService } from './security-config.service';
import { UpdateSecurityConfigDto } from '../dto/update-security-config.dto';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';

@ApiTags('Admin - Security Settings')
@ApiBearerAuth() // đổi tên security scheme cho khớp với SwaggerModule.setup(...) nếu bạn dùng addBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'Chưa đăng nhập / token không hợp lệ' })
@ApiForbiddenResponse({ description: 'Không đủ quyền thực hiện thao tác' })
@Controller('admin/security-settings')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SecurityConfigController {
    constructor(private readonly securityConfigService: SecurityConfigService) { }

    @ApiOperation({ summary: 'Lấy các thông số bảo mật hiện tại (token TTL, session, lockout, MFA...)' })
    @ApiOkResponse({ description: 'Cấu hình bảo mật hiện tại' })
    @RequirePermissions('security-config:read:all')
    @Get()
    getConfig() {
        return this.securityConfigService.getConfig();
    }

    @ApiOperation({
        summary: 'Cập nhật (một phần) các thông số bảo mật',
        description:
            'Chỉ cần truyền những field muốn thay đổi, field nào không truyền sẽ giữ nguyên giá trị hiện tại.',
    })
    @ApiOkResponse({ description: 'Cấu hình bảo mật sau khi cập nhật' })
    @RequirePermissions('security-config:update:all')
    @Patch()
    updateConfig(
        @CurrentUser('userId') userId: string,
        @Body() dto: UpdateSecurityConfigDto) {
        return this.securityConfigService.updateConfig(userId, dto);
    }
}
