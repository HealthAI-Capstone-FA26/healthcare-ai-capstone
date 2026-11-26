import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { RequestUser } from '../../../identity-access/auth/strategies/jwt.strategy';
import { ConsentService } from './consent.service';
import { CreateConsentDto } from './dto/create-consent.dto';
import { RevokeConsentDto } from './dto/revoke-consent.dto';
import { FindConsentsQueryDto } from './dto/find-consent-query.dto';
import { PermissionsGuard } from '../../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../../common/decorators/permissions.decorator';
import { Action, Resource, Scope } from '../../../../common/constants/permissions.dictionary';

@ApiTags('Consent')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('consents')
export class ConsentController {
  constructor(private readonly consentService: ConsentService) { }

  @Post()
  @RequirePermissions(`${Resource.CONSENT}:${Action.CREATE}:${Scope.GROUP}`)
  @ApiOperation({ summary: 'Ghi nhận chữ ký điện tử đồng ý theo 1 policy (data_processing/treatment_consent/...)' })
  create(@Body() dto: CreateConsentDto, @CurrentUser() user: RequestUser, @Req() req: Request) {
    return this.consentService.create(dto, user, req);
  }

  @Patch(':id/revoke')
  @RequirePermissions(`${Resource.CONSENT}:${Action.UPDATE}:${Scope.GROUP}`)
  @ApiOperation({ summary: 'Thu hồi sự đồng ý — giữ lại lịch sử, không xoá dòng' })
  revoke(@Param('id') id: string, @Body() dto: RevokeConsentDto) {
    return this.consentService.revoke(id, dto);
  }

  @Get()
  @RequirePermissions(`${Resource.CONSENT}:${Action.READ}:${Scope.GROUP}`)
  @ApiOperation({ summary: 'Tra cứu consent theo bệnh nhân/trạng thái/loại policy' })
  findMany(@Query() query: FindConsentsQueryDto) {
    return this.consentService.findMany(query);
  }
}