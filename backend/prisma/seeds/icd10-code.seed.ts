import { PrismaService } from 'prisma/prisma.service';

export async function seedIcd10Codes(prisma: PrismaService): Promise<void> {
    const existingCount = await prisma.icd10Code.count();
    if (existingCount > 0) {
        console.log(`Bảng icd10_codes đã có ${existingCount} bản ghi, bỏ qua seed.`);
        return;
    }

    const codes = [
        { icd10Code: 'J00', icd10Name: 'Acute nasopharyngitis [common cold]', icd10NameVi: 'Viêm mũi họng cấp (cảm lạnh thông thường)', chapter: 'Bệnh hô hấp', isCurable: true },
        { icd10Code: 'J02.9', icd10Name: 'Acute pharyngitis, unspecified', icd10NameVi: 'Viêm họng cấp không xác định', chapter: 'Bệnh hô hấp', isCurable: true },
        { icd10Code: 'J03.9', icd10Name: 'Acute tonsillitis, unspecified', icd10NameVi: 'Viêm amidan cấp không xác định', chapter: 'Bệnh hô hấp', isCurable: true },
        { icd10Code: 'J18.9', icd10Name: 'Pneumonia, unspecified organism', icd10NameVi: 'Viêm phổi không xác định', chapter: 'Bệnh hô hấp', isCurable: true },
        { icd10Code: 'J45.9', icd10Name: 'Asthma, unspecified', icd10NameVi: 'Hen phế quản không xác định', chapter: 'Bệnh hô hấp', isCurable: false },
        { icd10Code: 'K29.7', icd10Name: 'Gastritis, unspecified', icd10NameVi: 'Viêm dạ dày không xác định', chapter: 'Bệnh tiêu hóa', isCurable: true },
        { icd10Code: 'K21.0', icd10Name: 'Gastro-oesophageal reflux disease with oesophagitis', icd10NameVi: 'Trào ngược dạ dày thực quản kèm viêm thực quản', chapter: 'Bệnh tiêu hóa', isCurable: false },
        { icd10Code: 'A09', icd10Name: 'Infectious gastroenteritis and colitis, unspecified', icd10NameVi: 'Viêm dạ dày ruột nhiễm trùng không xác định', chapter: 'Bệnh nhiễm trùng', isCurable: true },
        { icd10Code: 'E11.9', icd10Name: 'Type 2 diabetes mellitus without complications', icd10NameVi: 'Đái tháo đường típ 2 không biến chứng', chapter: 'Bệnh nội tiết - chuyển hóa', isCurable: false },
        { icd10Code: 'I10', icd10Name: 'Essential (primary) hypertension', icd10NameVi: 'Tăng huyết áp nguyên phát', chapter: 'Bệnh tuần hoàn', isCurable: false },
        { icd10Code: 'R50.9', icd10Name: 'Fever, unspecified', icd10NameVi: 'Sốt không xác định nguyên nhân', chapter: 'Triệu chứng, dấu hiệu chưa phân loại', isCurable: true },
        { icd10Code: 'L23.9', icd10Name: 'Allergic contact dermatitis, unspecified cause', icd10NameVi: 'Viêm da tiếp xúc dị ứng không xác định', chapter: 'Bệnh da và mô dưới da', isCurable: true },
        { icd10Code: 'M54.5', icd10Name: 'Low back pain', icd10NameVi: 'Đau thắt lưng', chapter: 'Bệnh cơ xương khớp', isCurable: true },
        { icd10Code: 'N39.0', icd10Name: 'Urinary tract infection, site not specified', icd10NameVi: 'Nhiễm khuẩn đường tiết niệu không xác định vị trí', chapter: 'Bệnh hệ tiết niệu - sinh dục', isCurable: true },
        { icd10Code: 'H10.9', icd10Name: 'Conjunctivitis, unspecified', icd10NameVi: 'Viêm kết mạc không xác định', chapter: 'Bệnh mắt', isCurable: true },
    ];

    await prisma.icd10Code.createMany({
        data: codes.map((c) => ({ ...c, isActive: true })),
        skipDuplicates: true,
    });

    const count = await prisma.icd10Code.count();
    console.log(`Seeded ICD-10 codes, total in DB: ${count}`);
}
