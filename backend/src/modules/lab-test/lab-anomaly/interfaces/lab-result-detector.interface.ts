import { DiagnosticResult, ResultParameter, ResultValue } from '@prisma/client';

export type LabRiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Kết quả đánh giá 1 chỉ số. Detector duy nhất hiện tại là rule-based (theo ResultParameterThreshold). AI của hệ
 * thống chỉ còn ECG time-series (EcgAnomalyEvent) — không đi qua luồng này.
 */
export interface LabDetectionResult {
    resultValueId: string;
    parameterId: string;
    isAbnormal: boolean;
    riskLevel: LabRiskLevel | null;
    /** ResultParameterThreshold áp dụng; null nếu không dựa trên ngưỡng cố định (vd: tham số boolean). */
    thresholdId: string | null;
    expectedMin: number | null;
    expectedMax: number | null;
    /** Diễn giải lý do. */
    reason?: string;
}

/** Ngữ cảnh cần cho tra ngưỡng theo tuổi/giới tính và cho việc đẩy cảnh báo / thông báo. */
export interface LabPatientContext {
    dateOfBirth: Date | null;
    gender: string | null;
    encounterId: string;
    patientId: string;
    /** User của bác sĩ chỉ định (nhận thông báo cảnh báo nguy kịch); null nếu chưa xác định. */
    doctorUserId: string | null;
}

export type LabResultWithValues = DiagnosticResult & {
    values: (ResultValue & { parameter: ResultParameter })[];
    patientContext: LabPatientContext;
};

/** Mọi detector phải implement interface này để orchestrator gộp kết quả mà không cần biết chi tiết bên trong. */
export interface LabResultDetector {
    detect(labResult: LabResultWithValues): Promise<LabDetectionResult[]>;
}
