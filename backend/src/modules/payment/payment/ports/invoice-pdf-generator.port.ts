import { Injectable, Logger } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb, PDFFont } from 'pdf-lib';
import * as fontkit from '@pdf-lib/fontkit';
import * as fs from 'fs';
import * as path from 'path';
import { minioClient, BUCKET_NAME } from '../../../../common/configs/upload.config';

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
      if (fs.existsSync(p)) {
        return fs.readFileSync(p);
      }
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Cổng (port) xuất PDF hoá đơn + upload lên object storage — §3.5, §4.
 * Tách interface để InvoiceService không phụ thuộc cứng vào pdf-lib/MinIO.
 */
export const INVOICE_PDF_GENERATOR_PORT = 'INVOICE_PDF_GENERATOR_PORT';

export interface InvoicePdfItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface InvoicePdfInput {
  invoiceId: string;
  invoiceCode: string;
  items: InvoicePdfItemInput[];
  subtotalAmount: number;
  discountAmount: number;
  totalAmount: number;
  currency: string;
  issuedAt: Date;

  // Thông tin bệnh nhân
  patientName?: string | null;
  patientCode?: string | null;
  patientIdentityNumber?: string | null;
  patientDob?: string | null;
  patientGender?: string | null;
  patientPhone?: string | null;
  patientAddress?: string | null;

  // Thông tin thanh toán
  paymentMethod?: string | null;
  paidAt?: Date | null;
  paymentStatus?: string | null;

  // Lượt khám & phòng khám
  encounterCode?: string | null;
  clinicName?: string | null;
  clinicAddress?: string | null;
  clinicPhone?: string | null;
}

export interface InvoicePdfGeneratorPort {
  /** Render PDF hoá đơn rồi upload lên bucket có sẵn, trả về URL public để lưu vào Invoice.pdfFileUrl. */
  generateAndUpload(input: InvoicePdfInput): Promise<{ url: string }>;
  getPresignedUrl(invoiceId: string, expirySeconds?: number): Promise<string>;
}

/**
 * Adapter thật — dùng pdf-lib (nhẹ, đủ cho hoá đơn dạng bảng) render buffer PDF rồi
 * `minioClient.putObject()` thẳng (import trực tiếp `minioClient`, `BUCKET_NAME` đã export sẵn từ
 * `upload.config.ts` — chỉ *import*, không sửa file đó; không đụng `UPLOAD_CONSTANTS` vì đó chỉ
 * dùng cho luồng upload ảnh qua multer). Bucket đã set policy public-read từ trước
 * (`checkMinioConnection` chạy lúc bootstrap) nên URL ghép thủ công là truy cập được ngay.
 *
 * LƯU Ý: pdf-lib StandardFonts chỉ hỗ trợ encoding WinAnsi, KHÔNG render đúng dấu tiếng Việt
 * (ơ, ư, ệ...) — nên nội dung PDF ở đây cố tình dùng chữ không dấu để tránh lỗi encode.
 * TODO: nếu cần PDF có dấu tiếng Việt, nhúng font Unicode ngoài (VD: Noto Sans qua @pdf-lib/fontkit)
 * thay cho StandardFonts.Helvetica.
 */
@Injectable()
export class PdfInvoiceGeneratorAdapter implements InvoicePdfGeneratorPort {
  private readonly logger = new Logger(PdfInvoiceGeneratorAdapter.name);

  async generateAndUpload(input: InvoicePdfInput): Promise<{ url: string }> {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]); // A4: 595.28 x 841.89

    // Nạp font tiếng Việt Unicode qua fontkit (fallback an toàn về StandardFonts nếu không tải được font)
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
        this.logger.warn(`Failed to embed Unicode font, fallback to Helvetica: ${err}`);
        font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      }
    } else {
      font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    }

    const fmt = (text: string | null | undefined): string => {
      const raw = (text ?? '').trim();
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

    const money = (n: number) => `${n.toLocaleString('vi-VN')} ${input.currency}`;

    let y = 805;
    const startX = 40;
    const endX = 555;
    const contentWidth = endX - startX;

    // ── 1. HEADER CƠ SỞ Y TẾ ────────────────────────────────────────────────
    page.drawText(fmt(input.clinicName || 'PHÒNG KHÁM CHUYÊN KHOA TIM MẠCH 4AM'), {
      x: startX,
      y,
      size: 13,
      font: bold,
      color: rgb(0.1, 0.2, 0.45),
    });
    y -= 14;

    page.drawText(
      fmt(input.clinicAddress || 'Địa chỉ: 123 Nguyễn Trãi, Phường 2, Quận 5, TP. Hồ Chí Minh - Hotline: 1900 6868'),
      {
        x: startX,
        y,
        size: 9,
        font,
        color: rgb(0.4, 0.4, 0.4),
      },
    );
    y -= 10;

    // Đường kẻ ngang ngăn cách header
    page.drawLine({
      start: { x: startX, y },
      end: { x: endX, y },
      thickness: 1,
      color: rgb(0.8, 0.8, 0.85),
    });
    y -= 22;

    // ── 2. TIÊU ĐỀ HÓA ĐƠN ──────────────────────────────────────────────────
    const title = fmt('HÓA ĐƠN THANH TOÁN VIỆN PHÍ');
    const titleWidth = bold.widthOfTextAtSize(title, 16);
    page.drawText(title, {
      x: startX + (contentWidth - titleWidth) / 2,
      y,
      size: 16,
      font: bold,
      color: rgb(0.05, 0.15, 0.35),
    });
    y -= 14;

    const subTitle = fmt('(PHIẾU THU TIỀN DỊCH VỤ Y TẾ)');
    const subTitleWidth = font.widthOfTextAtSize(subTitle, 9);
    page.drawText(subTitle, {
      x: startX + (contentWidth - subTitleWidth) / 2,
      y,
      size: 9,
      font,
      color: rgb(0.45, 0.45, 0.45),
    });
    y -= 16;

    // Mã hóa đơn & ngày lập
    const invoiceCodeText = fmt(`Mã hóa đơn: ${input.invoiceCode}`);
    const issuedDateText = fmt(`Ngày lập: ${input.issuedAt.toLocaleDateString('vi-VN')}`);
    page.drawText(invoiceCodeText, { x: startX, y, size: 10, font: bold, color: rgb(0.1, 0.1, 0.1) });
    const issuedDateWidth = font.widthOfTextAtSize(issuedDateText, 10);
    page.drawText(issuedDateText, { x: endX - issuedDateWidth, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
    y -= 18;

    // ── 3. KHỐI THÔNG TIN BỆNH NHÂN ─────────────────────────────────────────
    const infoBoxHeight = 70;
    page.drawRectangle({
      x: startX,
      y: y - infoBoxHeight + 10,
      width: contentWidth,
      height: infoBoxHeight,
      color: rgb(0.97, 0.98, 0.99),
      borderColor: rgb(0.85, 0.88, 0.92),
      borderWidth: 1,
    });

    let infoY = y;
    const infoLeftX = startX + 12;
    const infoRightX = startX + 280;

    // Dòng 1: Họ tên + Mã BN
    page.drawText(fmt(`Họ và tên: ${input.patientName || 'Khách vãng lai'}`), {
      x: infoLeftX,
      y: infoY,
      size: 9.5,
      font: bold,
      color: rgb(0.15, 0.15, 0.15),
    });
    page.drawText(fmt(`Mã bệnh nhân: ${input.patientCode || 'N/A'}`), {
      x: infoRightX,
      y: infoY,
      size: 9.5,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });
    infoY -= 14;

    // Dòng 2: Ngày sinh, Giới tính + SĐT
    const dobText = input.patientDob ? `Ngày sinh: ${input.patientDob}` : '';
    const genderText = input.patientGender ? `Giới tính: ${input.patientGender}` : '';
    const dobGender = [dobText, genderText].filter(Boolean).join('  |  ') || 'Ngày sinh: N/A';
    page.drawText(fmt(dobGender), {
      x: infoLeftX,
      y: infoY,
      size: 9,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });
    page.drawText(fmt(`Số điện thoại: ${input.patientPhone || 'N/A'}`), {
      x: infoRightX,
      y: infoY,
      size: 9,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });
    infoY -= 14;

    // Dòng 3: Số CCCD + Mã lượt khám
    page.drawText(fmt(`Số CCCD / Định danh: ${input.patientIdentityNumber || 'Chưa cập nhật'}`), {
      x: infoLeftX,
      y: infoY,
      size: 9,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });
    if (input.encounterCode) {
      page.drawText(fmt(`Mã lượt khám: ${input.encounterCode}`), {
        x: infoRightX,
        y: infoY,
        size: 9,
        font,
        color: rgb(0.35, 0.35, 0.35),
      });
    }
    infoY -= 14;

    // Dòng 4: Địa chỉ
    page.drawText(fmt(`Địa chỉ: ${input.patientAddress || 'Chưa cập nhật'}`), {
      x: infoLeftX,
      y: infoY,
      size: 9,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });

    y -= infoBoxHeight + 12;

    // ── 4. BẢNG CHI TIẾT DỊCH VỤ ─────────────────────────────────────────────
    const colSplitX = [startX, 75, 315, 360, 450, endX];
    const colCenter = {
      stt: (colSplitX[0] + colSplitX[1]) / 2, // 57.5
      qty: (colSplitX[2] + colSplitX[3]) / 2, // 337.5
    };
    const colTextLeft = {
      desc: colSplitX[1] + 8, // 83
    };
    const colTextRight = {
      price: colSplitX[4] - 8, // 442
      total: colSplitX[5] - 8, // 547
    };

    // 4.1 Header bảng
    const headerH = 24;
    page.drawRectangle({
      x: startX,
      y: y - headerH,
      width: contentWidth,
      height: headerH,
      color: rgb(0.92, 0.94, 0.98),
      borderColor: rgb(0.75, 0.8, 0.88),
      borderWidth: 1,
    });

    // Kẻ vạch dọc chia cột trong header
    for (let i = 1; i < colSplitX.length - 1; i++) {
      page.drawLine({
        start: { x: colSplitX[i], y: y - headerH },
        end: { x: colSplitX[i], y },
        thickness: 0.75,
        color: rgb(0.75, 0.8, 0.88),
      });
    }

    const headerTextY = y - headerH + 7.5;
    const thStt = fmt('STT');
    page.drawText(thStt, {
      x: colCenter.stt - bold.widthOfTextAtSize(thStt, 8.5) / 2,
      y: headerTextY,
      size: 8.5,
      font: bold,
      color: rgb(0.1, 0.2, 0.4),
    });

    const thDesc = fmt('NỘI DUNG THU PHÍ / DỊCH VỤ');
    page.drawText(thDesc, {
      x: colTextLeft.desc,
      y: headerTextY,
      size: 8.5,
      font: bold,
      color: rgb(0.1, 0.2, 0.4),
    });

    const thQty = fmt('SL');
    page.drawText(thQty, {
      x: colCenter.qty - bold.widthOfTextAtSize(thQty, 8.5) / 2,
      y: headerTextY,
      size: 8.5,
      font: bold,
      color: rgb(0.1, 0.2, 0.4),
    });

    const thPrice = fmt('ĐƠN GIÁ');
    page.drawText(thPrice, {
      x: colTextRight.price - bold.widthOfTextAtSize(thPrice, 8.5),
      y: headerTextY,
      size: 8.5,
      font: bold,
      color: rgb(0.1, 0.2, 0.4),
    });

    const thTotal = fmt('THÀNH TIỀN');
    page.drawText(thTotal, {
      x: colTextRight.total - bold.widthOfTextAtSize(thTotal, 8.5),
      y: headerTextY,
      size: 8.5,
      font: bold,
      color: rgb(0.1, 0.2, 0.4),
    });

    y -= headerH;

    // 4.2 Các dòng dịch vụ
    const rowH = 22;
    let index = 1;
    for (const item of input.items) {
      const rowBottom = y - rowH;

      // Nền và viền dòng
      page.drawRectangle({
        x: startX,
        y: rowBottom,
        width: contentWidth,
        height: rowH,
        color: index % 2 === 0 ? rgb(0.98, 0.99, 1.0) : rgb(1, 1, 1),
        borderColor: rgb(0.85, 0.88, 0.92),
        borderWidth: 0.75,
      });

      // Kẻ vạch dọc chia cột trong dòng
      for (let i = 1; i < colSplitX.length - 1; i++) {
        page.drawLine({
          start: { x: colSplitX[i], y: rowBottom },
          end: { x: colSplitX[i], y },
          thickness: 0.5,
          color: rgb(0.85, 0.88, 0.92),
        });
      }

      const rowTextY = rowBottom + 6.5;

      // Cột 1: STT
      const sttText = String(index++);
      page.drawText(sttText, {
        x: colCenter.stt - font.widthOfTextAtSize(sttText, 9) / 2,
        y: rowTextY,
        size: 9,
        font,
        color: rgb(0.3, 0.3, 0.3),
      });

      // Cột 2: Tên dịch vụ
      page.drawText(fmt(item.description || 'Dịch vụ'), {
        x: colTextLeft.desc,
        y: rowTextY,
        size: 9,
        font,
        color: rgb(0.15, 0.15, 0.15),
      });

      // Cột 3: Số lượng
      const qtyText = String(item.quantity || 1);
      page.drawText(qtyText, {
        x: colCenter.qty - font.widthOfTextAtSize(qtyText, 9) / 2,
        y: rowTextY,
        size: 9,
        font,
        color: rgb(0.2, 0.2, 0.2),
      });

      // Cột 4: Đơn giá
      const priceText = money(item.unitPrice || item.amount);
      page.drawText(priceText, {
        x: colTextRight.price - font.widthOfTextAtSize(priceText, 9),
        y: rowTextY,
        size: 9,
        font,
        color: rgb(0.25, 0.25, 0.25),
      });

      // Cột 5: Thành tiền
      const amountText = money(item.amount);
      page.drawText(amountText, {
        x: colTextRight.total - bold.widthOfTextAtSize(amountText, 9),
        y: rowTextY,
        size: 9,
        font: bold,
        color: rgb(0.1, 0.1, 0.1),
      });

      y -= rowH;
    }

    y -= 14;

    // ── 5. KHỐI TỔNG KẾT & PHƯƠNG THỨC THANH TOÁN ───────────────────────────
    const summaryBoxY = y;
    // Cột trái: Thông tin thanh toán thực tế
    page.drawText(fmt('THÔNG TIN THANH TOÁN:'), { x: startX, y: summaryBoxY, size: 9, font: bold, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(fmt(`- Hình thức: ${input.paymentMethod || 'Tiền mặt tại quầy'}`), {
      x: startX,
      y: summaryBoxY - 14,
      size: 9,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });
    if (input.paidAt) {
      page.drawText(fmt(`- Thời gian: ${input.paidAt.toLocaleString('vi-VN')}`), {
        x: startX,
        y: summaryBoxY - 26,
        size: 9,
        font,
        color: rgb(0.3, 0.3, 0.3),
      });
    }
    page.drawText(fmt(`- Trạng thái: ${input.paymentStatus || 'Đã thanh toán (Đã thu tiền)'}`), {
      x: startX,
      y: summaryBoxY - (input.paidAt ? 38 : 26),
      size: 9,
      font: bold,
      color: rgb(0.1, 0.5, 0.2),
    });

    // Cột phải: Các khoản tiền
    const sumRightLabelX = 350;
    let sumRightY = summaryBoxY;

    page.drawText(fmt('Tạm tính:'), { x: sumRightLabelX, y: sumRightY, size: 9.5, font, color: rgb(0.35, 0.35, 0.35) });
    const subtotalText = money(input.subtotalAmount);
    page.drawText(subtotalText, {
      x: endX - font.widthOfTextAtSize(subtotalText, 9.5),
      y: sumRightY,
      size: 9.5,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });
    sumRightY -= 15;

    if (input.discountAmount > 0) {
      page.drawText(fmt('Giảm trừ (BHYT/KM):'), { x: sumRightLabelX, y: sumRightY, size: 9.5, font, color: rgb(0.1, 0.6, 0.3) });
      const discountText = `- ${money(input.discountAmount)}`;
      page.drawText(discountText, {
        x: endX - font.widthOfTextAtSize(discountText, 9.5),
        y: sumRightY,
        size: 9.5,
        font,
        color: rgb(0.1, 0.6, 0.3),
      });
      sumRightY -= 15;
    }

    page.drawLine({
      start: { x: sumRightLabelX, y: sumRightY + 4 },
      end: { x: endX, y: sumRightY + 4 },
      thickness: 1,
      color: rgb(0.7, 0.7, 0.7),
    });

    page.drawText(fmt('TỔNG CỘNG:'), { x: sumRightLabelX, y: sumRightY - 6, size: 11, font: bold, color: rgb(0.1, 0.2, 0.45) });
    const totalText = money(input.totalAmount);
    page.drawText(totalText, {
      x: endX - bold.widthOfTextAtSize(totalText, 12),
      y: sumRightY - 6,
      size: 12,
      font: bold,
      color: rgb(0.8, 0.1, 0.1),
    });

    y = sumRightY - 50;

    // ── 6. KHU VỰC CHỮ KÝ ───────────────────────────────────────────────────
    const signColLeft = startX + 45;
    const signColRight = endX - 165;

    const thSignLeft = fmt('NGƯỜI NỘP TIỀN');
    const thSignRight = fmt('NGƯỜI THU TIỀN / THU NGÂN');
    page.drawText(thSignLeft, { x: signColLeft, y, size: 9.5, font: bold, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(thSignRight, { x: signColRight, y, size: 9.5, font: bold, color: rgb(0.2, 0.2, 0.2) });
    y -= 12;

    const thSubSign = fmt('(Ký, ghi rõ họ tên)');
    page.drawText(thSubSign, { x: signColLeft + 5, y, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
    page.drawText(thSubSign, { x: signColRight + 15, y, size: 8, font, color: rgb(0.5, 0.5, 0.5) });

    const pdfBytes = await pdfDoc.save();
    const buffer = Buffer.from(pdfBytes);
    const objectName = `invoices/${input.invoiceId}.pdf`;

    await minioClient.putObject(BUCKET_NAME, objectName, buffer, buffer.length, {
      'Content-Type': 'application/pdf',
    });

    return { url: this.buildPublicUrl(objectName) };
  }

  async getPresignedUrl(invoiceId: string, expirySeconds = 900): Promise<string> {
    const objectName = `invoices/${invoiceId}.pdf`;
    return minioClient.presignedGetObject(BUCKET_NAME, objectName, expirySeconds);
  }

  private buildPublicUrl(objectName: string): string {
    const endPoint = process.env.MINIO_ENDPOINT || 'localhost';
    const port = process.env.MINIO_PORT || '9000';
    const protocol = process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http';
    return `${protocol}://${endPoint}:${port}/${BUCKET_NAME}/${objectName}`;
  }
}
