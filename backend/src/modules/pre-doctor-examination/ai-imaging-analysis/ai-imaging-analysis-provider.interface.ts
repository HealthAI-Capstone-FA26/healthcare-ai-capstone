/**
 * Khung tích hợp AI phân tích 1 hình ảnh y khoa (MedicalImage — Xquang/CT/MRI/siêu âm/ECG...) và
 * khoanh vùng/làm nổi bật bất thường (bounding box), hiển thị cho bác sĩ ở bước "Xem thông tin &
 * Đánh giá từ AI" (Module 5, mục 1). Khác với AiLabAnalysis ở module lab-test (chỉ kết luận nhị
 * phân anomaly/không cho 1 ảnh đính kèm kết quả xét nghiệm), khung này trả về DANH SÁCH vùng bất
 * thường cụ thể (AiImagingFinding) kèm toạ độ khoanh vùng — đúng nghiệp vụ "khoanh vùng/làm nổi bật".
 *
 * Cùng pattern với lab-test/lab-ai-analysis: định nghĩa contract ở đây, KHÔNG bind provider thật
 * vào module — AiImagingAnalysisService hoạt động như no-op cho tới khi được cấu hình.
 */
export interface AiImagingAnalysisInput {
    medicalImageId: string;
    imageUrl: string;
    imageType: string;
}

export interface AiImagingBoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface AiImagingFindingOutput {
    findingLabel: string;
    confidenceScore: number;
    boundingBox: AiImagingBoundingBox;
    severity?: 'mild' | 'moderate' | 'severe';
}

export interface AiImagingAnalysisOutput {
    modelName: string;
    modelVersion?: string;
    overallFinding?: string;
    confidenceScore: number;
    /** Ảnh đã khoanh vùng/làm nổi bật do AI trả về, nếu provider tự render sẵn. */
    annotatedImageUrl?: string;
    findings: AiImagingFindingOutput[];
}

export const AI_IMAGING_ANALYSIS_PROVIDER = 'AI_IMAGING_ANALYSIS_PROVIDER';

export interface AiImagingAnalysisProvider {
    analyze(input: AiImagingAnalysisInput): Promise<AiImagingAnalysisOutput>;
}
