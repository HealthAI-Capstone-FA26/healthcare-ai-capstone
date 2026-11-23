import { parseEcgSignal, EcgSignalFormatError } from '../../src/modules/lab-test/ecg-stream/ecg-signal-reader';

/** Dựng .npy v1 (little-endian) từ mảng 1D/2D. */
function npy(values: number[], shape: number[], descr = '<f4', fortran = false): Buffer {
    const shapeStr = shape.length === 1 ? `(${shape[0]},)` : `(${shape.join(', ')})`;
    let header = `{'descr': '${descr}', 'fortran_order': ${fortran ? 'True' : 'False'}, 'shape': ${shapeStr}, }`;
    const pad = 64 - ((10 + header.length + 1) % 64);
    header = header + ' '.repeat(pad) + '\n';
    const size = descr.endsWith('f8') ? 8 : descr.endsWith('i2') ? 2 : 4;
    const body = Buffer.alloc(values.length * size);
    values.forEach((v, i) => {
        if (descr.endsWith('f4')) body.writeFloatLE(v, i * size);
        else if (descr.endsWith('f8')) body.writeDoubleLE(v, i * size);
        else if (descr.endsWith('i2')) body.writeInt16LE(v, i * size);
        else body.writeInt32LE(v, i * size);
    });
    const head = Buffer.alloc(10);
    Buffer.from([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0]).copy(head);
    head.writeUInt16LE(header.length, 8);
    return Buffer.concat([head, Buffer.from(header, 'latin1'), body]);
}

describe('parseEcgSignal', () => {
    it('csv có header + bỏ cột thời gian', () => {
        const r = parseEcgSignal('csv', Buffer.from('time,I,II\n0,0.1,1.1\n0.002,0.2,1.2\n0.004,0.3,1.3\n'));
        expect(r.leadNames).toEqual(['I', 'II']);
        expect(Array.from(r.leads[1])).toEqual([expect.closeTo(1.1), expect.closeTo(1.2), expect.closeTo(1.3)]);
    });

    it('csv không header dùng leadNames gợi ý, hỗ trợ ; và dòng trống', () => {
        const r = parseEcgSignal('csv', Buffer.from('1;2\n3;4\n\n5;6\n'), { leadNames: ['I', 'II'] });
        expect(r.leadNames).toEqual(['I', 'II']);
        expect(Array.from(r.leads[0])).toEqual([1, 3, 5]);
        expect(Array.from(r.leads[1])).toEqual([2, 4, 6]);
    });

    it('csv: ô không phải số -> 0', () => {
        const r = parseEcgSignal('csv', Buffer.from('I,II\n1,x\n2,3\n'));
        expect(Array.from(r.leads[1])).toEqual([0, 3]);
    });

    it('json dạng map lead -> mảng', () => {
        const r = parseEcgSignal('json', Buffer.from(JSON.stringify({ leads: { I: [1, 2, 3], II: [4, 5, 6] } })));
        expect(r.leadNames).toEqual(['I', 'II']);
        expect(Array.from(r.leads[1])).toEqual([4, 5, 6]);
    });

    it('json ma trận [mẫu][lead] (nhiều hàng ít cột) được chuyển vị; dùng numLeads để phân biệt', () => {
        const sampleMajor = [[1, 10], [2, 20], [3, 30]];
        const r = parseEcgSignal('json', Buffer.from(JSON.stringify({ data: sampleMajor, leadNames: ['I', 'II'] })));
        expect(Array.from(r.leads[0])).toEqual([1, 2, 3]);
        expect(Array.from(r.leads[1])).toEqual([10, 20, 30]);
        // 2 lead x 3 mẫu (lead-major) khi numLeads = 2
        const leadMajor = parseEcgSignal('json', Buffer.from(JSON.stringify([[1, 2, 3], [4, 5, 6]])), { numLeads: 2 });
        expect(Array.from(leadMajor.leads[1])).toEqual([4, 5, 6]);
    });

    it('npy 2D [mẫu][lead] float32', () => {
        const r = parseEcgSignal('npy', npy([1, 10, 2, 20, 3, 30], [3, 2]), { leadNames: ['I', 'II'], numLeads: 2 });
        expect(r.leadNames).toEqual(['I', 'II']);
        expect(Array.from(r.leads[0])).toEqual([1, 2, 3]);
        expect(Array.from(r.leads[1])).toEqual([10, 20, 30]);
    });

    it('npy 2D lead-major khi shape[0] == numLeads, và fortran_order', () => {
        const lm = parseEcgSignal('npy', npy([1, 2, 3, 4, 5, 6], [2, 3]), { numLeads: 2 });
        expect(Array.from(lm.leads[1])).toEqual([4, 5, 6]);
        // F-order của ma trận [[1,10],[2,20],[3,30]] = cột 1 rồi cột 2
        const fo = parseEcgSignal('npy', npy([1, 2, 3, 10, 20, 30], [3, 2], '<f4', true), { numLeads: 2 });
        expect(Array.from(fo.leads[0])).toEqual([1, 2, 3]);
        expect(Array.from(fo.leads[1])).toEqual([10, 20, 30]);
    });

    it('npy 1D và dtype f8 / i2 / i4', () => {
        expect(Array.from(parseEcgSignal('npy', npy([1.5, 2.5], [2], '<f8')).leads[0])).toEqual([1.5, 2.5]);
        expect(Array.from(parseEcgSignal('npy', npy([-3, 7], [2], '<i2')).leads[0])).toEqual([-3, 7]);
        expect(Array.from(parseEcgSignal('npy', npy([100000, -5], [2], '<i4')).leads[0])).toEqual([100000, -5]);
    });

    it('npy hỏng: sai magic, bị cụt, dtype lạ -> SIGNAL_PARSE_FAILED', () => {
        const bad = (b: Buffer) => expect(() => parseEcgSignal('npy', b)).toThrow(expect.objectContaining({ code: 'SIGNAL_PARSE_FAILED' }));
        bad(Buffer.from('not a npy file at all'));
        bad(npy([1, 2, 3, 4], [4]).subarray(0, -4));
        bad(npy([1, 2], [2], '<u2'.replace('u', 'c')));
    });

    it('định dạng không stream được -> SIGNAL_FORMAT_NOT_STREAMABLE', () => {
        for (const f of ['wfdb', 'edf', 'dicom_ecg', 'scp_ecg']) {
            expect(() => parseEcgSignal(f, Buffer.from('x'))).toThrow(EcgSignalFormatError);
            expect(() => parseEcgSignal(f, Buffer.from('x'))).toThrow(expect.objectContaining({ code: 'SIGNAL_FORMAT_NOT_STREAMABLE' }));
        }
    });

    it('tệp rỗng/không có mẫu -> SIGNAL_PARSE_FAILED', () => {
        expect(() => parseEcgSignal('csv', Buffer.from('I,II\n'))).toThrow(expect.objectContaining({ code: 'SIGNAL_PARSE_FAILED' }));
        expect(() => parseEcgSignal('json', Buffer.from('{"leads":{}}'))).toThrow(expect.objectContaining({ code: 'SIGNAL_PARSE_FAILED' }));
    });
});
