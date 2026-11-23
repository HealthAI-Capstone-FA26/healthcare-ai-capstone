import { ForbiddenException } from '@nestjs/common';
import { EcgModelService } from '../../src/modules/lab-test/ecg-ai-analysis/ecg-model.service';

describe('EcgModelService.listSelectable', () => {
    const prisma = { aiModelVersion: { findMany: jest.fn() } };
    const roles = { assertActorRole: jest.fn() };
    const service = new EcgModelService(prisma as any, roles as any);

    beforeEach(() => jest.resetAllMocks());

    it('chỉ LAB_STAFF/DOCTOR/ADMIN', async () => {
        roles.assertActorRole.mockRejectedValue(new ForbiddenException());
        await expect(service.listSelectable('u')).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.aiModelVersion.findMany).not.toHaveBeenCalled();
    });

    it('lọc active/candidate theo taskType, đánh dấu isDefault, ép Decimal -> number', async () => {
        roles.assertActorRole.mockResolvedValue('LAB_STAFF');
        prisma.aiModelVersion.findMany.mockResolvedValue([
            { modelVersionId: 'm2', modelName: 'ecg', version: '1.1.0', status: 'candidate', defaultThreshold: '0.40000' },
            { modelVersionId: 'm1', modelName: 'ecg', version: '1.0.0', status: 'active', defaultThreshold: '0.50000' },
        ]);
        const r = await service.listSelectable('u');
        expect(prisma.aiModelVersion.findMany.mock.calls[0][0].where).toEqual({ taskType: 'ecg_anomaly_detection', status: { in: ['active', 'candidate'] } });
        expect(r.map((m) => [m.modelVersionId, m.isDefault, m.defaultThreshold])).toEqual([['m2', false, 0.4], ['m1', true, 0.5]]);
        expect(r[0].label).toContain('thử nghiệm');
        expect(r[0]).not.toHaveProperty('artifactUrl');
    });
});
