import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { PDFDocument, rgb } from 'pdf-lib';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import * as fontkit from '@pdf-lib/fontkit';
import { minioClient, BUCKET_NAME } from '../../../../../common/configs/upload.config';
import { PdfSigner } from '../../../pki/pki.types';

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
    /** Serial X.509 (hex) của chứng thư số bác sĩ — hiển thị trên bản in. */
    certificateSerial: string;
    /** DN của CA phát hành chứng thư (hiển thị trên bản in). */
    certificateIssuer?: string;
    /** SHA-256 của chứng thư (hiển thị 16 ký tự đầu). */
    certificateFingerprint?: string;
    /** true khi đơn đã ký (signed) — BẮT BUỘC truyền kèm PdfSigner; false khi chỉ là bản xem trước (draft). */
    isSigned: boolean;
}

export interface GeneratedPdfResult {
    url: string;
    hash: string;
}

export interface PrescriptionPdfGeneratorPort {
    /**
     * Render PDF đơn thuốc rồi upload lên bucket có sẵn, trả về URL public và mã hash SHA-256 (của file CUỐI CÙNG).
     * Khi truyền `signer`: nhúng placeholder + chữ ký số PAdES (adbe.pkcs7.detached) trước khi upload.
     */
    generateAndUpload(input: PrescriptionPdfInput, signer?: PdfSigner): Promise<GeneratedPdfResult>;

    /** Tải lại file PDF đã ký từ object storage (dùng cho xác minh chữ ký). */
    fetchSignedPdf(prescriptionId: string): Promise<Buffer>;
}

@Injectable()
export class PdfLibPrescriptionPdfGeneratorAdapter implements PrescriptionPdfGeneratorPort {
    async generateAndUpload(input: PrescriptionPdfInput, signer?: PdfSigner): Promise<GeneratedPdfResult> {
        if (input.isSigned && !signer) {
            throw new Error('Đơn thuốc đã ký phải kèm PdfSigner (chữ ký số PKI).');
        }
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
            drawLine('Chu ky so (PKI) - da ky boi bac si:', 12, bold);
            drawLine(`Nguoi ky: ${input.doctorName}`);
            drawLine(`So chung thu (serial): ${input.certificateSerial}`, 10);
            if (input.certificateIssuer) drawLine(`Don vi cap chung thu (CA): ${input.certificateIssuer}`, 10);
            if (input.certificateFingerprint) drawLine(`SHA-256 chung thu: ${input.certificateFingerprint.slice(0, 16)}...`, 10);
            drawLine(`Ky luc: ${input.signedAt.toLocaleString('en-GB')}`, 10);
            drawLine('Chu ky PAdES nhung trong file - kiem tra bang PDF reader hoac API verify-signature.', 9);
        } else {
            drawLine('*** BAN XEM TRUOC — DON THUOC CHUA DUOC KY ***', 11, bold);
        }

        let buffer: Buffer;
        if (signer) {
            // Placeholder chữ ký; signpdf yêu cầu không dùng object streams.
            pdflibAddPlaceholder({
                pdfDoc,
                reason: signer.reason,
                contactInfo: signer.contactInfo,
                name: signer.name,
                location: signer.location,
                signatureLength: signer.signatureLength,
            });
            buffer = await signer.sign(Buffer.from(await pdfDoc.save({ useObjectStreams: false })));
        } else {
            buffer = Buffer.from(await pdfDoc.save());
        }
        const hash = createHash('sha256').update(buffer).digest('hex');
        const objectName = `prescriptions/${input.prescriptionId}.pdf`;

        await minioClient.putObject(BUCKET_NAME, objectName, buffer, buffer.length, {
            'Content-Type': 'application/pdf',
        });

        return { url: this.buildPublicUrl(objectName), hash };
    }

    async fetchSignedPdf(prescriptionId: string): Promise<Buffer> {
        const stream = await minioClient.getObject(BUCKET_NAME, `prescriptions/${prescriptionId}.pdf`);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        return Buffer.concat(chunks);
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
