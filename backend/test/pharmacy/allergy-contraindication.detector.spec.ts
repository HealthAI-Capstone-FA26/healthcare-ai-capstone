import {
    AllergyContraindicationDetector,
    matchesDrugAllergen,
} from '../../src/modules/pharmacy/prescription/prescription-safety/detectors/allergy-contraindication.detector';

describe('AllergyContraindicationDetector', () => {
    const createDetector = (allergyText: string) => {
        const mockPrisma = {
            patientAllergy: {
                findMany: jest.fn().mockResolvedValue([{ allergyText, status: 'active' }]),
            },
        };
        return new AllergyContraindicationDetector(mockPrisma as any);
    };

    const makeItem = (drugName: string, genericName: string) =>
        [
            {
                prescriptionItemId: 'item-1',
                drug: { drugName, genericName },
            },
        ] as any;

    describe('matchesDrugAllergen', () => {
        it('khớp "Penicillin" với "Benzylpenicilin (kali hoặc natri) 500.000 IU"', () => {
            expect(
                matchesDrugAllergen(
                    'Penicillin',
                    'Benzylpenicilin (kali hoặc natri) 500.000 IU',
                    'Benzylpenicilin',
                ),
            ).toBe(true);
        });

        it('KHÔNG khớp "Penicillin" với "Amoxicillin 500mg"', () => {
            expect(matchesDrugAllergen('Penicillin', 'Amoxicillin 500mg', 'Amoxicillin')).toBe(false);
        });

        it('KHÔNG khớp "Penicillin" với "Penicilamin 250mg"', () => {
            expect(matchesDrugAllergen('Penicillin', 'Penicilamin 250mg', 'Penicilamin')).toBe(false);
        });

        it('KHÔNG khớp "Sulfa" với "Atropin Sulfat 0.25mg/ml"', () => {
            expect(matchesDrugAllergen('Sulfa', 'Atropin Sulfat 0.25mg/ml', 'Atropin sulfat')).toBe(false);
        });

        it('khớp "Sulfadiazin" với "Sulfadiazin 500mg"', () => {
            expect(matchesDrugAllergen('Sulfadiazin', 'Sulfadiazin 500mg', 'Sulfadiazin')).toBe(true);
        });

        it('khớp "Amoxicillin" với "Amoxicillin 500mg"', () => {
            expect(matchesDrugAllergen('Amoxicillin', 'Amoxicillin 500mg', 'Amoxicillin')).toBe(true);
        });

        it('khớp "Aspirin" với "Acid Acetylsalicylic 300-500mg" qua alias', () => {
            expect(
                matchesDrugAllergen('Aspirin', 'Acid Acetylsalicylic 300-500mg', 'Acid acetylsalicylic'),
            ).toBe(true);
        });

        it('khớp "Ibuprofen" với "Ibuprofen 400mg"', () => {
            expect(matchesDrugAllergen('Ibuprofen', 'Ibuprofen 400mg', 'Ibuprofen')).toBe(true);
        });
    });

    describe('detect', () => {
        it('tạo alert contraindicated khi dị nguyên [DRUG] khớp thuốc và không chứa ", thuộc nhóm"', async () => {
            const detector = createDetector('[DRUG] Penicillin');
            const alerts = await detector.detect(
                'rx-01',
                makeItem('Benzylpenicilin (kali hoặc natri) 500.000 IU', 'Benzylpenicilin'),
                'pat-01',
            );

            expect(alerts).toHaveLength(1);
            expect(alerts[0].alertType).toBe('allergy_contraindication');
            expect(alerts[0].severity).toBe('contraindicated');
            expect(alerts[0].relatedItemIdA).toBe('item-1');
            expect(alerts[0].description).not.toContain('thuộc nhóm');
        });

        it('KHÔNG tạo alert khi dị nguyên chỉ nằm ở phần [FOOD] (vd "tôm")', async () => {
            const detector = createDetector('[FOOD] tôm');
            const alerts = await detector.detect(
                'rx-01',
                makeItem('Tôm-drug 500mg', 'tôm'),
                'pat-01',
            );

            expect(alerts).toHaveLength(0);
        });
    });
});
