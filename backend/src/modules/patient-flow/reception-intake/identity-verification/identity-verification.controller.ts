import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { RequestUser } from '../../../identity-access/auth/strategies/jwt.strategy';
import { IdentityVerificationService } from './identity-verification.service';
import { CreateIdentityVerificationDto } from './dto/create-identity-verification.dto';
import { PermissionsGuard } from '../../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../../common/decorators/permissions.decorator';
import { Action, Resource, Scope } from '../../../../common/constants/permissions.dictionary';

@ApiTags('Identity Verification')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('encounters/:encounterId/identity-verifications')
export class IdentityVerificationController {
  constructor(private readonly identityVerificationService: IdentityVerificationService) { }

  @Post()
  @RequirePermissions(`${Resource.IDENTITY_VERIFICATION}:${Action.CREATE}:${Scope.GROUP}`)
  @ApiOperation({ summary: 'Ghi nhận 1 lần xác minh danh tính bệnh nhân cho lượt khám (log nhiều dòng)' })
  create(
    @Param('encounterId') encounterId: string,
    @Body() dto: CreateIdentityVerificationDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.identityVerificationService.create(encounterId, dto, user);
  }

  @Get()
  @RequirePermissions(`${Resource.IDENTITY_VERIFICATION}:${Action.READ}:${Scope.GROUP}`)
  @ApiOperation({ summary: 'Lịch sử xác minh danh tính của 1 lượt khám, mới nhất trước' })
  findByEncounterId(@Param('encounterId') encounterId: string) {
    return this.identityVerificationService.findByEncounterId(encounterId);
  }
}