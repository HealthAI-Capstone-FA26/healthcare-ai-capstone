/**
 * Khung tích hợp AI gợi ý chẩn đoán TOÀN DIỆN — chạy SAU KHI đã có kết quả xét nghiệm (Module 8,
 * mục "Đề xuất chẩn đoán từ AI"). Ghi vào CÙNG bảng AiDiagnosisSuggestion dùng chung với Module 5
 * (ai-diagnosis-suggestion/initial-diagnosis-suggestion), nhưng luôn với
 * sourceType = 'comprehensive_review' để phân biệt với gợi ý SƠ BỘ trước xét nghiệm
 * (sourceType = 'initial_summary', xem module pre-doctor-examination/ai-diagnosis-suggestion).
 *
 * Cố tình định nghĩa provider/interface RIÊNG (không import lại
 * InitialDiagnosisSuggestionProvider của Module 5) dù input/output khá giống nhau, để 2 module
 * không phụ thuộc chéo lẫn nhau — đúng yêu cầu module-based, không đè lẫn nhau. Nếu sau này 2
 * contract thực sự trùng nhau 100%, có thể rút thành 1 package dùng chung ở tầng cao hơn (VD
 * common/ai-contracts), nhưng KHÔNG để 1 trong 2 module doctor-examination/post-test-consultation
 * import trực tiếp module còn lại.
 *
 * Cùng pattern với lab-test/lab-ai-analysis và pre-doctor-examination/ai-diagnosis-suggestion:
 * định nghĩa contract ở đây, KHÔNG bind provider thật vào module —
 * AiDiagnosisReviewService hoạt động như no-op cho tới khi được cấu hình.
 */

export interface AiDiagnosisReviewAbnormalLabFinding {
    testName: string;
    parameterName?: string;
    measuredValue: string;
    unit?: string;
    riskLevel?: string; // low | medium | high | critical — lấy từ LabResultAlert nếu có
}

export interface AiDiagnosisReviewPreliminaryDiagnosis {
    icd10Code: string;
    diagnosisName: string;
}

export interface AiDiagnosisReviewInput {
    encounterId: string;
    symptoms?: string;
    examinationFindings?: string;
    clinicalSummaryText?: string;
    /** Chẩn đoán sơ bộ đã ghi nhận ở Module 5 (nếu có) — cho AI biết hướng nghi ngờ ban đầu của bác sĩ. */
    preliminaryDiagnoses?: AiDiagnosisReviewPreliminaryDiagnosis[];
    /** Các giá trị xét nghiệm được đánh dấu bất thường (isAbnormal=true) — trọng tâm khác biệt so với Module 5. */
    abnormalLabFindings?: AiDiagnosisReviewAbnormalLabFinding[];
}

export interface AiDiagnosisReviewReferenceOutput {
    sourceType: string;
    sourceId: string;
    sourceEncounterId?: string;
    relevanceNote?: string;
}

export interface AiDiagnosisReviewItemOutput {
    icd10Code: string;
    suggestedDiagName: string;
    confidenceScore: number;
    rank: number; // top-k, bắt đầu từ 1 (1 = khả năng cao nhất)
    explanationText?: string;
    referenceSources?: AiDiagnosisReviewReferenceOutput[];
}

export interface AiDiagnosisReviewOutput {
    modelName: string;
    modelVersion?: string;
    suggestions: AiDiagnosisReviewItemOutput[];
}

export const AI_DIAGNOSIS_REVIEW_PROVIDER = 'AI_DIAGNOSIS_REVIEW_PROVIDER';

export interface AiDiagnosisReviewProvider {
    review(input: AiDiagnosisReviewInput): Promise<AiDiagnosisReviewOutput>;
}
