import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';

/**
 * Cổng (port) gọi cổng thanh toán chuyển khoản — §4, §3.2b, §3.3. Tách interface riêng để
 * PaymentService không phụ thuộc cứng vào chi tiết tích hợp PayOS (endpoint, cách ký signature),
 * cùng kiểu thiết kế đã dùng ở LAB_TASK_PAYMENT_NOTIFIER_PORT / INVOICE_PDF_GENERATOR_PORT.
 */
export const PAYMENT_GATEWAY_PORT = 'PAYMENT_GATEWAY_PORT';

export interface CreatePaymentLinkInput {
  orderCode: number;
  amount: number;
  description: string;
  cancelUrl: string;
  returnUrl: string;
}

export interface CreatePaymentLinkOutput {
  checkoutUrl: string;
  paymentLinkId: string;
}

export interface PaymentGatewayPort {
  /** §3.2b bước 4-5 — tạo link thanh toán, trả checkoutUrl + paymentLinkId. */
  createPaymentLink(input: CreatePaymentLinkInput): Promise<CreatePaymentLinkOutput>;

  /**
   * §3.3 bước 2 — tính lại HMAC_SHA256 trên các field của `data` (sort alphabet) rồi so sánh
   * với `signature` nhận được từ webhook. Nhận `data` thô (Record<string, any>) vì PayOS có thể
   * gửi kèm field khác nhau tuỳ loại giao dịch — không hard-code danh sách field ở đây.
   */
  verifyWebhookSignature(data: Record<string, any>, signature: string): boolean;
}

/**
 * Adapter thật — gọi API PayOS bằng `fetch` có sẵn của Node 18+ (runtime backend này chạy trên
 * Node 18+, không cần thêm axios). ConfigService lấy từ ConfigModule.forRoot({isGlobal:true})
 * đã đăng ký ở app.module.ts gốc — không cần import lại ConfigModule ở payment.module.ts.
 * checksumKey/clientId/apiKey đọc từ env PAYOS_CLIENT_ID / PAYOS_API_KEY / PAYOS_CHECKSUM_KEY (§6).
 */
@Injectable()
export class PayOsPaymentGatewayAdapter implements PaymentGatewayPort {
  private readonly logger = new Logger(PayOsPaymentGatewayAdapter.name);
  private readonly baseUrl = 'https://api-merchant.payos.vn';

  constructor(private readonly configService: ConfigService) {}

  async createPaymentLink(input: CreatePaymentLinkInput): Promise<CreatePaymentLinkOutput> {
    const { orderCode, amount, description, cancelUrl, returnUrl } = input;

    // §3.2b bước 4 — signature ký trên đúng 5 field này (sort alphabet theo tài liệu PayOS).
    const signature = this.sign({ amount, cancelUrl, description, orderCode, returnUrl });

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v2/payment-requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': this.clientId,
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify({ orderCode, amount, description, cancelUrl, returnUrl, signature }),
      });
    } catch (err) {
      this.logger.error(`Gọi PayOS createPaymentLink lỗi mạng: ${(err as Error)?.message}`);
      throw new InternalServerErrorException('Không kết nối được tới PayOS, vui lòng thử lại sau.');
    }

    const body: any = await response.json().catch(() => null);
    if (!response.ok || !body || body.code !== '00' || !body.data?.checkoutUrl) {
      this.logger.error(`PayOS createPaymentLink trả lỗi: ${JSON.stringify(body)}`);
      throw new InternalServerErrorException('PayOS từ chối tạo link thanh toán.');
    }

    return { checkoutUrl: body.data.checkoutUrl, paymentLinkId: body.data.paymentLinkId };
  }

  verifyWebhookSignature(data: Record<string, any>, signature: string): boolean {
    if (!signature) {
      return false;
    }
    const expected = this.sign(data ?? {});
    return expected === signature;
  }

  /** HMAC_SHA256(checksumKey, "k1=v1&k2=v2&..."), field sort alphabet — đúng tài liệu PayOS. */
  private sign(fields: Record<string, any>): string {
    const sorted = Object.keys(fields).sort();
    const raw = sorted.map((key) => `${key}=${fields[key]}`).join('&');
    return createHmac('sha256', this.checksumKey).update(raw).digest('hex');
  }

  private get clientId(): string {
    return this.configService.get<string>('PAYOS_CLIENT_ID') ?? '';
  }

  private get apiKey(): string {
    return this.configService.get<string>('PAYOS_API_KEY') ?? '';
  }

  private get checksumKey(): string {
    return this.configService.get<string>('PAYOS_CHECKSUM_KEY') ?? '';
  }
}
