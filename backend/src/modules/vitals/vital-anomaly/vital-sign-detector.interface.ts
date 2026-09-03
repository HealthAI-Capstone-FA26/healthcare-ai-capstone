import { VitalSignSession, VitalSignObservation, VitalSignItem } from '@prisma/client';

export type AlertLevel = 'warning' | 'critical';
export type AlertSource = 'rule' | 'ai';

export interface DetectionResult {
    observationId: string;
    itemId: string;
    isAbnormal: boolean;
    alertLevel: AlertLevel | null;
    alertSource: AlertSource;
    /** Ngưỡng áp dụng, null nếu detector không dựa trên threshold cố định (VD: AI theo trend) */
    thresholdId: string | null;
    expectedMin: number | null;
    expectedMax: number | null;
    /** Diễn giải lý do (đặc biệt hữu ích với AI detector, rule-based có thể để trống) */
    reason?: string;
}

export type VitalSignSessionWithObservations = VitalSignSession & {
    observations: (VitalSignObservation & { item: VitalSignItem })[];
    patient: { dateOfBirth: Date | null; gender: string | null } & Record<string, unknown>;
};

/**
 * Interface chung mà mọi detector (rule-based, ai-based, ...) phải implement.
 * Cho phép orchestrator chạy song song nhiều detector và gộp kết quả
 * mà không cần biết chi tiết bên trong từng loại.
 */
export interface VitalSignDetector {
    readonly source: AlertSource;
    detect(session: VitalSignSessionWithObservations): Promise<DetectionResult[]>;
}
