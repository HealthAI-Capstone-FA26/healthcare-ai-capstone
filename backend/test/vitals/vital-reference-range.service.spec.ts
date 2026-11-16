import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VitalReferenceRangeService } from '../../src/modules/clinical/vitals/vital-reference-range/vital-reference-range.service';
import { calculateAge } from '../../src/modules/clinical/vitals/common/vital-threshold.utils';

const items = [
  { itemId: 'i-hr', itemCode: 'HR', itemName: 'Mạch', unit: 'bpm' },
  { itemId: 'i-height', itemCode: 'HEIGHT', itemName: 'Chiều cao', unit: 'cm' },
  { itemId: 'i-bmi', itemCode: 'BMI', itemName: 'BMI', unit: 'kg/m2' },
];

const threshold = (over: Record<string, any> = {}) => ({
  vitalThresholdId: 't-1', minNormal: 51, maxNormal: 90, gender: null, sourceReference: 'NEWS2', ageMin: 16, ageMax: 64, ...over,
});

describe('VitalReferenceRangeService.getReferenceRanges (normal range shown next to the input box)', () => {
  let service: VitalReferenceRangeService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      patient: { findUnique: jest.fn().mockResolvedValue({ dateOfBirth: new Date(2000, 0, 1), gender: 'male' }) },
      vitalSignItem: { findMany: jest.fn().mockResolvedValue(items) },
      vitalSignThreshold: {
        findMany: jest.fn(async ({ where }: any) => (where.itemId === 'i-hr' ? [threshold()] : [])),
      },
    };
    service = new VitalReferenceRangeService(prisma);
  });

  it('UTCID01 [N]: adult -> HR range from threshold table, BMI 18.5-24.9, HEIGHT skipped (no threshold configured)', async () => {
    const ranges = await service.getReferenceRanges('pat-01', '2026-11-20T03:00:00.000Z');

    expect(ranges.map((r) => r.itemCode)).toEqual(['HR', 'BMI']);
    expect(ranges[0]).toMatchObject({ minNormal: 51, maxNormal: 90, unit: 'bpm', sourceReference: 'NEWS2' });
    expect(ranges[1]).toMatchObject({ minNormal: 18.5, maxNormal: 24.9 });
  });

  it('UTCID02 [N]: gender-specific threshold wins over the generic one', async () => {
    prisma.vitalSignThreshold.findMany.mockImplementation(async ({ where }: any) =>
      where.itemId === 'i-hr' ? [threshold({ gender: null }), threshold({ gender: 'male', minNormal: 55, maxNormal: 95 })] : [],
    );

    const [hr] = await service.getReferenceRanges('pat-01', '2026-11-20T03:00:00.000Z');

    expect(hr).toMatchObject({ minNormal: 55, maxNormal: 95 });
  });

  it('UTCID03 [N]: child under 2 years has no BMI range (BMI-for-age not applicable)', async () => {
    prisma.patient.findUnique.mockResolvedValue({ dateOfBirth: new Date(2026, 0, 1), gender: 'male' });

    const ranges = await service.getReferenceRanges('pat-01', '2026-11-20T03:00:00.000Z');

    expect(ranges.find((r) => r.itemCode === 'BMI')).toBeUndefined();
  });

  it('UTCID04 [N]: age is evaluated at measuredAt (query uses ageMin/ageMax filters and effectiveFrom <= measuredAt)', async () => {
    await service.getReferenceRanges('pat-01', '2026-11-20T03:00:00.000Z');

    const where = prisma.vitalSignThreshold.findMany.mock.calls[0][0].where;
    expect(where.itemId).toBe('i-hr');
    expect(where.isActive).toBe(true);
    expect(where.effectiveFrom.lte).toEqual(new Date('2026-11-20T03:00:00.000Z'));
  });

  it('UTCID05 [A]: unknown patient -> NotFoundException', async () => {
    prisma.patient.findUnique.mockResolvedValue(null);

    await expect(service.getReferenceRanges('nope')).rejects.toThrow(NotFoundException);
  });

  it('UTCID06 [A]: patient without date of birth -> BadRequestException', async () => {
    prisma.patient.findUnique.mockResolvedValue({ dateOfBirth: null, gender: 'male' });

    await expect(service.getReferenceRanges('pat-01')).rejects.toThrow(BadRequestException);
  });

  it('UTCID07 [B]: calculateAge turns 21 exactly on the birthday, not a day before', () => {
    const dob = new Date(2005, 5, 15);
    expect(calculateAge(dob, new Date(2026, 5, 14))).toBe(20);
    expect(calculateAge(dob, new Date(2026, 5, 15))).toBe(21);
  });
});
