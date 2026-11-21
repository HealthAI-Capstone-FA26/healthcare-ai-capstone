import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../redis/redis.service';

export class ZaloOaNotConfiguredError extends Error {
  constructor() {
    super('ZALO_OA_NOT_CONFIGURED');
  }
}

// Zalo báo access_token hết hạn / không hợp lệ -> cần refresh rồi gọi lại 1 lần.
class ZaloTokenInvalidError extends Error { }

interface ZaloTokenState {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

// Lưu token đã refresh vào Redis (refresh_token của Zalo chỉ dùng được 1 lần -> phải lưu bản mới nhất).
const TOKEN_KEY = 'zalo:oa:tokens';
const LOCK_KEY = 'zalo:oa:refresh-lock';
const TOKEN_TTL_SECONDS = 89 * 24 * 3600; // refresh_token sống ~3 tháng, mỗi lần refresh được gia hạn
const REFRESH_URL = 'https://oauth.zaloapp.com/v4/oa/access_token';
// Mã lỗi Zalo cho access_token sai/hết hạn (-216: invalid, -124: expired)
const TOKEN_ERROR_CODES = [-216, -124];

/**
 * Gửi tin nhắn Zalo theo 2 chế độ:
 *  - Zalo Bot (khuyên dùng khi không có hồ sơ xác thực OA): đặt ZALO_BOT_TOKEN. Token không hết hạn, chỉ gửi được
 *    tin văn bản (tối đa 2000 ký tự); `zaloUserId` ở đây là `chat_id` của người đã nhắn tin cho bot. KHÔNG gửi được file PDF.
 *  - Zalo Official Account API v3 (cần OA đã xác thực): cấu hình bên dưới.
 * Ưu tiên Bot nếu có ZALO_BOT_TOKEN. Tuỳ chọn: ZALO_BOT_API_URL (mặc định https://bot-api.zaloplatforms.com).
 *
 * Chế độ OA — gửi tin nhắn tư vấn (CS message) qua Zalo Official Account API v3.
 * Cấu hình bắt buộc để chạy lâu dài (production):
 *   ZALO_APP_ID, ZALO_APP_SECRET, ZALO_OA_REFRESH_TOKEN (seed lần đầu; sau đó token mới nhất nằm trong Redis).
 * Tuỳ chọn: ZALO_OA_ACCESS_TOKEN (dùng tạm khi chưa có app id/secret — chỉ sống ~1 giờ),
 *           ZALO_OA_API_URL, ZALO_OA_UPLOAD_FILE_URL, ZALO_OA_TIMEOUT_MS (mặc định 10000).
 * `zaloUserId` là user_id của người quan tâm OA (lấy từ NotificationPreference.destination).
 */
@Injectable()
export class ZaloOaSender {
  private readonly logger = new Logger(ZaloOaSender.name);

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService, // RedisModule là @Global nên inject trực tiếp được
  ) { }

  isConfigured(): boolean {
    return Boolean(
      this.botToken ||
      this.config.get<string>('ZALO_OA_ACCESS_TOKEN') ||
      this.config.get<string>('ZALO_OA_REFRESH_TOKEN'),
    );
  }

  /** true khi đang dùng Zalo Bot (có ZALO_BOT_TOKEN) -> không gửi được file, chỉ gửi văn bản. */
  isBotMode(): boolean {
    return Boolean(this.botToken);
  }

  private get botToken(): string | undefined {
    return this.config.get<string>('ZALO_BOT_TOKEN') || undefined;
  }

  /** Gửi tin văn bản qua Zalo Bot API: POST {base}/bot{TOKEN}/sendMessage, phản hồi { ok, result | description, error_code }. */
  private async sendBotText(chatId: string, text: string): Promise<void> {
    const base = this.config.get<string>('ZALO_BOT_API_URL') ?? 'https://bot-api.zaloplatforms.com';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${base}/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Zalo Bot giới hạn text 1–2000 ký tự
        body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 2000) }),
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; error_code?: number };
      // Zalo có thể trả HTTP 200 kèm ok=false -> luôn kiểm tra body.ok
      if (!res.ok || body.ok !== true) {
        throw new Error(`Zalo Bot lỗi ${res.status}/${body.error_code ?? '?'}: ${body.description ?? 'unknown'}`);
      }
      this.logger.log(`Đã gửi Zalo Bot tới ${chatId}`); // không log token
    } finally {
      clearTimeout(timer);
    }
  }

  private get timeoutMs(): number {
    return Number(this.config.get<string>('ZALO_OA_TIMEOUT_MS') ?? 10000);
  }

  private isFresh(state: ZaloTokenState | null): state is ZaloTokenState {
    return !!state && state.expiresAt - 60_000 > Date.now(); // chừa 60s đệm
  }

  /** Lấy access_token còn hạn; tự refresh khi hết hạn. `staleToken` = token vừa bị Zalo từ chối. */
  private async getAccessToken(staleToken?: string): Promise<string> {
    const seedAccess = this.config.get<string>('ZALO_OA_ACCESS_TOKEN');
    const appId = this.config.get<string>('ZALO_APP_ID');
    const appSecret = this.config.get<string>('ZALO_APP_SECRET');
    const seedRefresh = this.config.get<string>('ZALO_OA_REFRESH_TOKEN');

    // Không đủ thông tin để refresh -> hành vi cũ: dùng token tĩnh trong env
    if (!appId || !appSecret || !seedRefresh) {
      if (seedAccess) return seedAccess;
      throw new ZaloOaNotConfiguredError();
    }

    const cached = await this.redis.getJson<ZaloTokenState>(TOKEN_KEY).catch(() => null);
    if (this.isFresh(cached) && cached.accessToken !== staleToken) return cached.accessToken;

    const lock = await this.redis.acquireLock(LOCK_KEY, 30);
    if (!lock) {
      // Instance khác đang refresh -> chờ rồi đọc lại token mới
      await new Promise((r) => setTimeout(r, 1500));
      const again = await this.redis.getJson<ZaloTokenState>(TOKEN_KEY).catch(() => null);
      if (this.isFresh(again) && again.accessToken !== staleToken) return again.accessToken;
      throw new Error('Zalo OA đang refresh token ở instance khác, sẽ thử lại');
    }

    try {
      // Kiểm tra lại sau khi giữ lock (có thể instance khác vừa refresh xong)
      const latest = await this.redis.getJson<ZaloTokenState>(TOKEN_KEY).catch(() => null);
      if (this.isFresh(latest) && latest.accessToken !== staleToken) return latest.accessToken;

      const refreshToken = latest?.refreshToken ?? cached?.refreshToken ?? seedRefresh;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(REFRESH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', secret_key: appSecret },
          body: new URLSearchParams({ refresh_token: refreshToken, app_id: appId, grant_type: 'refresh_token' }),
          signal: controller.signal,
        });
        const body = (await res.json().catch(() => ({}))) as {
          access_token?: string;
          refresh_token?: string;
          expires_in?: string | number;
          error?: number | string;
          error_name?: string;
          error_reason?: string;
        };
        if (!body.access_token) {
          // Lỗi thường gặp: refresh_token đã dùng rồi / hết hạn -> phải cấp lại thủ công (xem hướng dẫn)
          throw new Error(
            `Zalo OA refresh token lỗi ${res.status}/${body.error ?? '?'}: ${body.error_name ?? body.error_reason ?? 'unknown'}`,
          );
        }
        const next: ZaloTokenState = {
          accessToken: body.access_token,
          refreshToken: body.refresh_token ?? refreshToken,
          expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000,
        };
        await this.redis.setJson(TOKEN_KEY, next, TOKEN_TTL_SECONDS);
        this.logger.log('Đã refresh Zalo OA access token');
        return next.accessToken;
      } finally {
        clearTimeout(timer);
      }
    } finally {
      await this.redis.releaseLock(LOCK_KEY, lock);
    }
  }

  /** Chạy `run` với token hiện có; nếu Zalo báo token sai/hết hạn thì refresh và thử lại đúng 1 lần. */
  private async withToken<T>(run: (token: string) => Promise<T>): Promise<T> {
    const token = await this.getAccessToken();
    try {
      return await run(token);
    } catch (err) {
      if (!(err instanceof ZaloTokenInvalidError)) throw err;
      return run(await this.getAccessToken(token));
    }
  }

  private async call(url: string, init: RequestInit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      const body = (await res.json().catch(() => ({}))) as {
        error?: number;
        message?: string;
        data?: { token?: string };
      };
      if (typeof body.error === 'number' && TOKEN_ERROR_CODES.includes(body.error)) {
        throw new ZaloTokenInvalidError(`Zalo OA token lỗi ${body.error}: ${body.message ?? ''}`);
      }
      if (!res.ok || (typeof body.error === 'number' && body.error !== 0)) {
        throw new Error(`Zalo OA lỗi ${res.status}/${body.error ?? '?'}: ${body.message ?? 'unknown'}`);
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Gửi file (PDF) qua Zalo OA: upload file lấy token rồi gửi tin nhắn đính kèm.
   * Zalo giới hạn file 5MB. Cấu hình tuỳ chọn: ZALO_OA_UPLOAD_FILE_URL.
   */
  async sendFile(zaloUserId: string, buffer: Buffer, filename: string): Promise<void> {
    if (this.botToken) {
      throw new Error('Zalo Bot không hỗ trợ gửi file PDF (chỉ gửi được tin văn bản/ảnh); cần Zalo OA đã xác thực');
    }
    const uploadUrl =
      this.config.get<string>('ZALO_OA_UPLOAD_FILE_URL') ?? 'https://openapi.zalo.me/v2.0/oa/upload/file';
    const sendUrl = this.config.get<string>('ZALO_OA_API_URL') ?? 'https://openapi.zalo.me/v3.0/oa/message/cs';

    await this.withToken(async (token) => {
      const form = new FormData(); // tạo mới mỗi lần để retry không bị dùng lại body cũ
      form.append('file', new Blob([new Uint8Array(buffer)], { type: 'application/pdf' }), filename);
      const uploaded = await this.call(uploadUrl, { method: 'POST', headers: { access_token: token }, body: form });
      const fileToken = uploaded.data?.token;
      if (!fileToken) {
        throw new Error('Zalo OA upload file không trả về token');
      }
      await this.call(sendUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', access_token: token },
        body: JSON.stringify({
          recipient: { user_id: zaloUserId },
          message: { attachment: { type: 'file', payload: { token: fileToken } } },
        }),
      });
    });
    this.logger.log(`Đã gửi file Zalo OA tới ${zaloUserId}`);
  }

  async sendText(zaloUserId: string, text: string): Promise<void> {
    if (this.botToken) {
      return this.sendBotText(zaloUserId, text);
    }
    const url = this.config.get<string>('ZALO_OA_API_URL') ?? 'https://openapi.zalo.me/v3.0/oa/message/cs';
    await this.withToken((token) =>
      this.call(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', access_token: token },
        body: JSON.stringify({ recipient: { user_id: zaloUserId }, message: { text } }),
      }),
    );
    this.logger.log(`Đã gửi Zalo OA tới ${zaloUserId}`);
  }
}