import { Test, TestingModule } from '@nestjs/testing';
import { RuleBasedLabDetector } from '../../src/modules/lab-test/lab-anomaly/detectors/rule-based.detector';
import { ResultThresholdResolver } from '../../src/modules/lab-test/lab-reference-range/result-threshold.resolver';
import { LabResultWithValues } from '../../src/modules/lab-test/lab-anomaly/interfaces/lab-result-detector.interface';

describe('RuleBasedLabDetector - Function 17: detect', () => {
    let detector: RuleBasedLabDetector;
    let mockResolver: {
        calculateAge: jest.Mock;
        findApplicableRows: jest.Mock;
    };

    const mockPatientContext = {
        patientId: 'pat-001',
        encounterId: 'enc-001',
        doctorUserId: 'user-doc-001',
        dateOfBirth: new Date('1985-05-20'),
        gender: 'male',
    };

    const mockNumericParameter = {
        parameterId: 'param-trop-t',
        parameterCode: 'TROPONIN_T_HS',
        parameterName: 'Troponin T hs',
        dataType: 'numeric',
        unit: 'ng/L',
    };

    const mockBooleanParameter = {
        parameterId: 'param-cardiac-aneurysm',
        parameterCode: 'LV_ANEURYSM',
        parameterName: 'Phình thất trái',
        dataType: 'boolean',
        unit: null,
    };

    // Ngưỡng Troponin T hs: [0, 14] normal | (14, 50] high | (50, +inf) critical
    const standardTroponinRows = [
        {
            thresholdId: 'thresh-normal',
            parameterId: 'param-trop-t',
            riskLevel: 'normal',
            rangeMin: 0,
            rangeMax: 14,
        },
        {
            thresholdId: 'thresh-high',
            parameterId: 'param-trop-t',
            riskLevel: 'high',
            rangeMin: 14.01,
            rangeMax: 50,
        },
        {
            thresholdId: 'thresh-critical',
            parameterId: 'param-trop-t',
            riskLevel: 'critical',
            rangeMin: 50.01,
            rangeMax: null,
        },
    ];

    const createMockLabResult = (values: any[]): LabResultWithValues =>
        ({
            resultId: 'res-001',
            taskId: 'task-001',
            enteredByUserId: 'user-tech-01',
            reviewedByUserId: null,
            findings: null,
            overallConclusion: null,
            resultStatus: 'completed',
            performedAt: new Date('2026-10-16T09:30:00Z'),
            resultedAt: new Date('2026-10-16T10:00:00Z'),
            reviewedAt: null,
            createdAt: new Date('2026-10-16T10:00:00Z'),
            updatedAt: new Date('2026-10-16T10:00:00Z'),
            patientContext: mockPatientContext,
            values,
        }) as any;

    beforeEach(async () => {
        mockResolver = {
            calculateAge: jest.fn().mockReturnValue(41),
            findApplicableRows: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RuleBasedLabDetector,
                {
                    provide: ResultThresholdResolver,
                    useValue: mockResolver,
                },
            ],
        }).compile();

        detector = module.get<RuleBasedLabDetector>(RuleBasedLabDetector);
    });

    // UTCID01: Normal - Chỉ số Troponin T = 8.5 ng/L nằm trong ngưỡng bình thường [0, 14]
    it('UTCID01 [N]: should classify result as normal when valueNumeric is within [0, 14] ng/L', async () => {
        mockResolver.findApplicableRows.mockResolvedValue(standardTroponinRows as any);

        const labResult = createMockLabResult([
            {
                resultValueId: 'val-001',
                parameterId: 'param-trop-t',
                valueNumeric: 8.5,
                valueBoolean: null,
                valueText: null,
                parameter: mockNumericParameter,
            },
        ]);

        const results = await detector.detect(labResult);

        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
            resultValueId: 'val-001',
            parameterId: 'param-trop-t',
            isAbnormal: false,
            riskLevel: null,
            thresholdId: 'thresh-normal',
            expectedMin: 0,
            expectedMax: 14,
        });
        expect(results[0].reason).toContain('trong khoảng an toàn');
    });

    // UTCID02: Normal/Critical - Chỉ số Troponin T = 65.0 ng/L vượt ngưỡng nguy cấp > 50 ng/L
    it('UTCID02 [N]: should classify result as critical when valueNumeric exceeds critical threshold (> 50 ng/L)', async () => {
        mockResolver.findApplicableRows.mockResolvedValue(standardTroponinRows as any);

        const labResult = createMockLabResult([
            {
                resultValueId: 'val-002',
                parameterId: 'param-trop-t',
                valueNumeric: 65.0,
                valueBoolean: null,
                valueText: null,
                parameter: mockNumericParameter,
            },
        ]);

        const results = await detector.detect(labResult);

        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
            resultValueId: 'val-002',
            parameterId: 'param-trop-t',
            isAbnormal: true,
            riskLevel: 'critical',
            thresholdId: 'thresh-critical',
        });
        expect(results[0].reason).toContain('mức độ nguy cơ: critical');
    });

    // UTCID03: Boundary - Giá trị 14.0 ng/L chạm chính xác mốc trên của ngưỡng bình thường
    it('UTCID03 [B]: should classify result as normal at exact upper boundary of normal range (14.0 ng/L)', async () => {
        mockResolver.findApplicableRows.mockResolvedValue(standardTroponinRows as any);

        const labResult = createMockLabResult([
            {
                resultValueId: 'val-003',
                parameterId: 'param-trop-t',
                valueNumeric: 14.0,
                valueBoolean: null,
                valueText: null,
                parameter: mockNumericParameter,
            },
        ]);

        const results = await detector.detect(labResult);

        expect(results).toHaveLength(1);
        expect(results[0].isAbnormal).toBe(false);
        expect(results[0].riskLevel).toBeNull();
        expect(results[0].thresholdId).toBe('thresh-normal');
    });

    // UTCID04: Boundary - Giá trị 14.01 ng/L vừa chớm vượt ngưỡng bình thường -> chuyển sang mức "high"
    it('UTCID04 [B]: should classify result as high at boundary value entering high risk level (14.01 ng/L)', async () => {
        mockResolver.findApplicableRows.mockResolvedValue(standardTroponinRows as any);

        const labResult = createMockLabResult([
            {
                resultValueId: 'val-004',
                parameterId: 'param-trop-t',
                valueNumeric: 14.01,
                valueBoolean: null,
                valueText: null,
                parameter: mockNumericParameter,
            },
        ]);

        const results = await detector.detect(labResult);

        expect(results).toHaveLength(1);
        expect(results[0].isAbnormal).toBe(true);
        expect(results[0].riskLevel).toBe('high');
        expect(results[0].thresholdId).toBe('thresh-high');
        expect(results[0].reason).toContain('mức độ nguy cơ: high');
    });

    // UTCID05: Abnormal - Chưa cấu hình ngưỡng tham chiếu cho chỉ số xét nghiệm ở nhóm tuổi/giới tính này
    it('UTCID05 [A]: should return unconfigured reason when no applicable threshold rows exist', async () => {
        mockResolver.findApplicableRows.mockResolvedValue([]); // Không có dòng ngưỡng nào

        const labResult = createMockLabResult([
            {
                resultValueId: 'val-005',
                parameterId: 'param-trop-t',
                valueNumeric: 12.0,
                valueBoolean: null,
                valueText: null,
                parameter: mockNumericParameter,
            },
        ]);

        const results = await detector.detect(labResult);

        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
            resultValueId: 'val-005',
            parameterId: 'param-trop-t',
            isAbnormal: false,
            riskLevel: null,
            thresholdId: null,
        });
        expect(results[0].reason).toContain('Chưa cấu hình ngưỡng tham chiếu');
    });

    // UTCID06: Normal/Boolean - Tham số định tính boolean = true (phát hiện dấu hiệu bệnh lý bất thường)
    it('UTCID06 [N]: should classify boolean parameter with valueBoolean = true as abnormal with high risk', async () => {
        const labResult = createMockLabResult([
            {
                resultValueId: 'val-006',
                parameterId: 'param-cardiac-aneurysm',
                valueNumeric: null,
                valueBoolean: true,
                valueText: null,
                parameter: mockBooleanParameter,
            },
        ]);

        const results = await detector.detect(labResult);

        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
            resultValueId: 'val-006',
            parameterId: 'param-cardiac-aneurysm',
            isAbnormal: true,
            riskLevel: 'high',
        });
        expect(results[0].reason).toContain('ghi nhận dấu hiệu bất thường');
    });
});
