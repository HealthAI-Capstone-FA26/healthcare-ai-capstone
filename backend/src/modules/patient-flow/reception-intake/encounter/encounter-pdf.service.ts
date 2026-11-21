import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import * as fontkit from '@pdf-lib/fontkit';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { BUCKET_NAME, minioClient } from '../../../../common/configs/upload.config';
import { EncounterService } from './encounter.service';
import { ZaloOaSender } from '../../../platform/notification/zalo-oa.sender';
import { NotificationContactResolver } from '../../../platform/notification/notification-contact.resolver';

function findFontBuffer(fileName: string, winFallbackName: string): Buffer | null {
  const candidates = [
    path.resolve(process.cwd(), 'src/assets/fonts', fileName),
    path.resolve(process.cwd(), 'dist/src/assets/fonts', fileName),
    path.resolve(__dirname, '../../../../assets/fonts', fileName),
    path.resolve(__dirname, '../../../../../src/assets/fonts', fileName),
    path.join('C:\\Windows\\Fonts', winFallbackName),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p);
    } catch {
      // ignore
    }
  }
  return null;
}

const GENDER_LABEL: Record<string, string> = {
  male: 'Nam',
  female: 'Nữ',
  other: 'Khác',
  unknown: 'Không rõ',
};

const STATUS_LABEL: Record<string, string> = {
  arrived: 'Đã đến',
  registered: 'Đã đăng ký',
  waiting_for_doctor: 'Chờ bác sĩ',
  in_progress: 'Đang khám',
  awaiting_diagnostics: 'Chờ cận lâm sàng',
  diagnostics_in_progress: 'Đang làm cận lâm sàng',
  awaiting_review: 'Chờ kết luận',
  finished: 'Hoàn tất',
  cancelled: 'Đã hủy',
};

/** Xuất PDF thông tin lượt khám (Encounter): bệnh nhân, bác sĩ, lý do khám, sinh hiệu. */
@Injectable()
export class EncounterPdfService {
  private readonly logger = new Logger(EncounterPdfService.name);

  constructor(
    private readonly encounterService: EncounterService,
    private readonly zaloSender: ZaloOaSender,
    private readonly contactResolver: NotificationContactResolver,
  ) { }

  /**
   * Gửi PDF lượt khám cho bệnh nhân qua Zalo OA (best-effort: không bao giờ throw để không làm hỏng
   * nghiệp vụ chính). Zalo user id lấy từ NotificationPreference.destination (kênh zalo_oa).
   */
  async sendViaZalo(
    encounterId: string,
    patientId: string,
  ): Promise<{ sent: boolean; reason?: string }> {
    try {
      if (!this.zaloSender.isConfigured()) {
        return { sent: false, reason: 'ZALO_OA_NOT_CONFIGURED' };
      }
      const contact = await this.contactResolver.resolve(
        { patientId },
        'zalo_oa',
        'registration_confirmed',
      );
      if (!contact.allowed || !contact.destination) {
        return { sent: false, reason: contact.reason ?? 'NO_CONTACT' };
      }
      const { buffer, filename } = await this.generate(encounterId);
      await this.deliverPdf(contact.destination, buffer, filename);
      return { sent: true };
    } catch (err) {
      this.logger.error(`Gửi PDF lượt khám ${encounterId} qua Zalo thất bại: ${err}`);
      return { sent: false, reason: err instanceof Error ? err.message : 'UNKNOWN_ERROR' };
    }
  }

  /**
   * Dùng để test: gửi PDF lượt khám qua Zalo OA tới `zaloUserId` truyền vào (hoặc Zalo id của bệnh nhân
   * nếu bỏ trống). Khác sendViaZalo: lỗi được trả ra (throw) để thấy rõ nguyên nhân.
   */
  async sendToZaloForTest(encounterId: string, zaloUserId?: string) {
    if (!this.zaloSender.isConfigured()) {
      throw new BadRequestException('Chưa cấu hình Zalo (ZALO_BOT_TOKEN hoặc ZALO_OA_*)');
    }
    const encounter = await this.encounterService.findById(encounterId);
    let destination = zaloUserId?.trim();
    if (!destination) {
      const contact = await this.contactResolver.resolve(
        { patientId: encounter.patientId },
        'zalo_oa',
        'registration_confirmed',
      );
      if (!contact.allowed || !contact.destination) {
        throw new BadRequestException(
          `Bệnh nhân chưa có Zalo user id (${contact.reason ?? 'NO_CONTACT'}); hãy truyền zaloUserId trong body`,
        );
      }
      destination = contact.destination;
    }
    const { buffer, filename } = await this.generate(encounterId);
    try {
      await this.deliverPdf(destination, buffer, filename);
    } catch (err) {
      throw new BadGatewayException(err instanceof Error ? err.message : 'Gửi Zalo thất bại');
    }
    return { sent: true, encounterId, zaloUserId: destination, filename, sizeBytes: buffer.length };
  }

  /**
   * Chế độ Zalo Bot không gửi được file -> upload PDF lên S3 rồi gửi LINK tải có hạn ngắn (presigned URL) qua tin văn bản.
   * Chế độ OA: gửi file trực tiếp như cũ. Hạn link chỉnh bằng ZALO_PDF_LINK_TTL_SECONDS (mặc định 3600 = 1 giờ).
   */
  private async deliverPdf(destination: string, buffer: Buffer, filename: string): Promise<void> {
    if (!this.zaloSender.isBotMode()) {
      await this.zaloSender.sendFile(destination, buffer, filename);
      return;
    }
    // Tên object ngẫu nhiên (UUID) để không đoán được đường dẫn; dữ liệu y tế nên để link ngắn hạn
    const objectName = `encounter-pdfs/${randomUUID()}.pdf`;
    await minioClient.putObject(BUCKET_NAME, objectName, buffer, buffer.length, { 'Content-Type': 'application/pdf' });
    const ttl = Number(process.env.ZALO_PDF_LINK_TTL_SECONDS ?? 3600);
    const url = await minioClient.presignedGetObject(BUCKET_NAME, objectName, ttl);
    await this.zaloSender.sendText(
      destination,
      `Phiếu khám của bạn (${filename}):\n${url}\nLink có hiệu lực khoảng ${Math.round(ttl / 60)} phút.`,
    );
  }

  async generate(encounterId: string): Promise<{ buffer: Buffer; filename: string }> {
    const encounter = await this.encounterService.findById(encounterId);

    const pdfDoc = await PDFDocument.create();
    const regularBuffer = findFontBuffer('Arial-Regular.ttf', 'arial.ttf');
    const boldBuffer = findFontBuffer('Arial-Bold.ttf', 'arialbd.ttf');

    let font: PDFFont;
    let bold: PDFFont;
    let isUnicode = false;
    if (regularBuffer && boldBuffer) {
      try {
        pdfDoc.registerFontkit((fontkit as any).default || fontkit);
        font = await pdfDoc.embedFont(regularBuffer);
        bold = await pdfDoc.embedFont(boldBuffer);
        isUnicode = true;
      } catch (err) {
        this.logger.warn(`Không nhúng được font Unicode, dùng Helvetica: ${err}`);
        font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      }
    } else {
      font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    }

    const fmt = (text: unknown): string => {
      const raw = String(text ?? '').trim();
      if (!isUnicode) {
        return raw
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/đ/g, 'd')
          .replace(/Đ/g, 'D')
          .replace(/[^\x20-\x7E]/g, ' ');
      }
      return raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
    };
    const fmtDate = (d?: Date | null) =>
      d
        ? new Date(d).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false })
        : '-';
    const fmtDay = (d?: Date | null) =>
      d ? new Date(d).toLocaleDateString('vi-VN', { timeZone: 'UTC' }) : '-';

    const margin = 50;
    const pageSize: [number, number] = [595.28, 841.89];
    let page: PDFPage = pdfDoc.addPage(pageSize);
    let y = pageSize[1] - margin;
    const maxWidth = pageSize[0] - margin * 2;

    const ensureSpace = (needed: number) => {
      if (y - needed < margin) {
        page = pdfDoc.addPage(pageSize);
        y = pageSize[1] - margin;
      }
    };

    const wrap = (text: string, f: PDFFont, size: number, width: number): string[] => {
      const lines: string[] = [];
      for (const para of text.split('\n')) {
        let line = '';
        for (const word of para.split(/\s+/)) {
          const candidate = line ? `${line} ${word}` : word;
          if (f.widthOfTextAtSize(candidate, size) > width && line) {
            lines.push(line);
            line = word;
          } else {
            line = candidate;
          }
        }
        lines.push(line);
      }
      return lines;
    };

    const heading = (text: string) => {
      ensureSpace(30);
      y -= 8;
      page.drawText(fmt(text), { x: margin, y, size: 12, font: bold, color: rgb(0.1, 0.25, 0.5) });
      y -= 4;
      page.drawLine({
        start: { x: margin, y },
        end: { x: margin + maxWidth, y },
        thickness: 0.7,
        color: rgb(0.1, 0.25, 0.5),
      });
      y -= 14;
    };

    const row = (label: string, value: unknown) => {
      const labelWidth = 130;
      const lines = wrap(fmt(value) || '-', font, 10, maxWidth - labelWidth);
      ensureSpace(lines.length * 14);
      page.drawText(fmt(label), { x: margin, y, size: 10, font: bold });
      for (const line of lines) {
        page.drawText(line, { x: margin + labelWidth, y, size: 10, font });
        y -= 14;
      }
    };

    // Tiêu đề
    const title = fmt('PHIẾU THÔNG TIN LƯỢT KHÁM');
    page.drawText(title, {
      x: (pageSize[0] - bold.widthOfTextAtSize(title, 16)) / 2,
      y,
      size: 16,
      font: bold,
    });
    y -= 28;

    heading('Thông tin lượt khám');
    row('Mã lượt khám', encounter.encounterCode);
    row('Trạng thái', STATUS_LABEL[encounter.status] ?? encounter.status);
    row('Loại bệnh nhân', encounter.patientType === 'new' ? 'Mới' : 'Tái khám');
    row('Thời gian đến', fmtDate(encounter.arrivedAt));
    row('Thời gian đăng ký', fmtDate(encounter.registeredAt));
    row('Thời gian kết thúc', fmtDate(encounter.finishedAt));

    const p = encounter.patient;
    heading('Thông tin bệnh nhân');
    row('Mã bệnh nhân', p.patientCode);
    row('Họ và tên', p.fullName);
    row('Ngày sinh', fmtDay(p.dateOfBirth));
    row('Giới tính', GENDER_LABEL[p.gender] ?? p.gender);
    row('CCCD/CMND', p.identityNumber);
    row('Số BHYT', p.insuranceNumber);
    row('Số điện thoại', p.phoneNumber);
    row('Địa chỉ', p.address);

    heading('Bác sĩ phụ trách');
    if (encounter.doctor) {
      row('Họ và tên', [encounter.doctor.title, encounter.doctor.fullName].filter(Boolean).join(' '));
      row('Mã bác sĩ', encounter.doctor.doctorCode);
      row('Chuyên khoa', encounter.doctor.specialization);
    } else {
      row('Bác sĩ', 'Chưa phân công');
    }

    heading('Lý do khám');
    const cc = encounter.chiefComplaint;
    if (cc) {
      row('Lý do khám', cc.reasonForVisit);
      row('Triệu chứng', cc.symptoms);
      row('Ngày khởi phát', fmtDay(cc.symptomOnsetDate));
      row('Mức độ đau', cc.painLevel != null ? `${cc.painLevel}/10` : null);
    } else {
      row('Lý do khám', 'Chưa khai báo');
    }

    const latestVitals = encounter.vitalSignSessions?.[0];
    if (latestVitals) {
      heading(`Sinh hiệu (đo lúc ${fmtDate(latestVitals.measuredAt)})`);
      for (const ob of latestVitals.observations) {
        row(
          ob.item.itemName,
          `${ob.observationValue.toString()} ${ob.item.unit}${ob.isAbnormal ? ' (bất thường)' : ''}`,
        );
      }
    }

    ensureSpace(30);
    y -= 14;
    page.drawText(fmt(`Xuất lúc: ${fmtDate(new Date())}`), {
      x: margin,
      y,
      size: 9,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });

    const bytes = await pdfDoc.save();
    return { buffer: Buffer.from(bytes), filename: `encounter-${encounter.encounterCode}.pdf` };
  }
}