import { buildAnomalyFlags, sampleTimeMs } from '../../src/modules/lab-test/ecg-stream/ecg-anomaly-labeler';

describe('buildAnomalyFlags', () => {
    it('đánh 1 cho mẫu nằm trong [start, end] (gồm 2 đầu) @500Hz (2ms/mẫu)', () => {
        // mẫu i ở t = 2i ms. [10, 20] ms -> i = 5..10
        const f = buildAnomalyFlags(20, 500, [{ startOffsetMs: 10, endOffsetMs: 20 }]);
        expect(Array.from(f).map((v, i) => (v ? i : -1)).filter((i) => i >= 0)).toEqual([5, 6, 7, 8, 9, 10]);
    });

    it('biên không khớp mẫu: chỉ lấy mẫu nằm thật sự trong đoạn', () => {
        // [11, 15] ms -> t=12 (i=6), t=14 (i=7)
        const f = buildAnomalyFlags(20, 500, [{ startOffsetMs: 11, endOffsetMs: 15 }]);
        expect(Array.from(f).map((v, i) => (v ? i : -1)).filter((i) => i >= 0)).toEqual([6, 7]);
    });

    it('nhiều đoạn chồng lấn, đoạn vượt cuối bản ghi, start < 0 và đoạn đảo đầu-cuối', () => {
        const f = buildAnomalyFlags(10, 1000, [
            { startOffsetMs: -50, endOffsetMs: 1 }, // 0..1
            { startOffsetMs: 7, endOffsetMs: 500 }, // 7..9 (cắt ở cuối)
            { startOffsetMs: 4, endOffsetMs: 3 }, // đảo -> 3..4
            { startOffsetMs: 8, endOffsetMs: 9 }, // chồng lấn
        ]);
        expect(Array.from(f)).toEqual([1, 1, 0, 1, 1, 0, 0, 1, 1, 1]);
    });

    it('không có đoạn / tổng mẫu 0 / fs không hợp lệ -> toàn 0', () => {
        expect(Array.from(buildAnomalyFlags(5, 500, []))).toEqual([0, 0, 0, 0, 0]);
        expect(buildAnomalyFlags(0, 500, [{ startOffsetMs: 0, endOffsetMs: 10 }])).toHaveLength(0);
        expect(Array.from(buildAnomalyFlags(3, 0, [{ startOffsetMs: 0, endOffsetMs: 10 }]))).toEqual([0, 0, 0]);
    });

    it('bỏ qua đoạn NaN/Infinity', () => {
        expect(Array.from(buildAnomalyFlags(3, 1000, [{ startOffsetMs: NaN, endOffsetMs: 2 }]))).toEqual([0, 0, 0]);
    });

    it('không lệch do sai số dấu phẩy động ở fs lẻ (360 Hz)', () => {
        // mẫu 360 ở đúng t = 1000ms phải thuộc đoạn [0, 1000]
        const f = buildAnomalyFlags(721, 360, [{ startOffsetMs: 0, endOffsetMs: 1000 }]);
        expect(f[360]).toBe(1);
        expect(f[361]).toBe(0);
    });
});

describe('sampleTimeMs', () => {
    it('tính t = i*1000/fs, làm tròn 3 chữ số', () => {
        expect(sampleTimeMs(0, 500)).toBe(0);
        expect(sampleTimeMs(3, 500)).toBe(6);
        expect(sampleTimeMs(1, 360)).toBe(2.778);
    });
});
