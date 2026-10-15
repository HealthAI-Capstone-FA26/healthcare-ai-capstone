import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Action, Resource, Scope } from '../../../common/constants/permissions.dictionary';
import { RequestUser } from '../../auth/strategies/jwt.strategy';
import { PrescriptionService } from './prescription.service';
import { CreatePrescriptionDto } from './dtos/create-prescription.dto';
import { UpdatePrescriptionItemsDto } from './dtos/update-prescription-items.dto';
import { FindPrescriptionsQueryDto } from './dtos/find-prescriptions-query.dto';

@ApiTags('Prescription')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('prescriptions')
export class PrescriptionController {
    constructor(private readonly prescriptionService: PrescriptionService) {}

    @Post()
    @RequirePermissions(`${Resource.PRESCRIPTION}:${Action.CREATE}:${Scope.OWN}`)
    @ApiOperation({ summary: 'Tạo đơn thuốc mới (status=draft) gắn với 1 Encounter + Diagnosis' })
    create(@Body() dto: CreatePrescriptionDto, @CurrentUser() user: RequestUser) {
        return this.prescriptionService.create(dto, user);
    }

    @Patch(':id/items')
    @RequirePermissions(`${Resource.PRESCRIPTION}:${Action.UPDATE}:${Scope.OWN}`)
    @ApiOperation({ summary: 'Thay toàn bộ danh sách dòng thuốc của đơn — chỉ khi đơn còn ở trạng thái draft' })
    updateItems(
        @Param('id') id: string,
        @Body() dto: UpdatePrescriptionItemsDto,
        @CurrentUser() user: RequestUser,
    ) {
        return this.prescriptionService.updateItems(id, dto, user);
    }

    @Post(':id/cancel')
    @RequirePermissions(`${Resource.PRESCRIPTION}:${Action.UPDATE}:${Scope.OWN}`)
    @ApiOperation({ summary: 'Huỷ đơn thuốc' })
    cancel(@Param('id') id: string, @CurrentUser() user: RequestUser) {
        return this.prescriptionService.cancel(id, user);
    }

    @Patch(':id/printed')
    @RequirePermissions(`${Resource.PRESCRIPTION}:${Action.UPDATE}:${Scope.OWN}`)
    @ApiOperation({ summary: 'Đánh dấu đơn thuốc đã in (cập nhật printedAt)' })
    markAsPrinted(@Param('id') id: string) {
        return this.prescriptionService.markAsPrinted(id);
    }

    @Get(':id')
    @RequirePermissions(`${Resource.PRESCRIPTION}:${Action.READ}:${Scope.ALL}`)
    @ApiOperation({ summary: 'Chi tiết đơn thuốc kèm items (tên thuốc) và safetyAlerts' })
    findOne(@Param('id') id: string) {
        return this.prescriptionService.findById(id);
    }

    @Get()
    @RequirePermissions(`${Resource.PRESCRIPTION}:${Action.READ}:${Scope.ALL}`)
    @ApiOperation({ summary: 'Liệt kê đơn thuốc theo bộ lọc (encounterId, doctorId, status)' })
    findMany(@Query() query: FindPrescriptionsQueryDto) {
        return this.prescriptionService.findMany(query);
    }
}
