import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { Action, Resource, Scope } from '../../../common/constants/permissions.dictionary';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequestUser } from '../../auth/strategies/jwt.strategy';
import { PaymentService } from './payment.service';
import { CreateCashPaymentDto } from './dtos/create-cash-payment.dto';
import { ConfirmCashPaymentDto } from './dtos/confirm-cash-payment.dto';
import { CreateBankTransferPaymentDto } from './dtos/create-bank-transfer-payment.dto';

/**
 * Phase 3: route 'cash'. Phase 7 nối thêm route 'bank-transfer' bên dưới (§2.3, §3.2b) — không
 * sửa lại các route cash đã có. Webhook PayOS (§3.3) KHÔNG nằm ở đây vì controller này có
 * @UseGuards(JwtAuthGuard, PermissionsGuard) ở cấp class — xem PaymentWebhookController riêng
 * (payment-webhook.controller.ts), route /payments/bank-transfer/webhook, không guard.
 */
@ApiTags('Payment - Payment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('cash')
  // @RequirePermissions(`${Resource.PAYMENT}:${Action.CREATE}:${Scope.ALL}`)
  @ApiOperation({ summary: 'Ghi nhận thanh toán tiền mặt — RECEPTIONIST' })
  createCash(@Body() dto: CreateCashPaymentDto) {
    return this.paymentService.createCashPayment(dto);
  }

  @Post('cash/:id/confirm')
  // @RequirePermissions(`${Resource.PAYMENT}:${Action.UPDATE}:${Scope.ALL}`)
  @ApiOperation({ summary: 'Xác nhận đã thu tiền mặt (đối soát cuối ca) — RECEPTIONIST' })
  confirmCash(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmCashPaymentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.paymentService.confirmCashPayment(id, dto, user.userId);
  }

  @Post('bank-transfer')
  // @RequirePermissions(`${Resource.PAYMENT}:${Action.CREATE}:${Scope.OWN}`)
  @ApiOperation({
    summary: 'Tạo link/QR thanh toán qua PayOS — RECEPTIONIST hoặc PATIENT (tự thanh toán hoá đơn của mình)',
  })
  createBankTransfer(@Body() dto: CreateBankTransferPaymentDto, @CurrentUser() user: RequestUser) {
    return this.paymentService.createBankTransferPayment(dto, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết 1 giao dịch thanh toán — đã login' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.paymentService.getById(id);
  }

  @Get()
  @ApiOperation({ summary: 'Lịch sử thanh toán của 1 hoá đơn — đã login' })
  findByInvoice(@Query('invoiceId', ParseUUIDPipe) invoiceId: string) {
    return this.paymentService.findByInvoice(invoiceId);
  }
}
