import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { PDFDocument, rgb } from 'pdf-lib';
import * as fontkit from '@pdf-lib/fontkit';
import { minioClient, BUCKET_NAME } from '../../../../common/configs/upload.config';

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
    createdAt: Date;
    signedAt: Date;
    certificateSerial: string;
    /** true khi đơn đã ký (signed) — hiện chữ ký giả lập; false khi chỉ là bản xem trước (draft). */
    isSigned: boolean;
}

export interface GeneratedPdfResult {
    url: string;
    hash: string;
}

export interface PrescriptionPdfGeneratorPort {
    /** Render PDF đơn thuốc rồi upload lên bucket có sẵn, trả về URL public và mã hash SHA-256. */
    generateAndUpload(input: PrescriptionPdfInput): Promise<GeneratedPdfResult>;
}

@Injectable()
export class PdfLibPrescriptionPdfGeneratorAdapter implements PrescriptionPdfGeneratorPort {
    async generateAndUpload(input: PrescriptionPdfInput): Promise<GeneratedPdfResult> {
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([595.28, 841.89]); // A4
        pdfDoc.registerFontkit(fontkit);

        const font = await pdfDoc.embedFont(readFileSync(this.resolveFontPath('PRESCRIPTION_PDF_FONT_PATH')));
        const bold = await pdfDoc.embedFont(
            readFileSync(this.resolveFontPath('PRESCRIPTION_PDF_BOLD_FONT_PATH')),
        );

        let y = 800;
        const marginX = 50;
        const drawLine = (text: string, size = 11, f = font) => {
            page.drawText(text, { x: marginX, y, size, font: f, color: rgb(0, 0, 0) });
            y -= size + 8;
        };

        drawLine(`DON THUOC: ${input.prescriptionCode}`, 18, bold);
        drawLine(`Ngay ke don: ${input.createdAt.toLocaleDateString('en-GB')}`);
        y -= 4;

        drawLine('Thong tin benh nhan / bac si:', 12, bold);
        drawLine(
            `Benh nhan: ${input.patientName}  (${input.patientGender}, sinh ${input.patientDateOfBirth.toLocaleDateString('en-GB')})`,
        );
        drawLine(`Bac si ke don: ${input.doctorName}`);
        drawLine(`Chan doan: ${input.diagnosisName} (ICD-10: ${input.icd10Code})`);
        y -= 8;

        drawLine('Danh sach thuoc:', 12, bold);
        for (const item of input.items) {
            drawLine(`- ${item.drugName} ${item.strength}  SL: ${item.quantity} ${item.unit}`);
            const durationStr = item.durationDays ? `, ${item.durationDays} ngay` : '';
            drawLine(
                `  Lieu: ${item.dosage}, ${item.frequency}${durationStr}${item.routeDisplay ? `, duong dung: ${item.routeDisplay}` : ''}`,
                10,
            );
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
        const hash = createHash('sha256').update(buffer).digest('hex');
        const objectName = `prescriptions/${input.prescriptionId}.pdf`;

        await minioClient.putObject(BUCKET_NAME, objectName, buffer, buffer.length, {
            'Content-Type': 'application/pdf',
        });

        return { url: this.buildPublicUrl(objectName), hash };
    }

    private buildPublicUrl(objectName: string): string {
        const endPoint = process.env.MINIO_ENDPOINT || 'localhost';
        const port = process.env.MINIO_PORT || '9000';
        const protocol = process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http';
        return `${protocol}://${endPoint}:${port}/${BUCKET_NAME}/${objectName}`;
    }

    private resolveFontPath(environmentVariable: 'PRESCRIPTION_PDF_FONT_PATH' | 'PRESCRIPTION_PDF_BOLD_FONT_PATH') {
        const configuredPath = process.env[environmentVariable];
        const candidates = configuredPath
            ? [configuredPath]
            : environmentVariable === 'PRESCRIPTION_PDF_FONT_PATH'
              ? [
                    'C:\\Windows\\Fonts\\arial.ttf',
                    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
                    '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
                ]
              : [
                    'C:\\Windows\\Fonts\\arialbd.ttf',
                    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
                    '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf',
                ];

        const fontPath = candidates.find((candidate) => existsSync(candidate));
        if (!fontPath) {
            throw new Error(
                `${environmentVariable} is not configured and no Unicode font was found. ` +
                    'Configure both PDF font paths with a TTF or OTF font that supports Vietnamese.',
            );
        }

        return fontPath;
    }
}
