/**
 * Khung tích hợp AI sinh "bản tóm tắt lâm sàng" (AiClinicalSummary) cho 1 lượt khám — hiển thị
 * cho bác sĩ ở bước "Xem thông tin & Đánh giá từ AI" (Module 5, mục 1) trước khi khám lâm sàng.
 * Cùng pattern với lab-test/lab-ai-analysis: định nghĩa contract ở đây, KHÔNG bind provider
 * thật vào module — AiClinicalSummaryService hoạt động như no-op cho tới khi được cấu hình.
 */
export interface AiClinicalSummaryInput {
    encounterId: string;
}

export interface AiClinicalSummaryReferenceOutput {
    /** Loại nguồn tham chiếu mà bản tóm tắt dựa vào, VD: 'medical_history' | 'vital_sign' | 'chief_complaint' | 'prior_encounter'. */
    sourceType: string;
    /** ID bản ghi nguồn (tuỳ sourceType — VD: historyId, vitalSessionId, complaintId, encounterId...). */
    sourceId: string;
    /** Nếu nguồn tham chiếu đến từ 1 lượt khám khác của cùng bệnh nhân. */
    sourceEncounterId?: string;
    relevanceNote?: string;
}

export interface AiClinicalSummaryOutput {
    modelName: string;
    modelVersion?: string;
    summaryText: string;
    referenceSources?: AiClinicalSummaryReferenceOutput[];
}

export const AI_CLINICAL_SUMMARY_PROVIDER = 'AI_CLINICAL_SUMMARY_PROVIDER';

export interface AiClinicalSummaryProvider {
    generate(input: AiClinicalSummaryInput): Promise<AiClinicalSummaryOutput>;
}
