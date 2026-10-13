import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { ActorRolesGuard } from '../../../common/guards/actor-roles.guard';
import { AllowActorRoles } from '../../../common/decorators/actor-roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import { InitialDiagnosisService } from './initial-diagnosis.service';
import { CreateInitialDiagnosisDto } from './dto/create-initial-diagnosis.dto';
import { UpdateInitialDiagnosisDto } from './dto/update-initial-diagnosis.dto';
import { FindDiagnosesQueryDto } from './dto/find-diagnoses-query.dto';

/**
 * SE02 — Chẩn đoán ban đầu. Route giữ nguyên `/diagnoses` vì Diagnosis là bảng dùng chung toàn vòng đời
 * lượt khám: GET mặc định trả cả initial/differential/final trừ khi lọc theo diagnosisType.
 */
@ApiTags('Doctor Examination - Initial Diagnosis')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ActorRolesGuard)
@AllowActorRoles(ACTOR_ROLE.DOCTOR, ACTOR_ROLE.NURSE, ACTOR_ROLE.ADMIN)
@Controller('doctor-examination/encounters/:encounterId/diagnoses')
export class InitialDiagnosisController {
    constructor(private readonly initialDiagnosisService: InitialDiagnosisService) {}

    @Post()
    @AllowActorRoles(ACTOR_ROLE.DOCTOR)
    @ApiOperation({
        summary: 'Ghi nhận chẩn đoán ban đầu (initial) hoặc chẩn đoán phân biệt (differential)',
        description:
            'Cần có chẩn đoán initial trước khi chỉ định cận lâm sàng. 409 nếu trùng (cùng mã ICD-10 + loại) trong lượt khám.',
    })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    create(
        @Param('encounterId', ParseUUIDPipe) encounterId: string,
        @Body() dto: CreateInitialDiagnosisDto,
        @CurrentUser('userId') currentUserId: string,
    ) {
        return this.initialDiagnosisService.create(encounterId, dto, currentUserId);
    }

    @Get()
    @ApiOperation({ summary: 'Danh sách chẩn đoán của 1 lượt khám (mặc định gồm mọi loại)' })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    @ApiOkResponse({ description: 'Danh sách chẩn đoán, mới nhất trước.' })
    findByEncounterId(
        @Param('encounterId', ParseUUIDPipe) encounterId: string,
        @Query() query: FindDiagnosesQueryDto,
    ) {
        return this.initialDiagnosisService.findByEncounterId(encounterId, query);
    }

    @Patch(':diagnosisId')
    @AllowActorRoles(ACTOR_ROLE.DOCTOR)
    @ApiOperation({ summary: 'Sửa tên / ghi chú / đặt làm chẩn đoán chính (không áp dụng cho chẩn đoán final)' })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    @ApiParam({ name: 'diagnosisId', format: 'uuid' })
    update(
        @Param('encounterId', ParseUUIDPipe) encounterId: string,
        @Param('diagnosisId', ParseUUIDPipe) diagnosisId: string,
        @Body() dto: UpdateInitialDiagnosisDto,
        @CurrentUser('userId') currentUserId: string,
    ) {
        return this.initialDiagnosisService.update(encounterId, diagnosisId, dto, currentUserId);
    }

    @Delete(':diagnosisId')
    @AllowActorRoles(ACTOR_ROLE.DOCTOR)
    @ApiOperation({
        summary: 'Xoá chẩn đoán nhập nhầm',
        description: '409 nếu đã là căn cứ của chỉ định cận lâm sàng; 400 nếu là chẩn đoán final.',
    })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    @ApiParam({ name: 'diagnosisId', format: 'uuid' })
    remove(
        @Param('encounterId', ParseUUIDPipe) encounterId: string,
        @Param('diagnosisId', ParseUUIDPipe) diagnosisId: string,
        @CurrentUser('userId') currentUserId: string,
    ) {
        return this.initialDiagnosisService.remove(encounterId, diagnosisId, currentUserId);
    }
}
