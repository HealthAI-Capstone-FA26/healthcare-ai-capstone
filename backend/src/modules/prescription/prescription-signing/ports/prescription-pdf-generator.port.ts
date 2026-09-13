import { Injectable } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { minioClient, BUCKET_NAME } from '../../../../common/configs/upload.config';

/**
 * Cổng (port) sinh PDF đơn thuốc + upload lên object storage — cùng pattern
 * InvoicePdfGeneratorPort của module payment, tách interface để PrescriptionSigningService
 * không phụ thuộc cứng vào pdf-lib/MinIO.
 */
export const PRESCRIPTION_PDF_GENERATOR_PORT = 'PRESCRIPTION_PDF_GENERATOR_PORT';

export interface PrescriptionPdfItemInput {
    drugName: string;
    strength: string;
    quantity: number;
    unit: string;
    dosage: string;
    routeDisplay: string | null;
    frequency: string;
    durationDays: number | null;
    instruction: string | null;
}

export interface PrescriptionPdfInput {
    prescriptionId: string;
    prescriptionCode: string;
    patientName: string;
    patientDateOfBirth: Date;
    patientGender: string;
    doctorName: string;
    diagnosisName: string;
    icd10Code: string;
    items: PrescriptionPdfItemInput[];
    issuedAt: Date;
    signedAt: Date;
    certificateSerial: string;
    /** true khi đơn đã ký (signed) — hiện chữ ký giả lập; false khi chỉ là bản xem trước (draft). */
    isSigned: boolean;
}

export interface PrescriptionPdfGeneratorPort {
    /** Render PDF đơn thuốc rồi upload lên bucket có sẵn, trả về URL public. */
    generateAndUpload(input: PrescriptionPdfInput): Promise<{ url: string }>;
}

/**
 * Adapter thật — dùng pdf-lib render buffer PDF rồi `minioClient.putObject()` thẳng, cùng
 * cách PdfInvoiceGeneratorAdapter đang làm (chỉ *import* minioClient/BUCKET_NAME có sẵn từ
 * upload.config.ts, không sửa file đó).
 *
 * LƯU Ý: pdf-lib StandardFonts chỉ hỗ trợ encoding WinAnsi, KHÔNG render đúng dấu tiếng Việt
 * — cố tình dùng chữ không dấu để tránh lỗi encode, cùng lưu ý đã ghi trong
 * PdfInvoiceGeneratorAdapter. TODO: nhúng font Unicode ngoài (VD: Noto Sans qua @pdf-lib/fontkit)
 * nếu cần PDF có dấu tiếng Việt.
 */
@Injectable()
export class PdfLibPrescriptionPdfGeneratorAdapter implements PrescriptionPdfGeneratorPort {
    async generateAndUpload(input: PrescriptionPdfInput): Promise<{ url: string }> {
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

        drawLine(`DON THUOC: ${input.prescriptionCode}`, 18, bold);
        drawLine(`Ngay ke don: ${input.issuedAt.toLocaleDateString('en-GB')}`);
        y -= 4;

        drawLine('Thong tin benh nhan / bac si:', 12, bold);
        drawLine(`Benh nhan: ${input.patientName}  (${input.patientGender}, sinh ${input.patientDateOfBirth.toLocaleDateString('en-GB')})`);
        drawLine(`Bac si ke don: ${input.doctorName}`);
        drawLine(`Chan doan: ${input.diagnosisName} (ICD-10: ${input.icd10Code})`);
        y -= 8;

        drawLine('Danh sach thuoc:', 12, bold);
        for (const item of input.items) {
            drawLine(`- ${item.drugName} ${item.strength}  SL: ${item.quantity} ${item.unit}`);
            const durationStr = item.durationDays ? `, ${item.durationDays} ngay` : '';
            drawLine(`  Lieu: ${item.dosage}, ${item.frequency}${durationStr}${item.routeDisplay ? `, duong dung: ${item.routeDisplay}` : ''}`, 10);
            if (item.instruction) {
                drawLine(`  Loi dan: ${item.instruction}`, 10);
            }
        }

        y -= 12;
        if (input.isSigned) {
            drawLine('Chu ky dien tu (gia lap):', 12, bold);
            drawLine(`So chung thu: ${input.certificateSerial}`);
            drawLine(`Ky luc: ${input.signedAt.toLocaleString('en-GB')}`);
        } else {
            drawLine('*** BAN XEM TRUOC — DON THUOC CHUA DUOC KY ***', 11, bold);
        }

        const pdfBytes = await pdfDoc.save();
        const buffer = Buffer.from(pdfBytes);
        const objectName = `prescriptions/${input.prescriptionId}.pdf`;

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
