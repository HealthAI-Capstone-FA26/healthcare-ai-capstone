import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ZaloOaSender } from './zalo-oa.sender';

/** Chuẩn hoá SĐT VN về dạng 0xxxxxxxxx; trả null nếu không giống SĐT. */
export function normalizeVnPhone(input: string): string | null {
  let digits = input.replace(/[\s.\-()]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (!/^\d{9,12}$/.test(digits)) return null;
  if (digits.startsWith('84')) digits = '0' + digits.slice(2);
  return /^0\d{9}$/.test(digits) ? digits : null;
}

/** Tìm SĐT VN trong câu, ví dụ "sdt 0949 730 930" -> 0949730930 */
export function extractVnPhone(input: string): string | null {
  const m = input.match(/(?:\+?84|0)(?:[\s.\-]?\d){8,9}/);
  return m ? normalizeVnPhone(m[0]) : null;
}

/**
 * Liên kết bệnh nhân với Zalo Bot: bệnh nhân nhắn SĐT đã đăng ký cho bot -> lưu chat_id vào PatientZaloLink.
 * LƯU Ý bảo mật: chỉ xác thực bằng SĐT nên ai biết SĐT cũng liên kết được; nên bổ sung OTP nếu triển khai thật.
 */
@Injectable()
export class ZaloBotLinkService {
  private readonly logger = new Logger(ZaloBotLinkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: ZaloOaSender,
  ) {}

  async handleIncomingText(chatId: string, text: string): Promise<void> {
    const phone = extractVnPhone(text);
    if (!phone) {
      await this.reply(
        chatId,
        'Xin chào! Để nhận phiếu khám qua Zalo, vui lòng nhắn số điện thoại bạn đã đăng ký với bệnh viện (ví dụ: 0912345678).',
      );
      return;
    }

    const variants = [phone, `+84${phone.slice(1)}`, `84${phone.slice(1)}`];
    const patients = await this.prisma.patient.findMany({
      where: { phoneNumber: { in: variants }, isActive: true },
      select: { patientId: true, fullName: true },
    });
    if (patients.length === 0) {
      await this.reply(chatId, 'Không tìm thấy hồ sơ bệnh nhân nào với số điện thoại này. Vui lòng kiểm tra lại hoặc liên hệ quầy tiếp đón.');
      return;
    }

    for (const p of patients) {
      await this.prisma.patientZaloLink.upsert({
        where: { patientId: p.patientId },
        create: { patientId: p.patientId, chatId },
        update: { chatId, linkedAt: new Date() },
      });
    }
    this.logger.log(`Đã liên kết ${patients.length} hồ sơ với Zalo chat ${chatId}`);
    await this.reply(
      chatId,
      `Liên kết thành công cho: ${patients.map((p) => p.fullName).join(', ')}. Bạn sẽ nhận phiếu khám qua Zalo này.`,
    );
  }

  async handleUnsupported(chatId: string): Promise<void> {
    await this.reply(
      chatId,
      'Zalo không chuyển được tin dạng danh thiếp. Vui lòng nhắn số điện thoại kèm chữ, ví dụ: sdt 0912345678',
    );
  }

  private async reply(chatId: string, text: string) {
    try {
      await this.sender.sendText(chatId, text);
    } catch (err) {
      this.logger.warn(`Không gửi được tin phản hồi Zalo Bot: ${err}`);
    }
  }
}
