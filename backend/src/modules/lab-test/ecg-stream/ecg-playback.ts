import { sampleTimeMs } from './ecg-anomaly-labeler';

export interface EcgPlaybackPoint {
    /** Chỉ số mẫu tuyệt đối trong bản ghi (0-based) — client dùng để phát hiện mất gói / sắp xếp. */
    seq: number;
    /** Thời điểm mẫu, ms tính từ đầu bản ghi. */
    tMs: number;
    value: number;
    /** Chỉ có khi phát kèm nhãn anomaly. */
    isAnomaly?: 0 | 1;
}

export interface EcgPlaybackOptions {
    samples: Float32Array;
    sampleRateHz: number;
    /** Nhãn 0/1 theo từng mẫu (cùng độ dài samples). Bỏ trống = không gắn isAnomaly. */
    flags?: Uint8Array;
    /** Mẫu bắt đầu phát. */
    startIndex?: number;
    /** Hệ số tốc độ (1 = đúng thời gian thực). */
    speed?: number;
    tickMs?: number;
    onPoint: (point: EcgPlaybackPoint) => void;
    onEnd: (totalEmitted: number) => void;
    /** Đồng hồ đơn điệu (ms) — inject để test. */
    now?: () => number;
}

export const ECG_PLAYBACK_TICK_MS = 20;

/**
 * Phát lại tín hiệu ECG đã lưu như thể đang đo trực tiếp: mỗi mẫu được đẩy ĐÚNG MỘT LẦN, theo đồng hồ thực
 * (số mẫu đến hạn = thời gian đã trôi × sampleRate × speed), nên không trôi thời gian dù timer bị trễ — tick trễ sẽ
 * đẩy bù các mẫu còn thiếu, không bỏ mẫu nào.
 */
export class EcgPlayback {
    private readonly samples: Float32Array;
    private readonly fs: number;
    private readonly flags?: Uint8Array;
    private readonly speed: number;
    private readonly tickMs: number;
    private readonly startIndex: number;
    private readonly now: () => number;
    private timer: ReturnType<typeof setInterval> | null = null;
    private t0 = 0;
    private next: number;
    private ended = false;

    constructor(private readonly opts: EcgPlaybackOptions) {
        this.samples = opts.samples;
        this.fs = opts.sampleRateHz;
        this.flags = opts.flags;
        this.speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
        this.tickMs = opts.tickMs ?? ECG_PLAYBACK_TICK_MS;
        this.startIndex = Math.min(Math.max(0, Math.floor(opts.startIndex ?? 0)), this.samples.length);
        this.next = this.startIndex;
        this.now = opts.now ?? (() => performance.now());
    }

    get isRunning(): boolean {
        return this.timer !== null;
    }

    get emitted(): number {
        return this.next - this.startIndex;
    }

    start(): void {
        if (this.timer || this.ended) return;
        this.t0 = this.now();
        this.timer = setInterval(() => this.tick(), this.tickMs);
        this.tick(); // mẫu đầu tiên đi ngay, không đợi tick đầu
    }

    /** Đẩy mọi mẫu đã đến hạn. Public để test điều khiển bằng đồng hồ giả. */
    tick(): void {
        if (this.ended) return;
        const elapsedMs = this.now() - this.t0;
        // +1: mẫu startIndex đến hạn tại t=0.
        const due = Math.min(this.samples.length, this.startIndex + Math.floor((elapsedMs / 1000) * this.fs * this.speed) + 1);
        while (this.next < due && !this.ended) {
            const i = this.next++;
            const point: EcgPlaybackPoint = { seq: i, tMs: sampleTimeMs(i, this.fs), value: this.samples[i] };
            if (this.flags) point.isAnomaly = this.flags[i] ? 1 : 0;
            this.opts.onPoint(point);
        }
        if (this.next >= this.samples.length) this.finish();
    }

    stop(): void {
        this.clear();
        this.ended = true;
    }

    private finish(): void {
        if (this.ended) return;
        this.clear();
        this.ended = true;
        this.opts.onEnd(this.emitted);
    }

    private clear(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }
}
