import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import * as fontkit from '@pdf-lib/fontkit';
import * as fs from 'fs';
import * as path from 'path';

/** Thông tin bệnh nhân hiển thị ở đầu mọi PDF kết quả. */
export interface ResultPdfPatient {
    fullName: string;
    patientCode: string;
    encounterCode: string | null;
}

export interface BloodPdfRow {
    name: string;
    value: string;
    unit: string;
    abnormal: boolean;
}

export interface BloodPdfInput {
    patient: ResultPdfPatient;
    serviceName: string;
    resultedAt: Date | null;
    rows: BloodPdfRow[];
    conclusion?: string | null;
}

export interface EcgPdfAnomaly {
    anomalyType: string | null;
    severity: string;
    startOffsetMs: number;
    endOffsetMs: number;
}

export interface EcgPdfInput {
    patient: ResultPdfPatient;
    sampleRateHz: number;
    leadNames: string[];
    /** leads[k][i] = mẫu thứ i của lead k (đúng cấu trúc ParsedEcgSignal). */
    leads: ArrayLike<number>[];
    recordedAt: Date | null;
    /** Tóm tắt AI hiện hành (nếu có). */
    aiOverallResult?: string | null;
    anomalies?: EcgPdfAnomaly[];
}

// Tìm font Unicode (tiếng Việt) — cùng quy ước với EncounterPdfService, tìm thêm theo vị trí file này.
function findFontBuffer(fileName: string, winFallbackName: string): Buffer | null {
    const candidates = [
        path.resolve(process.cwd(), 'src/assets/fonts', fileName),
        path.resolve(process.cwd(), 'dist/src/assets/fonts', fileName),
        path.resolve(__dirname, '../../../assets/fonts', fileName),
        path.resolve(__dirname, '../../../../assets/fonts', fileName),
        path.join('C:\\Windows\\Fonts', winFallbackName),
    ];
    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) return fs.readFileSync(p);
        } catch {
            // bỏ qua, thử đường dẫn kế tiếp
        }
    }
    return null;
}

async function createDoc(): Promise<{ pdf: PDFDocument; font: PDFFont; bold: PDFFont; fmt: (t: unknown) => string }> {
    const pdf = await PDFDocument.create();
    const regular = findFontBuffer('Arial-Regular.ttf', 'arial.ttf');
    const boldBuf = findFontBuffer('Arial-Bold.ttf', 'arialbd.ttf');

    let font: PDFFont;
    let bold: PDFFont;
    let unicode = false;
    if (regular && boldBuf) {
        try {
            pdf.registerFontkit((fontkit as any).default || fontkit);
            font = await pdf.embedFont(regular, { subset: true }); // subset: chỉ nhúng glyph đã dùng -> PDF nhẹ (~vài chục KB)
            bold = await pdf.embedFont(boldBuf, { subset: true });
            unicode = true;
        } catch {
            font = await pdf.embedFont(StandardFonts.Helvetica);
            bold = await pdf.embedFont(StandardFonts.HelveticaBold);
        }
    } else {
        font = await pdf.embedFont(StandardFonts.Helvetica);
        bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    }

    // Không có font Unicode -> bỏ dấu để Helvetica vẽ được
    const fmt = (text: unknown): string => {
        const raw = String(text ?? '').trim();
        if (unicode) return raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
        return raw
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd')
            .replace(/Đ/g, 'D')
            .replace(/[^\x20-\x7E]/g, ' ');
    };
    return { pdf, font, bold, fmt };
}

const fmtDateTime = (d: Date | null | undefined) =>
    d ? new Date(d).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }) : '-';

// ---------------------------------------------------------------------------------------------------------------------
// Xét nghiệm máu: bảng chỉ số (A4 dọc)
// ---------------------------------------------------------------------------------------------------------------------
export async function buildBloodTestPdf(input: BloodPdfInput): Promise<Buffer> {
    const { pdf, font, bold, fmt } = await createDoc();
    const pageSize: [number, number] = [595.28, 841.89];
    const margin = 50;
    const blue = rgb(0.1, 0.25, 0.5);
    let page: PDFPage = pdf.addPage(pageSize);
    let y = pageSize[1] - margin;

    // Vị trí các cột của bảng
    const colName = margin;
    const colValue = 290;
    const colUnit = 380;
    const colFlag = 470;

    const title = fmt('KẾT QUẢ XÉT NGHIỆM MÁU');
    page.drawText(title, { x: (pageSize[0] - bold.widthOfTextAtSize(title, 16)) / 2, y, size: 16, font: bold });
    y -= 26;

    const info = (label: string, value: string) => {
        page.drawText(fmt(label), { x: margin, y, size: 10, font: bold });
        page.drawText(fmt(value) || '-', { x: margin + 110, y, size: 10, font });
        y -= 14;
    };
    info('Họ và tên', input.patient.fullName);
    info('Mã bệnh nhân', input.patient.patientCode);
    info('Mã lượt khám', input.patient.encounterCode ?? '-');
    info('Dịch vụ', input.serviceName);
    info('Thời gian trả KQ', fmtDateTime(input.resultedAt));
    y -= 8;

    const tableHeader = () => {
        page.drawRectangle({ x: margin, y: y - 4, width: pageSize[0] - margin * 2, height: 18, color: blue });
        const white = rgb(1, 1, 1);
        page.drawText(fmt('Chỉ số'), { x: colName + 4, y, size: 10, font: bold, color: white });
        page.drawText(fmt('Kết quả'), { x: colValue, y, size: 10, font: bold, color: white });
        page.drawText(fmt('Đơn vị'), { x: colUnit, y, size: 10, font: bold, color: white });
        page.drawText(fmt('Đánh giá'), { x: colFlag, y, size: 10, font: bold, color: white });
        y -= 20;
    };
    tableHeader();

    input.rows.forEach((r, idx) => {
        // Hết trang -> sang trang mới và vẽ lại tiêu đề bảng
        if (y - 18 < margin) {
            page = pdf.addPage(pageSize);
            y = pageSize[1] - margin;
            tableHeader();
        }
        if (idx % 2 === 1) {
            page.drawRectangle({ x: margin, y: y - 4, width: pageSize[0] - margin * 2, height: 16, color: rgb(0.95, 0.96, 0.98) });
        }
        const color = r.abnormal ? rgb(0.75, 0.1, 0.1) : rgb(0, 0, 0);
        const f = r.abnormal ? bold : font;
        page.drawText(fmt(r.name).slice(0, 48), { x: colName + 4, y, size: 10, font });
        page.drawText(fmt(r.value), { x: colValue, y, size: 10, font: f, color });
        page.drawText(fmt(r.unit), { x: colUnit, y, size: 10, font });
        page.drawText(fmt(r.abnormal ? 'Bất thường' : 'Bình thường'), { x: colFlag, y, size: 10, font: f, color });
        y -= 16;
    });

    if (input.conclusion) {
        if (y - 40 < margin) {
            page = pdf.addPage(pageSize);
            y = pageSize[1] - margin;
        }
        y -= 12;
        page.drawText(fmt('Kết luận'), { x: margin, y, size: 11, font: bold, color: blue });
        y -= 14;
        page.drawText(fmt(input.conclusion).slice(0, 200), { x: margin, y, size: 10, font });
        y -= 14;
    }

    y -= 10;
    page.drawText(fmt('Kết quả chỉ có giá trị tham khảo, vui lòng trao đổi với bác sĩ điều trị để được giải thích.'), {
        x: margin,
        y,
        size: 8,
        font,
        color: rgb(0.4, 0.4, 0.4),
    });

    return Buffer.from(await pdf.save());
}

// ---------------------------------------------------------------------------------------------------------------------
// ECG: vẽ tín hiệu từng lead (A4 ngang)
// ---------------------------------------------------------------------------------------------------------------------
const ECG_MAX_SECONDS = 30; // chỉ vẽ tối đa 30 giây đầu để PDF gọn

/** Tạo path SVG (gốc trên-trái) cho 1 lead; nếu nhiều mẫu hơn số pixel thì gộp theo min/max để không mất đỉnh R. */
function buildLeadPath(samples: ArrayLike<number>, count: number, widthPt: number, heightPt: number, lo: number, hi: number): string {
    const span = hi - lo || 1;
    const yOf = (v: number) => ((hi - v) / span) * heightPt;
    const xOf = (i: number) => (i / Math.max(count - 1, 1)) * widthPt;
    const parts: string[] = [];

    const buckets = Math.floor(widthPt);
    if (count <= buckets * 2) {
        for (let i = 0; i < count; i++) parts.push(`${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(2)} ${yOf(samples[i]).toFixed(2)}`);
    } else {
        const size = count / buckets;
        for (let b = 0; b < buckets; b++) {
            const from = Math.floor(b * size);
            const to = Math.min(count, Math.floor((b + 1) * size));
            let minI = from;
            let maxI = from;
            for (let i = from; i < to; i++) {
                if (samples[i] < samples[minI]) minI = i;
                if (samples[i] > samples[maxI]) maxI = i;
            }
            // giữ đúng thứ tự thời gian giữa điểm min và max
            const [first, second] = minI <= maxI ? [minI, maxI] : [maxI, minI];
            parts.push(`${b === 0 ? 'M' : 'L'} ${xOf(first).toFixed(2)} ${yOf(samples[first]).toFixed(2)}`);
            if (second !== first) parts.push(`L ${xOf(second).toFixed(2)} ${yOf(samples[second]).toFixed(2)}`);
        }
    }
    return parts.join(' ');
}

export async function buildEcgPdf(input: EcgPdfInput): Promise<Buffer> {
    const { pdf, font, bold, fmt } = await createDoc();
    const pageSize: [number, number] = [841.89, 595.28]; // A4 ngang
    const margin = 40;
    const labelW = 34; // chừa chỗ ghi tên lead bên trái
    const plotLeft = margin + labelW;
    const plotW = pageSize[0] - margin - plotLeft;
    const stripH = 100;
    const stripGap = 22;
    const fs_ = Math.max(input.sampleRateHz, 1);

    let page: PDFPage = pdf.addPage(pageSize);
    let y = pageSize[1] - margin;

    const title = fmt('BIỂU ĐỒ ĐIỆN TÂM ĐỒ (ECG)');
    page.drawText(title, { x: margin, y, size: 15, font: bold });
    y -= 18;
    page.drawText(
        fmt(`${input.patient.fullName} - Mã BN: ${input.patient.patientCode} - Lượt khám: ${input.patient.encounterCode ?? '-'}`),
        { x: margin, y, size: 10, font },
    );
    y -= 13;

    const totalSamples = Math.max(...input.leads.map((l) => l.length), 0);
    const totalSec = totalSamples / fs_;
    const shownSamples = Math.min(totalSamples, Math.round(ECG_MAX_SECONDS * fs_));
    const shownMs = (shownSamples / fs_) * 1000;
    const trimmed = shownSamples < totalSamples;

    page.drawText(
        fmt(
            `Ghi lúc: ${fmtDateTime(input.recordedAt)} - Tần số lấy mẫu: ${fs_} Hz - Thời lượng: ${totalSec.toFixed(1)} s` +
                (trimmed ? ` (hiển thị ${ECG_MAX_SECONDS} s đầu)` : ''),
        ),
        { x: margin, y, size: 9, font, color: rgb(0.35, 0.35, 0.35) },
    );
    y -= 13;

    if (input.aiOverallResult) {
        const label: Record<string, string> = {
            normal: 'Bình thường',
            abnormal: 'Có bất thường',
            inconclusive: 'Chưa kết luận',
            poor_signal: 'Tín hiệu kém',
        };
        const abnormal = input.aiOverallResult === 'abnormal';
        page.drawText(fmt(`Phân tích AI (tham khảo): ${label[input.aiOverallResult] ?? input.aiOverallResult}`), {
            x: margin,
            y,
            size: 10,
            font: bold,
            color: abnormal ? rgb(0.75, 0.1, 0.1) : rgb(0.1, 0.4, 0.2),
        });
        y -= 13;
    }
    if (input.anomalies?.length) {
        page.drawRectangle({ x: margin, y: y - 1, width: 10, height: 8, color: rgb(1, 0.6, 0.6), opacity: 0.6 });
        page.drawText(fmt('Vùng tô đỏ: đoạn tín hiệu AI đánh dấu bất thường'), { x: margin + 14, y, size: 8, font });
        y -= 12;
    }
    y -= 8;

    const tickStep = shownMs / 1000 <= 12 ? 1 : 5; // giây giữa 2 vạch thời gian

    input.leads.forEach((samples, k) => {
        // Hết chỗ -> sang trang mới (không lặp lại phần tiêu đề)
        if (y - stripH - 14 < margin) {
            page = pdf.addPage(pageSize);
            y = pageSize[1] - margin;
        }
        const top = y;
        const bottom = y - stripH;

        // Nền lưới: khung + vạch dọc theo giây + 4 vạch ngang
        page.drawRectangle({ x: plotLeft, y: bottom, width: plotW, height: stripH, color: rgb(1, 0.98, 0.98), borderColor: rgb(0.85, 0.7, 0.7), borderWidth: 0.6 });
        for (let s = tickStep; s * 1000 < shownMs; s += tickStep) {
            const x = plotLeft + ((s * 1000) / shownMs) * plotW;
            page.drawLine({ start: { x, y: bottom }, end: { x, y: top }, thickness: 0.4, color: rgb(0.9, 0.78, 0.78) });
        }
        for (let h = 1; h < 4; h++) {
            const gy = bottom + (stripH / 4) * h;
            page.drawLine({ start: { x: plotLeft, y: gy }, end: { x: plotLeft + plotW, y: gy }, thickness: 0.3, color: rgb(0.92, 0.84, 0.84) });
        }

        // Tô vùng bất thường do AI đánh dấu (nếu có)
        for (const a of input.anomalies ?? []) {
            if (a.startOffsetMs >= shownMs) continue;
            const x1 = plotLeft + (a.startOffsetMs / shownMs) * plotW;
            const x2 = plotLeft + (Math.min(a.endOffsetMs, shownMs) / shownMs) * plotW;
            page.drawRectangle({ x: x1, y: bottom, width: Math.max(x2 - x1, 1.5), height: stripH, color: rgb(1, 0.6, 0.6), opacity: 0.35 });
        }

        // Đường tín hiệu: co giãn theo biên độ của chính lead đó (giữ đơn vị gốc của tệp)
        const count = Math.min(samples.length, shownSamples);
        if (count > 1) {
            let lo = Infinity;
            let hi = -Infinity;
            for (let i = 0; i < count; i++) {
                if (samples[i] < lo) lo = samples[i];
                if (samples[i] > hi) hi = samples[i];
            }
            const pad = (hi - lo || 1) * 0.1;
            const d = buildLeadPath(samples, count, plotW, stripH, lo - pad, hi + pad);
            page.drawSvgPath(d, { x: plotLeft, y: top, borderColor: rgb(0.05, 0.05, 0.05), borderWidth: 0.7 });
        }

        page.drawText(fmt(input.leadNames[k] ?? `L${k + 1}`), { x: margin, y: top - 12, size: 10, font: bold });

        // Nhãn thời gian dưới mỗi dải
        for (let s = 0; s * 1000 <= shownMs; s += tickStep) {
            const x = plotLeft + ((s * 1000) / shownMs) * plotW;
            page.drawText(`${s}s`, { x: x - 4, y: bottom - 9, size: 6.5, font, color: rgb(0.4, 0.4, 0.4) });
        }
        y = bottom - stripGap;
    });

    return Buffer.from(await pdf.save());
}
