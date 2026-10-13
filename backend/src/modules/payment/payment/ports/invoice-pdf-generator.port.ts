import { Injectable, Logger } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { minioClient, BUCKET_NAME } from '../../../../common/configs/upload.config';

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
}

export interface InvoicePdfGeneratorPort {
  /** Render PDF hoá đơn rồi upload lên bucket có sẵn, trả về URL public để lưu vào Invoice.pdfFileUrl. */
  generateAndUpload(input: InvoicePdfInput): Promise<{ url: string }>;
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
    const page = pdfDoc.addPage([595.28, 841.89]); // A4
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let y = 800;
    const marginX = 50;
    const drawLine = (text: string, size = 11, f = font) => {
      page.drawText(text, { x: marginX, y, size, font: f, color: rgb(0, 0, 0) });
      y -= size + 8;
    };
    const money = (n: number) => `${n.toLocaleString('en-US')} ${input.currency}`;

    drawLine(`HOA DON: ${input.invoiceCode}`, 18, bold);
    drawLine(`Ngay lap: ${input.issuedAt.toLocaleDateString('en-GB')}`);
    y -= 8;

    drawLine('Chi tiet:', 12, bold);
    for (const item of input.items) {
      drawLine(`- ${item.description}  x${item.quantity}  ${money(item.amount)}`);
    }

    y -= 8;
    drawLine(`Tam tinh: ${money(input.subtotalAmount)}`);
    drawLine(`Giam gia: ${money(input.discountAmount)}`);
    drawLine(`Tong cong: ${money(input.totalAmount)}`, 14, bold);

    const pdfBytes = await pdfDoc.save();
    const buffer = Buffer.from(pdfBytes);
    const objectName = `invoices/${input.invoiceId}.pdf`;

    await minioClient.putObject(BUCKET_NAME, objectName, buffer, buffer.length, {
      'Content-Type': 'application/pdf',
    });

    return { url: this.buildPublicUrl(objectName) };
  }

  private buildPublicUrl(objectName: string): string {
    const endPoint = process.env.MINIO_ENDPOINT || 'localhost';
    const port = process.env.MINIO_PORT || '9000';
    const protocol = process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http';
    return `${protocol}://${endPoint}:${port}/${BUCKET_NAME}/${objectName}`;
  }
}
