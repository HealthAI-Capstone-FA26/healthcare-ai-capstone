/**
 * Khuôn (contract) cho mô-đun AI phân tích xét nghiệm — phát hiện/khoanh vùng tổn thương
 * trên hình ảnh và đưa ra chẩn đoán hỗ trợ. Nội dung triển khai thật (gọi model AI, xử lý ảnh...)
 * SẼ ĐƯỢC LÀM SAU — file này chỉ định nghĩa khuôn để cắm vào (dependency-inversion) mà không
 * phải sửa AiLabAnalysisService/listener khi mô-đun AI thật sẵn sàng.
 */

export interface AiLabAnalysisValueInput {
    parameterCode: string;
    parameterName: string | null;
    valueNumeric: number | null;
    valueText: string | null;
    unit: string | null;
}

export interface AiLabAnalysisInput {
    labResultId: string;
    /** URL các hình ảnh/tệp đính kèm liên quan (X-quang, CT, kết quả scan, ...). */
    imageUrls: string[];
    /** Bảng số liệu kết quả — cho phép AI đối chiếu chéo nhiều chỉ số. */
    values: AiLabAnalysisValueInput[];
}

/** Vùng khoanh (bounding box / polygon) trên ảnh nếu AI hỗ trợ định vị tổn thương. */
export interface AiLabAnalysisRegionOfInterest {
    imageUrl: string;
    label: string;
    /** Toạ độ tuỳ theo định dạng model trả về — để dạng "unknown", chuẩn hoá khi có mô hình thật. */
    coordinates: unknown;
    confidence: number;
}

export interface AiLabAnalysisOutput {
    modelName: string;
    modelVersion?: string;
    overallFinding: string;
    /** 0..1 */
    confidenceScore: number;
    regionsOfInterest?: AiLabAnalysisRegionOfInterest[];
}

/**
 * Cổng (port) mà AiLabAnalysisService phụ thuộc vào — hiện CHƯA có cài đặt (chưa bind provider
 * thật trong lab-test.module.ts). Khi mô-đun AI được xây dựng, chỉ cần implement interface này
 * và đăng ký `{ provide: AI_LAB_ANALYSIS_PROVIDER, useClass: YourRealAiProvider }` trong module.
 */
export const AI_LAB_ANALYSIS_PROVIDER = 'AI_LAB_ANALYSIS_PROVIDER';

export interface AiLabAnalysisProvider {
    analyze(input: AiLabAnalysisInput): Promise<AiLabAnalysisOutput>;
}
