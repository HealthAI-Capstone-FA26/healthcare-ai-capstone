import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { Action, Resource, Scope } from '../../../common/constants/permissions.dictionary';
import { InvoiceService } from './invoice.service';
import { GenerateInvoiceDto } from './dtos/generate-invoice.dto';
import { ListInvoicesQueryDto } from './dtos/list-invoices-query.dto';
import { CancelInvoiceDto } from './dtos/cancel-invoice.dto';

@ApiTags('Payment - Invoice')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Post('generate')
  // @RequirePermissions(`${Resource.INVOICE}:${Action.CREATE}:${Scope.ALL}`)
  @ApiOperation({ summary: 'Tự động tính chi phí khám + xét nghiệm, sinh hoá đơn mới — RECEPTIONIST' })
  generate(@Body() dto: GenerateInvoiceDto) {
    return this.invoiceService.generate(dto);
  }

  @Get()
  // @RequirePermissions(`${Resource.INVOICE}:${Action.READ}:${Scope.ALL}`)
  @ApiOperation({ summary: 'Danh sách hoá đơn, lọc theo patientId/encounterId/status — RECEPTIONIST/ADMIN' })
  findMany(@Query() query: ListInvoicesQueryDto) {
    return this.invoiceService.findMany(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết hoá đơn + items + payments — đã login' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoiceService.findById(id);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'URL PDF hoá đơn (generate on-demand nếu chưa có) — đã login' })
  getPdf(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoiceService.getOrGeneratePdfUrl(id);
  }

  @Post(':id/cancel')
  // @RequirePermissions(`${Resource.INVOICE}:${Action.UPDATE}:${Scope.ALL}`)
  @ApiOperation({ summary: "Huỷ hoá đơn (chỉ khi status='pending', chưa có payment success) — RECEPTIONIST/ADMIN" })
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelInvoiceDto) {
    return this.invoiceService.cancel(id, dto);
  }
}
