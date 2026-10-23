import {
    VitalSignDetector,
    VitalSignSessionWithObservations,
    DetectionResult,
} from './vital-sign-detector.interface';

// Rule-based detection (phát hiện dị thường sinh hiệu trên dựa trên model AI)
export class AiVitalSignDetector implements VitalSignDetector {
    readonly source = 'ai' as const;

    async detect(session: VitalSignSessionWithObservations): Promise<DetectionResult[]> {
        // TODO: implement AI detection logic
        // Tạm thời trả về mảng rỗng — không sinh alert nào từ AI cho tới khi được cài đặt.
        void session;
        return [];
    }
}
