import { BadRequestException } from '@nestjs/common';
import { StructuredExaminationDto, StructuredSection, STRUCTURED_SECTIONS } from './dto/structured-examination.dto';

/**
 * Chuẩn hoá + kiểm tra nhất quán + sinh văn bản tiếng Việt từ phiếu khám có cấu trúc.
 * Thuần hàm (không phụ thuộc DB / Nest DI) nên test trực tiếp được.
 */

export type StructuredFindings = Partial<Record<StructuredSection, Record<string, any>>>;

const SYNDROME_LABELS: Record<string, string> = {
    heart_failure_left: 'Hội chứng suy tim trái',
    heart_failure_right: 'Hội chứng suy tim phải',
    heart_failure_global: 'Hội chứng suy tim toàn bộ',
    valvular_disease: 'Hội chứng hẹp/hở van tim',
    pericardial_effusion_watch: 'Theo dõi tràn dịch màng ngoài tim',
    aortic_aneurysm_watch: 'Theo dõi phình động mạch chủ',
    arrhythmia: 'Loạn nhịp tim',
};
const CHEST_LABELS: Record<string, string> = {
    symmetric: 'Lồng ngực cân đối',
    deformed_bulging: 'Lồng ngực biến dạng/lồi',
    barrel: 'Lồng ngực hình thùng',
};
const DYNAMICS_LABELS: Record<string, string> = {
    normal: 'bình thường',
    forceful_displaced: 'đập mạnh nảy xa',
    retraction: 'co kéo',
    indistinct: 'đập không rõ',
};
const THRILL_LOCATION_LABELS: Record<string, string> = {
    apex: 'mỏm tim',
    base: 'đáy tim',
    left_sternal_border: 'dọc bờ trái xương ức',
};
const CYCLE_LABELS: Record<string, string> = { systolic: 'tâm thu', diastolic: 'tâm trương', continuous: 'liên tục' };
const DULLNESS_LABELS: Record<string, string> = {
    normal: 'Diện đục của tim trong giới hạn bình thường',
    left_enlarged: 'Diện đục giãn rộng sang trái (nghi phì đại/giãn thất trái)',
    right_enlarged: 'Diện đục giãn rộng sang phải (nghi phì đại/giãn thất phải)',
    global_enlarged: 'Diện đục giãn rộng toàn bộ/hình bầu rượu (nghi tràn dịch màng ngoài tim)',
};
const RHYTHM_LABELS: Record<string, string> = {
    regular: 'nhịp đều',
    irregular: 'nhịp không đều',
    completely_irregular: 'loạn nhịp hoàn toàn',
    extrasystoles: 'ngoại tâm thu',
};
const SOUND_LABELS: Record<string, string> = { muffled: 'mờ', loud: 'đanh/mạnh', split: 'tách đôi' };

// ───────────────────────── chuẩn hoá ─────────────────────────

/** Bỏ null/undefined/chuỗi rỗng/object rỗng (đệ quy) để JSON lưu gọn và so sánh ổn định. */
export function pruneEmpty<T>(value: T): T | undefined {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string') {
        const t = value.trim();
        return (t.length ? t : undefined) as any;
    }
    if (Array.isArray(value)) {
        const arr = value.map((v) => pruneEmpty(v)).filter((v) => v !== undefined);
        return (arr.length ? arr : undefined) as any;
    }
    if (typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            const pv = pruneEmpty(v);
            if (pv !== undefined) out[k] = pv;
        }
        return (Object.keys(out).length ? out : undefined) as any;
    }
    return value; // number | boolean (false được giữ: "Không có rung miêu" là thông tin lâm sàng)
}

/** Class instance (sau ValidationPipe transform) -> plain object, đã bỏ giá trị rỗng, mỗi mục độc lập. */
export function normalizeStructured(dto?: StructuredExaminationDto): StructuredFindings {
    const out: StructuredFindings = {};
    if (!dto) return out;
    const plain = JSON.parse(JSON.stringify(dto));
    for (const section of STRUCTURED_SECTIONS) {
        const v = pruneEmpty(plain[section]);
        if (v) out[section] = v as Record<string, any>;
    }
    return out;
}

// ───────────────────────── kiểm tra nhất quán ─────────────────────────

/** Các mâu thuẫn lâm sàng/logic mà class-validator không bắt được. Ném 400 gom đủ lỗi một lượt. */
export function assertStructuredConsistent(s: StructuredFindings): void {
    const errors: string[] = [];

    const skin = s.inspection?.skinMucosa;
    if (skin?.normal && (skin.cyanosis || skin.clubbing)) {
        errors.push('inspection.skinMucosa: "bình thường" mâu thuẫn với tím tái / ngón tay dùi trống.');
    }

    const thrill = s.palpation?.thrill;
    if (thrill?.present) {
        if (!thrill.location) errors.push('palpation.thrill: có rung miêu thì phải chọn vị trí (location).');
        if (!thrill.cycle) errors.push('palpation.thrill: có rung miêu thì phải chọn chu kỳ (cycle).');
        if (thrill.location === 'other' && !thrill.locationOther) {
            errors.push('palpation.thrill: location = other thì phải nhập locationOther.');
        }
    }

    const dull = s.percussion;
    if (dull?.cardiacDullness === 'other' && !dull.other) {
        errors.push('percussion: cardiacDullness = other thì phải mô tả trong "other".');
    }

    const sounds = s.auscultation?.heartSounds;
    if (sounds?.normal && (sounds.s1 || sounds.s2)) {
        errors.push('auscultation.heartSounds: "T1, T2 bình thường" mâu thuẫn với T1/T2 bất thường.');
    }

    const m = s.auscultation?.murmurs;
    if (m?.none && (m.systolic || m.diastolic || m.continuous || m.pericardialRub || m.gallop)) {
        errors.push('auscultation.murmurs: "không phát hiện tiếng thổi" mâu thuẫn với các tiếng thổi/tiếng tim bất thường đã chọn.');
    }

    if (errors.length) {
        throw new BadRequestException({ statusCode: 400, error: 'Bad Request', message: errors });
    }
}

// ───────────────────────── sinh văn bản ─────────────────────────

const join = (parts: (string | undefined | false)[], sep = '; ') => parts.filter(Boolean).join(sep);

export function composeInspection(i: Record<string, any>): string {
    const skin = i.skinMucosa;
    return join([
        skin &&
            join(
                [
                    skin.normal && 'Da & niêm mạc bình thường',
                    skin.cyanosis && 'môi/đầu chi tím tái',
                    skin.clubbing && 'ngón tay dùi trống',
                    skin.other && `da/niêm mạc khác: ${skin.other}`,
                ],
                ', ',
            ),
        i.chestShape && CHEST_LABELS[i.chestShape],
        i.surgicalScar && `Sẹo mổ cũ: ${i.surgicalScar}`,
        i.apexPulsation?.forcefulApex && 'Mỏm tim đập mạnh/diện đập rộng',
        i.apexPulsation?.weakApex && 'Nhịp tim yếu/mờ',
        i.apexPulsation?.pulsatileMass && 'Khối u đập theo nhịp tim ở sườn/sát xương ức',
        i.neck?.jugularVenousDistension && 'Tĩnh mạch cổ nổi',
        i.neck?.carotidPulsation && 'Động mạch chủ/động mạch cổ đập mạnh',
        i.neck?.thyromegaly && 'Tuyến giáp to bất thường',
        i.abdomen?.epigastricPulsation && 'Vùng thượng vị đập theo nhịp tim',
        i.abdomen?.hepatomegaly && 'Gan to/hạ sườn phải dày',
        i.other && `Khác: ${i.other}`,
    ]);
}

export function composePalpation(p: Record<string, any>): string {
    const apex = p.apex;
    const apexPos =
        apex &&
        join(
            [
                (apex.intercostalSpace || apex.line) &&
                    `Mỏm tim ${join([apex.intercostalSpace && `ở khoang liên sườn ${apex.intercostalSpace}`, apex.line && `đường ${apex.line}`], ', ')}`,
                apex.dynamics && `động lực ${DYNAMICS_LABELS[apex.dynamics]}`,
            ],
            ', ',
        );
    let thrillText: string | undefined;
    if (p.thrill) {
        if (!p.thrill.present) thrillText = 'Không có rung miêu';
        else {
            const loc = p.thrill.location === 'other' ? p.thrill.locationOther : THRILL_LOCATION_LABELS[p.thrill.location];
            thrillText = `Có rung miêu ${CYCLE_LABELS[p.thrill.cycle]} ở ${loc}`;
        }
    }
    return join([
        apexPos,
        thrillText,
        p.hartzerSign && `Dấu hiệu Hartzer ${p.hartzerSign === 'positive' ? '(+)' : '(-)'}`,
        p.other && `Khác: ${p.other}`,
    ]);
}

export function composePercussion(p: Record<string, any>): string {
    return join([p.cardiacDullness && DULLNESS_LABELS[p.cardiacDullness], p.other && `Khác: ${p.other}`]);
}

export function composeAuscultation(a: Record<string, any>): string {
    const hs = a.heartSounds;
    const m = a.murmurs;
    const murmur = (label: string, v?: { grade: number; radiation?: string }) =>
        v && `Tiếng thổi ${label} ${v.grade}/6${v.radiation ? `, lan ${v.radiation}` : ''}`;
    return join([
        a.heartRate && `Tần số tim ${a.heartRate} lần/phút`,
        a.rhythm && RHYTHM_LABELS[a.rhythm].replace(/^./, (c: string) => c.toUpperCase()),
        hs?.normal && 'T1, T2 bình thường',
        hs?.s1 && `T1 ${SOUND_LABELS[hs.s1]}`,
        hs?.s2 && `T2 ${SOUND_LABELS[hs.s2]}`,
        m?.none && 'Không phát hiện tiếng thổi',
        murmur('tâm thu', m?.systolic),
        murmur('tâm trương', m?.diastolic),
        m?.continuous && 'Tiếng thổi liên tục',
        m?.pericardialRub && 'Tiếng cọ màng tim',
        m?.gallop && 'Tiếng T3/T4 (nhịp ngựa phi)',
        m?.other && `Khác: ${m.other}`,
    ]);
}

export function composeAssessment(a: Record<string, any>): string {
    const syndromes = [
        ...((a.syndromes as string[] | undefined) ?? []).map((c) => SYNDROME_LABELS[c] ?? c),
        ...(a.syndromeOther ? [a.syndromeOther as string] : []),
    ];
    return join(
        [syndromes.length ? `Hội chứng/tình trạng ghi nhận: ${syndromes.join(', ')}.` : undefined, a.summary],
        '\n',
    );
}

export interface ComposedTexts {
    inspectionFindings?: string;
    palpationFindings?: string;
    percussionFindings?: string;
    auscultationFindings?: string;
    clinicalNotes?: string;
}

/** Văn bản sinh ra cho TỪNG mục có trong `structured` (mục không có -> không có key). */
export function composeTexts(s: StructuredFindings): ComposedTexts {
    const out: ComposedTexts = {};
    if (s.inspection) out.inspectionFindings = composeInspection(s.inspection);
    if (s.palpation) out.palpationFindings = composePalpation(s.palpation);
    if (s.percussion) out.percussionFindings = composePercussion(s.percussion);
    if (s.auscultation) out.auscultationFindings = composeAuscultation(s.auscultation);
    if (s.assessment) out.clinicalNotes = composeAssessment(s.assessment);
    return out;
}
