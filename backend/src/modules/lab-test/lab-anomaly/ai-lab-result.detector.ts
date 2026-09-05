import { LabResultDetector, LabResultWithValues, LabDetectionResult } from './lab-result-detector.interface';

/**
 * Khung (stub) cho phát hiện bất thường dựa trên AI (VD: phân tích xu hướng nhiều lần
 * xét nghiệm, đối chiếu chéo nhiều chỉ số). Hiện trả về mảng rỗng — không sinh alert nào
 * từ AI cho tới khi được cài đặt logic thật. Không cần đổi gì ở orchestrator/controller khi
 * hiện thực phần này sau này.
 *
 * Việc phân tích hình ảnh/tổn thương (khoanh vùng, chẩn đoán hỗ trợ) KHÔNG nằm ở đây —
 * xem module `lab-ai-analysis` (AiLabAnalysisService) dành riêng cho luồng đó.
 */
export class AiLabResultDetector implements LabResultDetector {
    readonly source = 'ai' as const;

    async detect(labResult: LabResultWithValues): Promise<LabDetectionResult[]> {
        // TODO: implement AI-based detection logic (trend analysis, cross-parameter correlation, ...)
        void labResult;
        return [];
    }
}
