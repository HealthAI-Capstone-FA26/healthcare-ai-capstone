import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentService } from './payment.service';
import { PayOsWebhookDto } from './dtos/payos-webhook.dto';

/**
 * §2.3, §3.3, §5 — webhook PayOS: "Không guard — xác thực bằng signature PayOS (HMAC_SHA256)",
 * giống pattern verify-payment service-to-service của lab-test.
 *
 * Tách hẳn 1 controller riêng (không thêm route vào PaymentController) vì PaymentController có
 * @UseGuards(JwtAuthGuard, PermissionsGuard) khai ở cấp class — JwtAuthGuard ở đây chỉ là
 * `AuthGuard('jwt')` trần (xem jwt-auth.guard.ts), KHÔNG có cơ chế @Public() để gỡ riêng 1 route.
 * Thêm 1 controller mới là cách ít động chạm nhất, không phải viết decorator @Public() + sửa lại
 * JwtAuthGuard (đi ngược nguyên tắc "hạn chế sửa file cũ", §0). Route path trùng tiền tố
 * `/payments/bank-transfer` nhưng khác path đầy đủ (`/payments/bank-transfer/webhook`) nên không
 * đụng route nào của PaymentController.
 */
@ApiTags('Payment - PayOS Webhook')
@Controller('payments/bank-transfer')
export class PaymentWebhookController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('webhook')
  @ApiOperation({ summary: 'Webhook PayOS callback — không guard, xác thực bằng signature HMAC (§3.3)' })
  handleWebhook(@Body() dto: PayOsWebhookDto) {
    return this.paymentService.handlePayOsWebhook(dto);
  }
}
