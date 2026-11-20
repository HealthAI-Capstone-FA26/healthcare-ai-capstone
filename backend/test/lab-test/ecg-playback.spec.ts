import { EcgPlayback, EcgPlaybackPoint } from '../../src/modules/lab-test/ecg-stream/ecg-playback';

describe('EcgPlayback', () => {
    let clock: number;
    const now = () => clock;
    const samples = Float32Array.from({ length: 10 }, (_, i) => i * 10);

    beforeEach(() => {
        jest.useFakeTimers();
        clock = 0;
    });
    afterEach(() => jest.useRealTimers());

    const make = (extra: Partial<ConstructorParameters<typeof EcgPlayback>[0]> = {}) => {
        const points: EcgPlaybackPoint[] = [];
        const onEnd = jest.fn();
        const pb = new EcgPlayback({ samples, sampleRateHz: 100, onPoint: (p) => points.push(p), onEnd, now, ...extra });
        return { pb, points, onEnd };
    };

    it('mẫu đầu đi ngay khi start; các mẫu sau đi theo đồng hồ (100Hz = 10ms/mẫu)', () => {
        const { pb, points } = make();
        pb.start();
        expect(points.map((p) => p.seq)).toEqual([0]);
        clock = 25; // đến hạn: mẫu 0,1,2
        pb.tick();
        expect(points.map((p) => p.seq)).toEqual([0, 1, 2]);
        expect(points[2]).toEqual({ seq: 2, tMs: 20, value: 20 });
        pb.stop();
    });

    it('tick trễ vẫn đẩy bù đủ mẫu, không bỏ mẫu và không trùng', () => {
        const { pb, points } = make();
        pb.start();
        clock = 95; // trễ nhiều
        pb.tick();
        pb.tick(); // gọi lại không đẩy trùng
        expect(points.map((p) => p.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it('hết bản ghi: onEnd đúng 1 lần với tổng số mẫu đã phát, timer dừng', () => {
        const { pb, onEnd } = make();
        pb.start();
        clock = 1000;
        pb.tick();
        pb.tick();
        expect(onEnd).toHaveBeenCalledTimes(1);
        expect(onEnd).toHaveBeenCalledWith(10);
        expect(pb.isRunning).toBe(false);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('speed 2x phát nhanh gấp đôi; startIndex bỏ qua đoạn đầu', () => {
        const { pb, points } = make({ speed: 2, startIndex: 4 });
        pb.start();
        clock = 20; // 20ms * 100Hz * 2 = 4 mẫu trôi qua (+1 mẫu đầu) -> seq 4..8
        pb.tick();
        expect(points.map((p) => p.seq)).toEqual([4, 5, 6, 7, 8]);
    });

    it('gắn isAnomaly 0/1 khi có flags, không gắn khi không có', () => {
        const flags = Uint8Array.from([0, 0, 1, 1, 0, 0, 0, 0, 0, 0]);
        const a = make({ flags });
        a.pb.start();
        clock = 45;
        a.pb.tick();
        expect(a.points.map((p) => p.isAnomaly)).toEqual([0, 0, 1, 1, 0]);
        const b = make();
        b.pb.start();
        expect(b.points[0]).not.toHaveProperty('isAnomaly');
    });

    it('stop giữa chừng: không phát thêm, không gọi onEnd', () => {
        const { pb, points, onEnd } = make();
        pb.start();
        pb.stop();
        clock = 500;
        jest.advanceTimersByTime(500);
        expect(points).toHaveLength(1);
        expect(onEnd).not.toHaveBeenCalled();
        expect(jest.getTimerCount()).toBe(0);
    });

    it('startIndex vượt cuối: kết thúc ngay với 0 mẫu', () => {
        const { pb, points, onEnd } = make({ startIndex: 999 });
        pb.start();
        expect(points).toHaveLength(0);
        expect(onEnd).toHaveBeenCalledWith(0);
    });

    it('timer thật (setInterval) tự gọi tick', () => {
        const { pb, points } = make();
        pb.start();
        clock = 50;
        jest.advanceTimersByTime(20);
        expect(points.length).toBeGreaterThan(1);
        pb.stop();
    });
});
