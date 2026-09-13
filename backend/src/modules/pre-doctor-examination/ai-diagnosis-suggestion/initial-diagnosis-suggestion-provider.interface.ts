/**
 * Khung tích hợp AI gợi ý chẩn đoán SƠ BỘ (trước khi có kết quả xét nghiệm) — hiển thị cho bác sĩ
 * kèm confidence score ở bước "Xem thông tin & Đánh giá từ AI" (Module 5, mục 1). Ghi vào cùng
 * bảng AiDiagnosisSuggestion dùng chung với Module 8, nhưng luôn với sourceType = 'initial_summary'
 * để phân biệt với gợi ý chẩn đoán TOÀN DIỆN sau xét nghiệm (sourceType = 'comprehensive_review',
 * xem module post-test-consultation/ai-diagnosis-review — có provider/interface RIÊNG, không dùng
 * chung file này, để 2 module không phụ thuộc chéo lẫn nhau).
 *
 * Cùng pattern với lab-test/lab-ai-analysis: định nghĩa contract ở đây, KHÔNG bind provider thật
 * vào module — InitialDiagnosisSuggestionService hoạt động như no-op cho tới khi được cấu hình.
 */
export interface InitialDiagnosisSuggestionInput {
    encounterId: string;
    symptoms?: string;
    examinationFindings?: string;
    clinicalSummaryText?: string;
}

export interface InitialDiagnosisSuggestionReferenceOutput {
    sourceType: string;
    sourceId: string;
    sourceEncounterId?: string;
    relevanceNote?: string;
}

export interface InitialDiagnosisSuggestionItemOutput {
    icd10Code: string;
    suggestedDiagName: string;
    confidenceScore: number;
    rank: number;                   // Thứ hạng trong top-k, bắt đầu từ 1 (1 = khả năng cao nhất).
    explanationText?: string;
    referenceSources?: InitialDiagnosisSuggestionReferenceOutput[];
}

export interface InitialDiagnosisSuggestionOutput {
    modelName: string;
    modelVersion?: string;
    suggestions: InitialDiagnosisSuggestionItemOutput[];
}

export const INITIAL_DIAGNOSIS_SUGGESTION_PROVIDER = 'INITIAL_DIAGNOSIS_SUGGESTION_PROVIDER';

export interface InitialDiagnosisSuggestionProvider {
    suggest(input: InitialDiagnosisSuggestionInput): Promise<InitialDiagnosisSuggestionOutput>;
}
