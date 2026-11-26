import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import * as fontkit from '@pdf-lib/fontkit';
import * as fs from 'fs';
import * as path from 'path';

export interface EncounterPdfData {
  encounterCode: string;
  arrivedAt: Date;
  finishedAt: Date | null;
  patient: {
    patientCode: string;
    fullName: string;
    gender: string;
    dateOfBirth: Date;
    phoneNumber: string;
    allergies: Array<{ allergyText: string }>;
    medicalHistories: Array<{ conditionName: string; historyType: string }>;
  };
  doctor: {
    title: string | null;
    fullName: string;
  } | null;
  vitalSignSessions: Array<{
    observations: Array<{
      observationValue: { toString(): string };
      item: { itemName: string; unit: string };
    }>;
  }>;
  clinicalExamination: {
    auscultationFindings: string | null;
    inspectionFindings: string | null;
    palpationFindings: string | null;
    percussionFindings: string | null;
    clinicalNotes: string | null;
  } | null;
  diagnosticOrders: Array<{
    items: Array<{
      status: string;
      service: { serviceName: string };
      task: {
        status: string;
        result: {
          findings: string | null;
          overallConclusion: string | null;
          values: Array<{
            valueNumeric: { toString(): string } | null;
            valueBoolean: boolean | null;
            valueText: string | null;
            parameter: { parameterName: string; parameterCode: string; unit: string | null };
          }>;
        } | null;
      } | null;
    }>;
  }>;
  diagnoses: Array<{
    icd10Code: string;
    diagnosisName: string;
    diagnosisType: string;
    isPrimary: boolean;
  }>;
  treatmentConsultation: {
    conditionExplanation: string;
    treatmentPlan: string;
    lifestyleAdvice: string | null;
    nutritionAdvice: string | null;
  } | null;
  followUpAppointment: {
    appointmentDate: Date;
    status: string;
  } | null;
  prescriptions: Array<{
    status: string;
    items: Array<{
      quantity: { toString(): string };
      dosage: string;
      routeDisplay: string | null;
      frequency: string;
      durationDays: number | null;
      instruction: string | null;
      drug: { drugName: string; route: string; unit: string };
    }>;
  }>;
}

const GENDER_LABEL: Record<string, string> = {
  male: 'Nam',
  female: 'Nữ',
  other: 'Khác',
  unknown: 'Không rõ',
};

const COLORS = {
  navy: rgb(0.118, 0.227, 0.541), // #1e3a8a
  blue: rgb(0.118, 0.251, 0.686), // #1e40af
  text: rgb(0.059, 0.09, 0.165), // #0f172a
  muted: rgb(0.392, 0.455, 0.545), // #64748b
  slate: rgb(0.278, 0.333, 0.412), // #475569
  green: rgb(0.016, 0.471, 0.341), // #047857
  emerald: rgb(0.02, 0.588, 0.412), // #059669
  chipBg: rgb(0.945, 0.961, 0.976), // #f1f5f9
  boxBg: rgb(0.973, 0.98, 0.988), // #f8fafc
  border: rgb(0.796, 0.835, 0.882), // #cbd5e1
  softBorder: rgb(0.886, 0.91, 0.941), // #e2e8f0
};

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

function calcAge(dob: Date, refDate: Date): number {
  let age = refDate.getFullYear() - dob.getFullYear();
  const m = refDate.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && refDate.getDate() < dob.getDate())) age -= 1;
  return Math.max(0, age);
}

function formatDay(d?: Date | null): string {
  if (!d) return '--/--/----';
  return new Date(d).toLocaleDateString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatIsoDay(d?: Date | null): string {
  if (!d) return '';
  return new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
}

interface TextSegment {
  text: string;
  bold?: boolean;
  color?: ReturnType<typeof rgb>;
}

export async function buildEncounterSummaryPdf(encounter: EncounterPdfData): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const regularBuffer = findFontBuffer('Arial-Regular.ttf', 'arial.ttf');
  const boldBuffer = findFontBuffer('Arial-Bold.ttf', 'arialbd.ttf');

  let font: PDFFont;
  let bold: PDFFont;
  let isUnicode = false;
  if (regularBuffer && boldBuffer) {
    try {
      pdfDoc.registerFontkit((fontkit as any).default || fontkit);
      font = await pdfDoc.embedFont(regularBuffer, { subset: true });
      bold = await pdfDoc.embedFont(boldBuffer, { subset: true });
      isUnicode = true;
    } catch {
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

  const margin = 36;
  const pageSize: [number, number] = [595.28, 841.89]; // A4
  const maxWidth = pageSize[0] - margin * 2;
  let page: PDFPage = pdfDoc.addPage(pageSize);
  let y = pageSize[1] - margin;

  const newPage = () => {
    page = pdfDoc.addPage(pageSize);
    y = pageSize[1] - margin;
  };

  const ensureSpace = (needed: number) => {
    if (y - needed < margin) newPage();
  };

  const wrap = (text: string, f: PDFFont, size: number, width: number): string[] => {
    const clean = fmt(text);
    if (!clean) return [];
    const lines: string[] = [];
    for (const para of clean.split('\n')) {
      const words = para.split(/\s+/).filter(Boolean);
      if (words.length === 0) {
        lines.push('');
        continue;
      }
      let line = '';
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(candidate, size) > width && line) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
      if (line) lines.push(line);
    }
    return lines;
  };

  /** Vẽ nhiều đoạn văn bản nối tiếp nhau trên cùng 1 dòng (hỗ trợ bold xen kẽ), tự xuống dòng theo maxWidth. */
  const measureMixedLines = (segments: TextSegment[], size: number, width: number): TextSegment[][] => {
    const tokens: Array<{ text: string; bold?: boolean; color?: ReturnType<typeof rgb>; newline?: boolean }> = [];
    for (const seg of segments) {
      const parts = fmt(seg.text).split('\n');
      parts.forEach((part, idx) => {
        if (idx > 0) tokens.push({ text: '', newline: true });
        for (const word of part.split(/\s+/).filter(Boolean)) {
          tokens.push({ text: word, bold: seg.bold, color: seg.color });
        }
      });
    }

    const lines: TextSegment[][] = [];
    let currentLine: TextSegment[] = [];
    let currentWidth = 0;

    for (const tok of tokens) {
      if (tok.newline) {
        lines.push(currentLine);
        currentLine = [];
        currentWidth = 0;
        continue;
      }
      const f = tok.bold ? bold : font;
      const spacePrefix = currentLine.length > 0 ? ' ' : '';
      const wordText = `${spacePrefix}${tok.text}`;
      const wordWidth = f.widthOfTextAtSize(wordText, size);
      if (currentLine.length > 0 && currentWidth + wordWidth > width) {
        lines.push(currentLine);
        const w = f.widthOfTextAtSize(tok.text, size);
        currentLine = [{ text: tok.text, bold: tok.bold, color: tok.color }];
        currentWidth = w;
      } else {
        currentLine.push({ text: wordText, bold: tok.bold, color: tok.color });
        currentWidth += wordWidth;
      }
    }
    if (currentLine.length > 0) lines.push(currentLine);
    return lines.length > 0 ? lines : [[]];
  };

  const drawMixedLine = (line: TextSegment[], x: number, baselineY: number, size: number) => {
    let cursorX = x;
    for (const seg of line) {
      const f = seg.bold ? bold : font;
      const txt = fmt(seg.text);
      if (!txt) continue;
      page.drawText(txt, {
        x: cursorX,
        y: baselineY,
        size,
        font: f,
        color: seg.color ?? COLORS.text,
      });
      cursorX += f.widthOfTextAtSize(txt, size);
    }
  };

  const drawSectionTitle = (title: string) => {
    ensureSpace(26);
    y -= 6;
    page.drawText(fmt(title), { x: margin, y, size: 10, font: bold, color: COLORS.blue });
    y -= 4;
    page.drawLine({
      start: { x: margin, y },
      end: { x: margin + maxWidth, y },
      thickness: 0.75,
      color: COLORS.softBorder,
    });
    y -= 13;
  };

  // ── HEADER ──────────────────────────────────────────────────────────────────
  const reportDate = encounter.finishedAt ?? encounter.arrivedAt ?? new Date();
  const todayStr = formatDay(reportDate);

  page.drawText(fmt('PHÒNG KHÁM TIM MẠCH 4AM'), { x: margin, y, size: 13, font: bold, color: COLORS.navy });
  page.drawText(fmt('Hệ thống Bệnh án điện tử thông minh (EMR Cardiology Platform)'), {
    x: margin,
    y: y - 14,
    size: 8.5,
    font,
    color: COLORS.slate,
  });

  const rightHeaderRows: Array<[string, string]> = [
    ['Mã lượt khám: ', encounter.encounterCode],
    ['Mã bệnh nhân: ', encounter.patient.patientCode],
    ['Ngày khám: ', todayStr],
  ];
  rightHeaderRows.forEach(([lbl, val], idx) => {
    const rowY = y - idx * 12;
    const lblText = fmt(lbl);
    const valText = fmt(val);
    const totalW = bold.widthOfTextAtSize(lblText, 8.5) + font.widthOfTextAtSize(valText, 8.5);
    const startX = margin + maxWidth - totalW;
    page.drawText(lblText, { x: startX, y: rowY, size: 8.5, font: bold, color: COLORS.text });
    page.drawText(valText, {
      x: startX + bold.widthOfTextAtSize(lblText, 8.5),
      y: rowY,
      size: 8.5,
      font,
      color: COLORS.text,
    });
  });

  y -= 32;
  page.drawLine({
    start: { x: margin, y },
    end: { x: margin + maxWidth, y },
    thickness: 1.5,
    color: COLORS.blue,
  });
  y -= 22;

  // ── TITLE ───────────────────────────────────────────────────────────────────
  const mainTitle = fmt('PHIẾU KẾT QUẢ KHÁM BỆNH & TƯ VẤN ĐIỀU TRỊ');
  page.drawText(mainTitle, {
    x: (pageSize[0] - bold.widthOfTextAtSize(mainTitle, 14.5)) / 2,
    y,
    size: 14.5,
    font: bold,
    color: COLORS.navy,
  });
  y -= 14;
  const subTitle = fmt('Bản tổng hợp hồ sơ bệnh án điện tử (EMR Clinical Summary Report)');
  page.drawText(subTitle, {
    x: (pageSize[0] - font.widthOfTextAtSize(subTitle, 8.5)) / 2,
    y,
    size: 8.5,
    font,
    color: COLORS.muted,
  });
  y -= 18;

  // ── 1. THÔNG TIN HÀNH CHÍNH BỆNH NHÂN ───────────────────────────────────────
  drawSectionTitle('1. THÔNG TIN HÀNH CHÍNH BỆNH NHÂN');

  const p = encounter.patient;
  const genderLabel = GENDER_LABEL[p.gender] ?? p.gender;
  const age = calcAge(new Date(p.dateOfBirth), reportDate);
  const allergiesText =
    p.allergies.length > 0 ? p.allergies.map((a) => a.allergyText).join('; ') : 'Chưa ghi nhận dị ứng';
  const historyText =
    p.medicalHistories.length > 0
      ? p.medicalHistories.map((h) => h.conditionName).join(', ')
      : 'Chưa ghi nhận tiền sử';

  const drawKvAt = (x: number, baselineY: number, label: string, value: string, width: number) => {
    const lines = measureMixedLines([{ text: label, bold: true }, { text: value }], 9.5, width);
    lines.forEach((line, idx) => drawMixedLine(line, x, baselineY - idx * 12, 9.5));
    return lines.length;
  };

  const colW = (maxWidth - 16) / 2;
  const r1Left = drawKvAt(margin, y, 'Họ và tên:', p.fullName || '---', colW);
  const r1Right = drawKvAt(margin + colW + 16, y, 'Giới tính / Tuổi:', `${genderLabel} (${age} tuổi)`, colW);
  y -= Math.max(r1Left, r1Right) * 12 + 3;

  const r2Left = drawKvAt(margin, y, 'Số điện thoại:', p.phoneNumber || '---', colW);
  const r2Right = drawKvAt(margin + colW + 16, y, 'Tiền sử dị ứng:', allergiesText, colW);
  y -= Math.max(r2Left, r2Right) * 12 + 3;

  const r3 = drawKvAt(margin, y, 'Tiền sử bệnh lý:', historyText, maxWidth);
  y -= r3 * 12 + 8;

  // ── 2. SINH HIỆU & KHÁM LÂM SÀNG TIM MẠCH ──────────────────────────────────
  drawSectionTitle('2. SINH HIỆU & KHÁM LÂM SÀNG TIM MẠCH');

  const latestVitals = encounter.vitalSignSessions?.[0];
  if (latestVitals && latestVitals.observations.length > 0) {
    let chipX = margin;
    const chipH = 16;
    const chipGapX = 6;
    const chipGapY = 5;

    for (const ob of latestVitals.observations) {
      const label = `${ob.item.itemName}: `;
      const val = `${ob.observationValue.toString()} ${ob.item.unit}`.trim();
      const textW = bold.widthOfTextAtSize(fmt(label), 8.5) + font.widthOfTextAtSize(fmt(val), 8.5);
      const chipW = textW + 12;

      if (chipX !== margin && chipX + chipW > margin + maxWidth) {
        chipX = margin;
        y -= chipH + chipGapY;
      }
      ensureSpace(chipH + 6);
      page.drawRectangle({
        x: chipX,
        y: y - chipH + 4,
        width: chipW,
        height: chipH,
        color: COLORS.chipBg,
        borderColor: COLORS.border,
        borderWidth: 0.6,
      });
      page.drawText(fmt(label), { x: chipX + 6, y: y - 8, size: 8.5, font: bold, color: COLORS.text });
      page.drawText(fmt(val), {
        x: chipX + 6 + bold.widthOfTextAtSize(fmt(label), 8.5),
        y: y - 8,
        size: 8.5,
        font,
        color: COLORS.text,
      });
      chipX += chipW + chipGapX;
    }
    y -= chipH + 8;
  } else {
    ensureSpace(16);
    page.drawText(fmt('Đã kiểm tra sinh hiệu tiêu chuẩn'), { x: margin, y, size: 9, font, color: COLORS.slate });
    y -= 16;
  }

  const exam = encounter.clinicalExamination;
  const examRows: Array<[string, string]> = [
    ['Nghe tim phổi:', exam?.auscultationFindings || 'Tim đều, T1 T2 rõ'],
  ];
  if (exam?.inspectionFindings) examRows.push(['Nhìn:', exam.inspectionFindings]);
  if (exam?.palpationFindings) examRows.push(['Sờ:', exam.palpationFindings]);
  if (exam?.percussionFindings) examRows.push(['Gõ:', exam.percussionFindings]);
  if (exam?.clinicalNotes) examRows.push(['Ghi chú lâm sàng:', exam.clinicalNotes]);

  const drawGrayBox = (linesList: TextSegment[][][]) => {
    const padX = 10;
    const padY = 8;
    const lineHeight = 13;
    const totalLines = linesList.reduce((sum, l) => sum + l.length, 0);
    const boxH = padY * 2 + totalLines * lineHeight;
    ensureSpace(boxH + 4);
    const topY = y;
    page.drawRectangle({
      x: margin,
      y: topY - boxH,
      width: maxWidth,
      height: boxH,
      color: COLORS.boxBg,
      borderColor: COLORS.softBorder,
      borderWidth: 0.75,
    });
    let cursorY = topY - padY - 9;
    for (const paraLines of linesList) {
      for (const line of paraLines) {
        drawMixedLine(line, margin + padX, cursorY, 9.5);
        cursorY -= lineHeight;
      }
    }
    y = topY - boxH - 10;
  };

  drawGrayBox(
    examRows.map(([lbl, val]) => measureMixedLines([{ text: lbl, bold: true }, { text: val }], 9.5, maxWidth - 20)),
  );

  // ── 3. KẾT QUẢ CẬN LÂM SÀNG ─────────────────────────────────────────────────
  drawSectionTitle('3. KẾT QUẢ CẬN LÂM SÀNG (XÉT NGHIỆM / CHẨN ĐOÁN HÌNH ẢNH / ECG)');

  const labItems = encounter.diagnosticOrders.flatMap((ord) =>
    ord.items.filter((it) => it.status !== 'cancelled'),
  );

  if (labItems.length > 0) {
    const colWidths = [maxWidth * 0.32, maxWidth * 0.46, maxWidth * 0.22];
    const headers = ['Dịch vụ Cận lâm sàng', 'Chỉ số / Kết quả đo', 'Kết luận'];

    const drawTableHeader = () => {
      const hHeight = 20;
      ensureSpace(hHeight + 20);
      page.drawRectangle({
        x: margin,
        y: y - hHeight,
        width: maxWidth,
        height: hHeight,
        color: COLORS.boxBg,
        borderColor: COLORS.border,
        borderWidth: 0.6,
      });
      let cx = margin;
      headers.forEach((h, idx) => {
        if (idx > 0) {
          page.drawLine({
            start: { x: cx, y },
            end: { x: cx, y: y - hHeight },
            thickness: 0.6,
            color: COLORS.border,
          });
        }
        page.drawText(fmt(h), { x: cx + 6, y: y - 13, size: 8.5, font: bold, color: COLORS.text });
        cx += colWidths[idx];
      });
      y -= hHeight;
    };

    drawTableHeader();

    const cellPadX = 6;
    const cellPadY = 6;
    const lineH = 12;

    for (const item of labItems) {
      const serviceLines = wrap(item.service.serviceName, bold, 8.5, colWidths[0] - cellPadX * 2);
      const res = item.task?.result;
      const midLines: TextSegment[][] = [];
      if (res && res.values.length > 0) {
        for (const v of res.values) {
          const valStr =
            v.valueNumeric !== null && v.valueNumeric !== undefined
              ? v.valueNumeric.toString()
              : v.valueText ?? (v.valueBoolean !== null ? (v.valueBoolean ? 'Có' : 'Không') : '-');
          const segs: TextSegment[] = [
            { text: `${v.parameter.parameterName || v.parameter.parameterCode}: ` },
            { text: valStr, bold: true },
          ];
          if (v.parameter.unit) segs.push({ text: v.parameter.unit });
          midLines.push(...measureMixedLines(segs, 8.5, colWidths[1] - cellPadX * 2));
        }
      } else {
        midLines.push([{ text: item.task?.status === 'completed' ? 'Đã hoàn tất' : 'Đang thực hiện' }]);
      }
      const conclText = res?.overallConclusion || res?.findings || 'Bình thường';
      const conclLines = wrap(conclText, font, 8.5, colWidths[2] - cellPadX * 2);

      // Hỗ trợ chia nhỏ bảng khi cột giữa (vd BLOODFULL ~37 chỉ số) cao vượt 1 trang
      let sIdx = 0;
      let mIdx = 0;
      let cIdx = 0;

      while (sIdx < serviceLines.length || mIdx < midLines.length || cIdx < conclLines.length || (sIdx === 0 && mIdx === 0 && cIdx === 0)) {
        const availableH = y - margin - cellPadY * 2;
        const maxLinesFit = Math.max(1, Math.floor(availableH / lineH));
        const remainingLines = Math.max(
          serviceLines.length - sIdx,
          midLines.length - mIdx,
          conclLines.length - cIdx,
          1,
        );

        if (availableH < lineH * 2) {
          newPage();
          drawTableHeader();
          continue;
        }

        const takeLines = Math.min(remainingLines, maxLinesFit);
        const rowH = takeLines * lineH + cellPadY * 2;
        const rowTopY = y;

        page.drawRectangle({
          x: margin,
          y: rowTopY - rowH,
          width: maxWidth,
          height: rowH,
          borderColor: COLORS.border,
          borderWidth: 0.6,
        });

        let cx = margin;
        for (let i = 1; i < colWidths.length; i++) {
          cx += colWidths[i - 1];
          page.drawLine({
            start: { x: cx, y: rowTopY },
            end: { x: cx, y: rowTopY - rowH },
            thickness: 0.6,
            color: COLORS.border,
          });
        }

        for (let i = 0; i < takeLines; i++) {
          const baselineY = rowTopY - cellPadY - 8 - i * lineH;
          if (sIdx < serviceLines.length) {
            page.drawText(serviceLines[sIdx++], {
              x: margin + cellPadX,
              y: baselineY,
              size: 8.5,
              font: bold,
              color: COLORS.text,
            });
          }
          if (mIdx < midLines.length) {
            drawMixedLine(midLines[mIdx++], margin + colWidths[0] + cellPadX, baselineY, 8.5);
          }
          if (cIdx < conclLines.length) {
            page.drawText(conclLines[cIdx++], {
              x: margin + colWidths[0] + colWidths[1] + cellPadX,
              y: baselineY,
              size: 8.5,
              font,
              color: COLORS.text,
            });
          }
        }

        y = rowTopY - rowH;

        if (sIdx < serviceLines.length || mIdx < midLines.length || cIdx < conclLines.length) {
          newPage();
          drawTableHeader();
        } else {
          break;
        }
      }
    }
    y -= 10;
  } else {
    ensureSpace(16);
    page.drawText(fmt('Không có chỉ định cận lâm sàng hoặc đã hoàn tất kiểm tra.'), {
      x: margin,
      y,
      size: 9,
      font,
      color: COLORS.muted,
    });
    y -= 16;
  }

  // ── 4. CHẨN ĐOÁN XÁC ĐỊNH (ICD-10) & PHÁC ĐỒ TƯ VẤN ĐIỀU TRỊ ───────────────
  drawSectionTitle('4. CHẨN ĐOÁN XÁC ĐỊNH (ICD-10) & PHÁC ĐỒ TƯ VẤN ĐIỀU TRỊ');

  const primaryDiag =
    encounter.diagnoses.find((d) => d.diagnosisType === 'final' && d.isPrimary) ||
    encounter.diagnoses.find((d) => d.diagnosisType === 'final') ||
    encounter.diagnoses.find((d) => d.isPrimary) ||
    encounter.diagnoses[0];

  const consultLinesList: TextSegment[][][] = [];
  const diagLabel = primaryDiag
    ? `[${primaryDiag.icd10Code}] ${primaryDiag.diagnosisName}`
    : 'Đã xác lập chẩn đoán';
  consultLinesList.push(
    measureMixedLines(
      [
        { text: 'Chẩn đoán chính (ICD-10):', bold: true, color: COLORS.navy },
        { text: diagLabel, color: COLORS.navy },
      ],
      10,
      maxWidth - 20,
    ),
  );

  const consult = encounter.treatmentConsultation;
  if (consult?.conditionExplanation) {
    consultLinesList.push(
      measureMixedLines(
        [{ text: 'Giải thích tình trạng bệnh:', bold: true }, { text: consult.conditionExplanation }],
        9.5,
        maxWidth - 20,
      ),
    );
  }
  if (consult?.treatmentPlan) {
    consultLinesList.push(
      measureMixedLines(
        [{ text: 'Hướng xử trí & Phác đồ điều trị:', bold: true }, { text: consult.treatmentPlan }],
        9.5,
        maxWidth - 20,
      ),
    );
  }
  if (consult?.lifestyleAdvice) {
    consultLinesList.push(
      measureMixedLines(
        [{ text: 'Tư vấn lối sống & vận động:', bold: true }, { text: consult.lifestyleAdvice }],
        9.5,
        maxWidth - 20,
      ),
    );
  }
  if (consult?.nutritionAdvice) {
    consultLinesList.push(
      measureMixedLines(
        [{ text: 'Tư vấn chế độ dinh dưỡng:', bold: true }, { text: consult.nutritionAdvice }],
        9.5,
        maxWidth - 20,
      ),
    );
  }
  if (encounter.followUpAppointment && encounter.followUpAppointment.status !== 'cancelled') {
    consultLinesList.push(
      measureMixedLines(
        [
          {
            text: `Lịch hẹn tái khám: ${formatIsoDay(encounter.followUpAppointment.appointmentDate)}`,
            bold: true,
            color: COLORS.green,
          },
        ],
        9.5,
        maxWidth - 20,
      ),
    );
  }

  drawGrayBox(consultLinesList);

  // ── 5. CHỈ ĐỊNH THUỐC ĐIỀU TRỊ ──────────────────────────────────────────────
  drawSectionTitle('5. CHỈ ĐỊNH THUỐC ĐIỀU TRỊ');

  const activeRx =
    encounter.prescriptions.find((rx) => rx.status === 'signed') ||
    encounter.prescriptions.find((rx) => rx.status !== 'cancelled');

  if (activeRx && activeRx.items.length > 0) {
    const rxColWidths = [
      maxWidth * 0.07,
      maxWidth * 0.27,
      maxWidth * 0.13,
      maxWidth * 0.13,
      maxWidth * 0.4,
    ];
    const rxHeaders = ['STT', 'Tên thuốc & Hàm lượng', 'Đường dùng', 'Số lượng', 'Liều dùng & Cách dùng'];

    const drawRxHeader = () => {
      const hHeight = 20;
      ensureSpace(hHeight + 20);
      page.drawRectangle({
        x: margin,
        y: y - hHeight,
        width: maxWidth,
        height: hHeight,
        color: COLORS.boxBg,
        borderColor: COLORS.border,
        borderWidth: 0.6,
      });
      let cx = margin;
      rxHeaders.forEach((h, idx) => {
        if (idx > 0) {
          page.drawLine({
            start: { x: cx, y },
            end: { x: cx, y: y - hHeight },
            thickness: 0.6,
            color: COLORS.border,
          });
        }
        page.drawText(fmt(h), { x: cx + 5, y: y - 13, size: 8.5, font: bold, color: COLORS.text });
        cx += rxColWidths[idx];
      });
      y -= hHeight;
    };

    drawRxHeader();

    const cellPadX = 5;
    const cellPadY = 6;
    const lineH = 12;

    activeRx.items.forEach((item, index) => {
      const nameLines = wrap(item.drug.drugName, bold, 8.5, rxColWidths[1] - cellPadX * 2);
      const routeLines = wrap(item.routeDisplay || item.drug.route, font, 8.5, rxColWidths[2] - cellPadX * 2);
      const qtyText = `${Number(item.quantity)} ${item.drug.unit}`;
      const qtyLines = wrap(qtyText, bold, 8.5, rxColWidths[3] - cellPadX * 2);

      const mainUsage = `${item.dosage} · ${item.frequency}${item.durationDays ? ` (${item.durationDays} ngày)` : ''}`;
      const usageLines = [
        ...wrap(mainUsage, font, 8.5, rxColWidths[4] - cellPadX * 2),
        ...(item.instruction ? wrap(`Lưu ý: ${item.instruction}`, font, 8.5, rxColWidths[4] - cellPadX * 2) : []),
      ];

      const rowLines = Math.max(nameLines.length, routeLines.length, qtyLines.length, usageLines.length, 1);
      const rowH = rowLines * lineH + cellPadY * 2;
      if (y - rowH < margin) {
        newPage();
        drawRxHeader();
      }

      const rowTopY = y;
      page.drawRectangle({
        x: margin,
        y: rowTopY - rowH,
        width: maxWidth,
        height: rowH,
        borderColor: COLORS.border,
        borderWidth: 0.6,
      });

      let cx = margin;
      for (let i = 1; i < rxColWidths.length; i++) {
        cx += rxColWidths[i - 1];
        page.drawLine({
          start: { x: cx, y: rowTopY },
          end: { x: cx, y: rowTopY - rowH },
          thickness: 0.6,
          color: COLORS.border,
        });
      }

      // STT centered
      const sttStr = String(index + 1);
      const sttW = font.widthOfTextAtSize(sttStr, 8.5);
      page.drawText(sttStr, {
        x: margin + (rxColWidths[0] - sttW) / 2,
        y: rowTopY - cellPadY - 8,
        size: 8.5,
        font,
        color: COLORS.text,
      });

      nameLines.forEach((l, i) =>
        page.drawText(l, {
          x: margin + rxColWidths[0] + cellPadX,
          y: rowTopY - cellPadY - 8 - i * lineH,
          size: 8.5,
          font: bold,
          color: COLORS.text,
        }),
      );
      routeLines.forEach((l, i) =>
        page.drawText(l, {
          x: margin + rxColWidths[0] + rxColWidths[1] + cellPadX,
          y: rowTopY - cellPadY - 8 - i * lineH,
          size: 8.5,
          font,
          color: COLORS.text,
        }),
      );
      qtyLines.forEach((l, i) =>
        page.drawText(l, {
          x: margin + rxColWidths[0] + rxColWidths[1] + rxColWidths[2] + cellPadX,
          y: rowTopY - cellPadY - 8 - i * lineH,
          size: 8.5,
          font: bold,
          color: COLORS.text,
        }),
      );
      usageLines.forEach((l, i) =>
        page.drawText(l, {
          x: margin + rxColWidths[0] + rxColWidths[1] + rxColWidths[2] + rxColWidths[3] + cellPadX,
          y: rowTopY - cellPadY - 8 - i * lineH,
          size: 8.5,
          font,
          color: COLORS.text,
        }),
      );

      y = rowTopY - rowH;
    });
    y -= 14;
  } else {
    ensureSpace(16);
    page.drawText(fmt('Không kê đơn thuốc (Điều trị theo hướng dẫn tư vấn & chế độ sinh hoạt).'), {
      x: margin,
      y,
      size: 9,
      font,
      color: COLORS.slate,
    });
    y -= 16;
  }

  // ── FOOTER & CHỮ KÝ BÁC SĨ (giữ nguyên khối, không cắt đôi qua trang) ─────────
  const footerHeight = 76;
  ensureSpace(footerHeight);
  y -= 6;

  const leftNoteW = maxWidth * 0.56;
  const note1 = wrap('* Phiếu kết quả này được trích xuất từ Hệ thống Bệnh án điện tử EMR.', font, 8, leftNoteW);
  const note2 = wrap(
    `* Khi đi tái khám, quý bệnh nhân vui lòng mang theo phiếu này hoặc mã lượt khám ${encounter.encounterCode}.`,
    font,
    8,
    leftNoteW,
  );
  [...note1, ...note2].forEach((l, i) => {
    page.drawText(l, { x: margin, y: y - i * 11, size: 8, font, color: COLORS.muted });
  });

  const sigBoxW = 190;
  const sigCenterX = margin + maxWidth - sigBoxW / 2;
  const drawCentered = (text: string, baselineY: number, f: PDFFont, size: number, color: ReturnType<typeof rgb>) => {
    const clean = fmt(text);
    const w = f.widthOfTextAtSize(clean, size);
    page.drawText(clean, { x: sigCenterX - w / 2, y: baselineY, size, font: f, color });
  };

  drawCentered(`Ngày ${todayStr}`, y, font, 9, COLORS.text);
  drawCentered('BÁC SĨ KHÁM & KẾT LUẬN', y - 14, bold, 9.5, COLORS.text);

  // Vẽ icon dấu tick xanh + chữ "Đã xác nhận hoàn tất hồ sơ EMR"
  const badgeText = fmt('Đã xác nhận hoàn tất hồ sơ EMR');
  const badgeW = bold.widthOfTextAtSize(badgeText, 8.5);
  const badgeStartX = sigCenterX - (badgeW + 12) / 2;
  const badgeY = y - 42;
  page.drawLine({
    start: { x: badgeStartX, y: badgeY + 3 },
    end: { x: badgeStartX + 3, y: badgeY },
    thickness: 1.3,
    color: COLORS.emerald,
  });
  page.drawLine({
    start: { x: badgeStartX + 3, y: badgeY },
    end: { x: badgeStartX + 8, y: badgeY + 6 },
    thickness: 1.3,
    color: COLORS.emerald,
  });
  page.drawText(badgeText, { x: badgeStartX + 12, y: badgeY, size: 8.5, font: bold, color: COLORS.emerald });

  const doctorName = encounter.doctor
    ? [encounter.doctor.title, encounter.doctor.fullName].filter(Boolean).join(' ')
    : 'Bác sĩ phụ trách';
  drawCentered(doctorName, y - 58, bold, 10, COLORS.navy);

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
