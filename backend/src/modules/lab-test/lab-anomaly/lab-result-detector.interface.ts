import { LabResult, LabResultValue, LabResultParameter } from '@prisma/client';

export type LabRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type AlertSource = 'rule' | 'ai';

export interface LabDetectionResult {
    resultValueId: string;
    parameterId: string;
    isAbnormal: boolean;
    riskLevel: LabRiskLevel | null;
    alertSource: AlertSource;
    /** Ngưỡng áp dụng, null nếu không dựa trên threshold cố định (VD: AI theo trend/hình ảnh). */
    thresholdId: string | null;
    expectedMin: number | null;
    expectedMax: number | null;
    /** Diễn giải lý do — đặc biệt hữu ích với AI detector, rule-based có thể để trống. */
    reason?: string;
}

/**
 * Ngữ cảnh bệnh nhân cần cho việc tra ngưỡng theo tuổi/giới tính.
 * TODO: chỉnh lại đường dẫn quan hệ (labTask.orderItem -> ... -> patient) cho khớp với
 * schema thực tế của TestOrderItem/Encounter/Patient trong hệ thống — các model này không
 * nằm trong phạm vi schema.prisma của module Lab-test nên được giữ dạng "loose" ở đây.
 */
export interface LabPatientContext {
    dateOfBirth: Date | null;
    gender: string | null;
    encounterId: string;
}

export type LabResultWithValues = LabResult & {
    values: (LabResultValue & { parameter: LabResultParameter })[];
    patientContext: LabPatientContext;
};

/**
 * Interface chung mà mọi detector (rule-based, ai-based, ...) phải implement.
 * Cho phép orchestrator chạy song song nhiều detector và gộp kết quả mà không cần biết
 * chi tiết bên trong từng loại — cùng kiểu thiết kế đã dùng ở module vital-anomaly.
 */
export interface LabResultDetector {
    readonly source: AlertSource;
    detect(labResult: LabResultWithValues): Promise<LabDetectionResult[]>;
}
