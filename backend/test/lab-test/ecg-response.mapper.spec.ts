import { toAnalysisResponse, toEventResponse, toRecordingResponse, splitSummaryMetrics } from '../../src/modules/lab-test/ecg-ai-analysis/ecg-response.mapper';
import { parseAnalyzeResult } from '../../src/modules/lab-test/ecg-ai-analysis/http-ecg-anomaly.provider';
import { MAX_SCORE_SERIES_POINTS } from '../../src/modules/lab-test/ecg-ai-analysis/ecg-anomaly-provider.port';

describe('ECG response mapper', () => {
    const event = {
        eventId: 'ev-1',
        anomalyScore: '0.83000',
        reviewedByUser: { email: 'bs@x.vn', profile: { fullName: 'BS Nguyễn' } },
        acknowledgedByUser: { email: 'kt@x.vn', profile: null },
    };

    it('event: Decimal -> number, thêm id/score/reviewedByName, bỏ object user', () => {
        const r = toEventResponse(event);
        expect(r).toMatchObject({ id: 'ev-1', eventId: 'ev-1', anomalyScore: 0.83, score: 0.83, reviewedByName: 'BS Nguyễn', acknowledgedByName: 'kt@x.vn' });
        expect(r).not.toHaveProperty('reviewedByUser');
    });

    it('analysis: tách scoreSeries khỏi summaryMetrics, alias anomalies/modelName', () => {
        const r = toAnalysisResponse({
            analysisId: 'an-1',
            maxAnomalyScore: '0.9',
            thresholdUsed: '0.5',
            isCurrent: true,
            modelVersion: { modelName: 'ecg-tcn', version: '1.0.0', status: 'active' },
            summaryMetrics: { hrMean: 72, scoreSeries: [{ tMs: 0, score: 0.1 }, { tMs: 'x', score: 1 }] },
            events: [event],
        });
        expect(r.summaryMetrics).toEqual({ hrMean: 72 });
        expect(r.scoreSeries).toEqual([{ tMs: 0, score: 0.1 }]);
        expect(r.modelName).toBe('ecg-tcn');
        expect(r.maxAnomalyScore).toBe(0.9);
        expect(r.anomalies).toHaveLength(1);
    });

    it('analysis không có events (bản tóm tắt) không tạo anomalies', () => {
        expect(toAnalysisResponse({ analysisId: 'a', summaryMetrics: null })).not.toHaveProperty('anomalies');
        expect(splitSummaryMetrics(null)).toEqual({ summaryMetrics: null, scoreSeries: null });
    });

    it('recording: patientName/encounterCode/originalFileName + latest vs current', () => {
        const r = toRecordingResponse({
            ecgRecordingId: 'rec-1',
            signalQuality: '0.9000',
            acquisitionMeta: { originalFileName: 'ECG_A.csv', gain: 1 },
            encounter: { encounterCode: 'ENC-001', patient: { fullName: 'Nguyễn Văn A' } },
            analyses: [
                { analysisId: 'new', status: 'queued', isCurrent: false },
                { analysisId: 'old', status: 'completed', isCurrent: true },
            ],
        });
        expect(r).toMatchObject({ id: 'rec-1', patientName: 'Nguyễn Văn A', encounterCode: 'ENC-001', originalFileName: 'ECG_A.csv', signalQuality: 0.9 });
        expect(r.latestAnalysis?.analysisId).toBe('new');
        expect(r.currentAnalysis?.analysisId).toBe('old');
        expect(r).not.toHaveProperty('encounter');
    });
});

describe('parseAnalyzeResult - scoreSeries (tuỳ chọn)', () => {
    const base = { overallResult: 'normal', anomalies: [] };

    it('không có scoreSeries -> null (tương thích ngược)', () => {
        expect(parseAnalyzeResult(base).scoreSeries).toBeNull();
    });

    it('bỏ điểm sai định dạng, giữ điểm hợp lệ', () => {
        const r = parseAnalyzeResult({ ...base, scoreSeries: [{ tMs: 0, score: 0.2 }, { tMs: 10, score: 5 }, 'x', { tMs: -1, score: 0.1 }] });
        expect(r.scoreSeries).toEqual([{ tMs: 0, score: 0.2 }]);
    });

    it('lấy mẫu đều khi vượt giới hạn', () => {
        const many = Array.from({ length: MAX_SCORE_SERIES_POINTS * 3 }, (_, i) => ({ tMs: i, score: 0.5 }));
        expect(parseAnalyzeResult({ ...base, scoreSeries: many }).scoreSeries).toHaveLength(MAX_SCORE_SERIES_POINTS);
    });
});
