import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export class ZaloOaNotConfiguredError extends Error {
  constructor() {
    super('ZALO_OA_NOT_CONFIGURED');
  }
}

/**
 * Gửi tin nhắn tư vấn (CS message) qua Zalo Official Account API v3.
 * Cấu hình: ZALO_OA_ACCESS_TOKEN (bắt buộc), ZALO_OA_API_URL (tuỳ chọn), ZALO_OA_TIMEOUT_MS (mặc định 10000).
 * `zaloUserId` là user_id của người quan tâm OA (lấy từ NotificationPreference.destination).
 */
@Injectable()
export class ZaloOaSender {
  private readonly logger = new Logger(ZaloOaSender.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('ZALO_OA_ACCESS_TOKEN'));
  }

  async sendText(zaloUserId: string, text: string): Promise<void> {
    const token = this.config.get<string>('ZALO_OA_ACCESS_TOKEN');
    if (!token) {
      throw new ZaloOaNotConfiguredError();
    }
    const url = this.config.get<string>('ZALO_OA_API_URL') ?? 'https://openapi.zalo.me/v3.0/oa/message/cs';
    const timeoutMs = Number(this.config.get<string>('ZALO_OA_TIMEOUT_MS') ?? 10000);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', access_token: token },
        body: JSON.stringify({ recipient: { user_id: zaloUserId }, message: { text } }),
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => ({}))) as { error?: number; message?: string };
      if (!res.ok || (typeof body.error === 'number' && body.error !== 0)) {
        throw new Error(`Zalo OA lỗi ${res.status}/${body.error ?? '?'}: ${body.message ?? 'unknown'}`);
      }
      this.logger.log(`Đã gửi Zalo OA tới ${zaloUserId}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
