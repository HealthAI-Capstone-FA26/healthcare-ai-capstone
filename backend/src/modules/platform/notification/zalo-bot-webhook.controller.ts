import { Body, Controller, Headers, HttpCode, Logger, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { ZaloBotLinkService } from './zalo-bot-link.service';

/**
 * Webhook nhận sự kiện từ Zalo Bot (PUBLIC — không JWT; xác thực bằng header X-Bot-Api-Secret-Token).
 * Đăng ký: POST https://bot-api.zaloplatforms.com/bot<TOKEN>/setWebhook
 *   { "url": "https://<domain>/zalo-bot/webhook", "secret_token": "<ZALO_BOT_WEBHOOK_SECRET>" }
 */
@ApiExcludeController()
@Controller('zalo-bot')
export class ZaloBotWebhookController {
  private readonly logger = new Logger(ZaloBotWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly linkService: ZaloBotLinkService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async handle(@Body() body: any, @Headers('x-bot-api-secret-token') secret?: string) {
    const expected = this.config.get<string>('ZALO_BOT_WEBHOOK_SECRET');
    if (expected && secret !== expected) {
      throw new UnauthorizedException();
    }

    // Payload: { ok, result: { event_name, message: { chat: { id }, from: { id }, text } } } (chấp nhận cả dạng không bọc `result`)
    const event = body?.result ?? body;
    const message = event?.message;
    const chatId = String(message?.chat?.id ?? message?.from?.id ?? '');
    const text = typeof message?.text === 'string' ? message.text : '';

    if (chatId && text) {
      try {
        await this.linkService.handleIncomingText(chatId, text);
      } catch (err) {
        this.logger.error(`Xử lý tin nhắn Zalo Bot lỗi: ${err}`);
      }
    }
    return { ok: true }; // luôn 200 để Zalo không gửi lại
  }
}
