import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequestUser } from '../../auth/strategies/jwt.strategy';
import { ActorRoleService } from '../../user/actor-role.service';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import { ExaminationFeeService } from './examination-fee.service';
import { CreateExaminationFeeDto } from './dtos/create-examination-fee.dto';
import { UpdateExaminationFeeDto } from './dtos/update-examination-fee.dto';
import { FindExaminationFeesQueryDto } from './dtos/find-examination-fees-query.dto';

/**
 * Actor xác định qua ActorRoleService (không dùng RequirePermissions/PermissionsGuard ở đây)
 * — theo đúng chỉ định của §2.1 trong spec (khác với Invoice/Payment ở §5 dùng RBAC thật).
 */
@ApiTags('Payment - Examination Fee Catalog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('examination-fees')
export class ExaminationFeeController {
  constructor(
    private readonly examinationFeeService: ExaminationFeeService,
    private readonly actorRoleService: ActorRoleService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Tạo mức phí khám mới — chỉ ADMIN' })
  async create(@Body() dto: CreateExaminationFeeDto, @CurrentUser() user: RequestUser) {
    await this.actorRoleService.assertActorRole(user.userId, [ACTOR_ROLE.ADMIN]);
    return this.examinationFeeService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Danh sách mức phí khám, lọc theo departmentId / isActive' })
  async findAll(@Query() query: FindExaminationFeesQueryDto) {
    return this.examinationFeeService.findAll(query);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Sửa giá / isActive của 1 mức phí khám — chỉ ADMIN' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExaminationFeeDto,
    @CurrentUser() user: RequestUser,
  ) {
    await this.actorRoleService.assertActorRole(user.userId, [ACTOR_ROLE.ADMIN]);
    return this.examinationFeeService.update(id, dto);
  }
}
