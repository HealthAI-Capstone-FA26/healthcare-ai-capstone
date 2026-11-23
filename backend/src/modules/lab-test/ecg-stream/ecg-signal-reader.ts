/**
 * Đọc tín hiệu ECG thô (đã lưu trên MinIO) thành mảng số theo từng lead, phục vụ phát lại realtime (stream).
 *
 * Hỗ trợ: csv · json · npy (định dạng mà backend tự đọc được bằng thư viện chuẩn).
 * KHÔNG hỗ trợ: wfdb (.zip) · edf · dicom_ecg · scp_ecg — các định dạng này chỉ dịch vụ AI/FE đọc; stream báo lỗi rõ ràng.
 * Quy ước parse CSV/JSON giữ nguyên với FE (modules/lab/ecg/chart/data/parseSignal.ts) để hai phía ra cùng một dữ liệu.
 */

export const STREAMABLE_SIGNAL_FORMATS = ['csv', 'json', 'npy'] as const;
export type StreamableSignalFormat = (typeof STREAMABLE_SIGNAL_FORMATS)[number];

export class EcgSignalFormatError extends Error {
    constructor(
        public readonly code: 'SIGNAL_FORMAT_NOT_STREAMABLE' | 'SIGNAL_PARSE_FAILED',
        message: string,
    ) {
        super(message);
        this.name = 'EcgSignalFormatError';
    }
}

export interface ParsedEcgSignal {
    leadNames: string[];
    /** leads[k][i] = giá trị mẫu thứ i của lead k (giữ nguyên đơn vị trong tệp, không đổi µV/mV). */
    leads: Float32Array[];
}

export interface EcgSignalParseHints {
    /** Tên lead mặc định khi tệp không có header. */
    leadNames?: string[];
    /** Dùng để đoán chiều của mảng 2D trong .npy / json. */
    numLeads?: number;
}

const TIME_COLUMN = /^(t|time|time_?s|time_?ms|timestamp|sample|index|idx)$/i;

export function isStreamableFormat(format: string | null | undefined): format is StreamableSignalFormat {
    return !!format && (STREAMABLE_SIGNAL_FORMATS as readonly string[]).includes(format);
}

export function parseEcgSignal(format: string, data: Buffer, hints: EcgSignalParseHints = {}): ParsedEcgSignal {
    if (!isStreamableFormat(format)) {
        throw new EcgSignalFormatError(
            'SIGNAL_FORMAT_NOT_STREAMABLE',
            `Định dạng '${format}' chưa hỗ trợ stream. Hỗ trợ: ${STREAMABLE_SIGNAL_FORMATS.join(', ')}.`,
        );
    }
    try {
        const parsed =
            format === 'csv' ? parseCsv(data.toString('utf8'), hints) : format === 'json' ? parseJson(data.toString('utf8'), hints) : parseNpy(data, hints);
        if (parsed.leads.length === 0 || parsed.leads.every((l) => l.length === 0)) throw new Error('Tệp không có mẫu tín hiệu nào.');
        return parsed;
    } catch (err) {
        if (err instanceof EcgSignalFormatError) throw err;
        throw new EcgSignalFormatError('SIGNAL_PARSE_FAILED', `Không đọc được tín hiệu ${format}: ${(err as Error).message}`);
    }
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toFloat32(values: unknown): Float32Array | null {
    if (!Array.isArray(values)) return null;
    const out = new Float32Array(values.length);
    for (let i = 0; i < values.length; i++) {
        const v = Number(values[i]);
        out[i] = Number.isFinite(v) ? v : 0;
    }
    return out;
}

const fallbackName = (hints: EcgSignalParseHints, i: number) => hints.leadNames?.[i] ?? `L${i + 1}`;

function parseCsv(text: string, hints: EcgSignalParseHints): ParsedEcgSignal {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) throw new Error('Tệp CSV không có dữ liệu.');
    const delimiter = lines[0].includes(';') && !lines[0].includes(',') ? ';' : lines[0].includes('\t') ? '\t' : ',';
    const firstCells = lines[0].split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ''));
    const hasHeader = firstCells.some((c) => c !== '' && Number.isNaN(Number(c)));
    const header = hasHeader ? firstCells : firstCells.map((_, i) => fallbackName(hints, i));
    const keep = header.map((name, i) => ({ name, i })).filter((c) => !TIME_COLUMN.test(c.name));
    const rows = hasHeader ? lines.slice(1) : lines;
    const leads = keep.map(() => new Float32Array(rows.length));
    for (let r = 0; r < rows.length; r++) {
        const cells = rows[r].split(delimiter);
        for (let k = 0; k < keep.length; k++) {
            const v = Number(cells[keep[k].i]);
            leads[k][r] = Number.isFinite(v) ? v : 0;
        }
    }
    return { leadNames: keep.map((c) => c.name), leads };
}

function parseJson(text: string, hints: EcgSignalParseHints): ParsedEcgSignal {
    const root: unknown = JSON.parse(text);

    // { leads: { I: [...], II: [...] } } | { signals: {...} } | { data: {...} }
    const mapLike = isRecord(root) ? (root.leads ?? root.signals ?? root.data) : root;
    if (isRecord(mapLike)) {
        const leadNames: string[] = [];
        const leads: Float32Array[] = [];
        for (const [name, values] of Object.entries(mapLike)) {
            const arr = toFloat32(values);
            if (arr) {
                leadNames.push(name);
                leads.push(arr);
            }
        }
        if (leads.length) return { leadNames, leads };
    }

    // { leadNames: [...], data: [[...],[...]] } hoặc mảng 2 chiều / 1 chiều thuần
    if (Array.isArray(mapLike) && mapLike.length > 0) {
        const names = isRecord(root) && Array.isArray(root.leadNames) ? root.leadNames.map(String) : hints.leadNames ?? [];
        if (Array.isArray(mapLike[0])) {
            const matrix = mapLike as unknown[][];
            const sampleMajor = isSampleMajor(matrix.length, matrix[0].length, hints.numLeads);
            if (sampleMajor) {
                const numLeads = matrix[0].length;
                const leads = Array.from({ length: numLeads }, () => new Float32Array(matrix.length));
                for (let s = 0; s < matrix.length; s++) {
                    for (let l = 0; l < numLeads; l++) {
                        const v = Number(matrix[s][l]);
                        leads[l][s] = Number.isFinite(v) ? v : 0;
                    }
                }
                return { leadNames: leads.map((_, i) => names[i] ?? fallbackName(hints, i)), leads };
            }
            const leads = matrix.map((row) => toFloat32(row) ?? new Float32Array(0));
            return { leadNames: leads.map((_, i) => names[i] ?? fallbackName(hints, i)), leads };
        }
        const single = toFloat32(mapLike);
        if (single) return { leadNames: [names[0] ?? hints.leadNames?.[0] ?? 'II'], leads: [single] };
    }
    throw new Error('Không nhận diện được cấu trúc JSON tín hiệu.');
}

/** true nếu ma trận rows×cols là [mẫu][lead]. Ưu tiên numLeads đã biết; nếu không thì "nhiều hàng, ít cột" = sample-major. */
function isSampleMajor(rows: number, cols: number, numLeads?: number): boolean {
    if (numLeads && numLeads > 0) {
        if (cols === numLeads && rows !== numLeads) return true;
        if (rows === numLeads && cols !== numLeads) return false;
    }
    return rows > cols;
}

const NPY_MAGIC = Buffer.from([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]); // \x93NUMPY

function parseNpy(buf: Buffer, hints: EcgSignalParseHints): ParsedEcgSignal {
    if (buf.length < 10 || !buf.subarray(0, 6).equals(NPY_MAGIC)) throw new Error('Không phải tệp .npy hợp lệ (sai magic).');
    const major = buf[6];
    let headerLen: number;
    let headerStart: number;
    if (major === 1) {
        headerLen = buf.readUInt16LE(8);
        headerStart = 10;
    } else if (major === 2 || major === 3) {
        headerLen = buf.readUInt32LE(8);
        headerStart = 12;
    } else {
        throw new Error(`Phiên bản .npy ${major} chưa hỗ trợ.`);
    }
    const header = buf.subarray(headerStart, headerStart + headerLen).toString('latin1');
    const descr = /'descr'\s*:\s*'([^']+)'/.exec(header)?.[1];
    const fortran = /'fortran_order'\s*:\s*(True|False)/.exec(header)?.[1] === 'True';
    const shapeRaw = /'shape'\s*:\s*\(([^)]*)\)/.exec(header)?.[1];
    if (!descr || shapeRaw === undefined) throw new Error('Header .npy thiếu descr/shape.');
    const shape = shapeRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number);
    if (shape.length < 1 || shape.length > 2 || shape.some((n) => !Number.isInteger(n) || n < 0)) throw new Error(`shape .npy không hỗ trợ: (${shapeRaw}).`);

    const read = npyReader(descr);
    const body = headerStart + headerLen;
    const total = shape.reduce((a, b) => a * b, 1);
    if (buf.length < body + total * read.size) throw new Error('Tệp .npy bị cụt (thiếu dữ liệu).');
    const at = (flat: number) => read.fn(buf, body + flat * read.size);

    if (shape.length === 1) return { leadNames: [hints.leadNames?.[0] ?? 'II'], leads: [Float32Array.from({ length: shape[0] }, (_, i) => at(i))] };

    const [rows, cols] = shape;
    const sampleMajor = isSampleMajor(rows, cols, hints.numLeads);
    const numLeads = sampleMajor ? cols : rows;
    const numSamples = sampleMajor ? rows : cols;
    // C-order: flat = r*cols + c ; Fortran-order: flat = c*rows + r
    const flatOf = (r: number, c: number) => (fortran ? c * rows + r : r * cols + c);
    const leads = Array.from({ length: numLeads }, (_, l) => {
        const out = new Float32Array(numSamples);
        for (let s = 0; s < numSamples; s++) out[s] = sampleMajor ? at(flatOf(s, l)) : at(flatOf(l, s));
        return out;
    });
    return { leadNames: leads.map((_, i) => fallbackName(hints, i)), leads };
}

function npyReader(descr: string): { size: number; fn: (b: Buffer, o: number) => number } {
    const little = descr[0] !== '>';
    const code = descr.replace(/^[<>|=]/, '');
    switch (code) {
        case 'f4':
            return { size: 4, fn: little ? (b, o) => b.readFloatLE(o) : (b, o) => b.readFloatBE(o) };
        case 'f8':
            return { size: 8, fn: little ? (b, o) => b.readDoubleLE(o) : (b, o) => b.readDoubleBE(o) };
        case 'i2':
            return { size: 2, fn: little ? (b, o) => b.readInt16LE(o) : (b, o) => b.readInt16BE(o) };
        case 'i4':
            return { size: 4, fn: little ? (b, o) => b.readInt32LE(o) : (b, o) => b.readInt32BE(o) };
        default:
            throw new Error(`dtype .npy '${descr}' chưa hỗ trợ (chỉ f4, f8, i2, i4).`);
    }
}
