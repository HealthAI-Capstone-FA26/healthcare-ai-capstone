import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline'; // <-- Khắc phục: Cannot find name 'readline'

// ==========================================
// 1. HELPER FUNCTIONS (Khai báo trước main)
// ==========================================

// Khắc phục: Cannot find name 'formatIcdCode'
function formatIcdCode(code: string): string {
    if (code.length > 3) {
        return `${code.slice(0, 3)}.${code.slice(3)}`;
    }
    return code;
}

// Khắc phục: Cannot find name 'getChapterName'
function getChapterName(code: string): string {
    const firstChar = code.charAt(0).toUpperCase();

    switch (firstChar) {
        case 'A': case 'B': return 'Certain infectious and parasitic diseases (A00-B99)';
        case 'C': case 'D':
            if (firstChar === 'D' && parseInt(code.substring(1, 3)) >= 50) {
                return 'Diseases of the blood and blood-forming organs (D50-D89)';
            }
            return 'Neoplasms (C00-D49)';
        case 'E': return 'Endocrine, nutritional and metabolic diseases (E00-E89)';
        case 'F': return 'Mental and behavioral disorders (F01-F99)';
        case 'G': return 'Diseases of the nervous system (G00-G99)';
        case 'H': {
            const hNum = parseInt(code.substring(1, 3));
            return hNum <= 59
                ? 'Diseases of the eye and adnexa (H00-H59)'
                : 'Diseases of the ear and mastoid process (H60-H95)';
        }
        case 'I': return 'Diseases of the circulatory system (I00-I99)';
        case 'J': return 'Diseases of the respiratory system (J00-J99)';
        case 'K': return 'Diseases of the digestive system (K00-K95)';
        case 'L': return 'Diseases of the skin and subcutaneous tissue (L00-L99)';
        case 'M': return 'Diseases of the musculoskeletal system and connective tissue (M00-M99)';
        case 'N': return 'Diseases of the genitourinary system (N00-N99)';
        case 'O': return 'Pregnancy, childbirth and the puerperium (O00-O9A)';
        case 'P': return 'Certain conditions originating in the perinatal period (P00-P96)';
        case 'Q': return 'Congenital malformations, deformations and chromosomal abnormalities (Q00-Q99)';
        case 'R': return 'Symptoms, signs and abnormal clinical and laboratory findings (R00-R99)';
        case 'S': case 'T': return 'Injury, poisoning and certain other consequences of external causes (S00-T88)';
        case 'V': case 'W': case 'X': case 'Y': return 'External causes of morbidity (V00-Y99)';
        case 'Z': return 'Factors influencing health status and contact with health services (Z00-Z99)';
        case 'U': return 'Codes for special purposes (U00-U85)';
        default: return 'Other / Unclassified';
    }
}

// ==========================================
// 2. MAIN SEED FUNCTION
// ==========================================

export async function seedIcd10(prisma: PrismaClient) {
    console.log('Đang khởi chạy quá trình seed ICD-10...');

    // Không hard-code năm cụ thể (VD: 'icd10cm_codes_2026.txt') — CMS phát hành file mới theo
    // từng năm và tên file luôn đổi theo (thực tế đã gặp: code kỳ vọng '..._2026.txt' nhưng file
    // thật là '..._2027.txt' -> lỗi "Không tìm thấy file"). Thay vào đó, tự động dò mọi file khớp
    // pattern 'icd10cm_codes_<năm>.txt' trong cùng thư mục, và ưu tiên chọn file có năm LỚN NHẤT
    // (mới nhất) nếu vô tình có nhiều bản.
    const ICD10_FILE_PATTERN = /^icd10cm_codes_(\d{4})\.txt$/i;

    const candidateFiles = fs
        .readdirSync(__dirname)
        .map((name) => ({ name, match: name.match(ICD10_FILE_PATTERN) }))
        .filter((f): f is { name: string; match: RegExpMatchArray } => f.match !== null)
        .sort((a, b) => Number(b.match[1]) - Number(a.match[1])); // năm lớn nhất trước

    if (candidateFiles.length === 0) {
        console.error(
            `Không tìm thấy file dữ liệu ICD-10 nào (dạng 'icd10cm_codes_<năm>.txt') trong thư mục: ${__dirname}`,
        );
        console.error('Vui lòng copy file txt (tải từ CMS) vào cùng thư mục với icd10.seed.ts');
        process.exit(1);
    }

    if (candidateFiles.length > 1) {
        console.warn(
            `Tìm thấy ${candidateFiles.length} file dữ liệu ICD-10: ${candidateFiles.map((f) => f.name).join(', ')} ` +
            `— dùng bản mới nhất: ${candidateFiles[0].name}`,
        );
    }

    const filePath = path.join(__dirname, candidateFiles[0].name);

    const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
    });

    const records: Array<{
        icd10Code: string;
        icd10Name: string;
        chapter: string;
        isActive: boolean;
    }> = [];

    for await (const line of rl) {
        if (!line.trim()) continue;

        // Fixed-width format của CMS:
        // - Cols 0..7: Code gốc (VD: R079)
        // - Cols 8..end: Mô tả tiếng Anh (VD: Chest pain, unspecified)
        const rawCode = line.substring(0, 7).trim();
        const description = line.substring(8).trim();

        if (rawCode) {
            const formattedCode = formatIcdCode(rawCode);

            records.push({
                icd10Code: formattedCode,
                icd10Name: description.substring(0, 255), // Giới hạn db.VarChar(255)
                chapter: getChapterName(rawCode).substring(0, 100), // Giới hạn db.VarChar(100)
                isActive: true,
            });
        }
    }

    console.log(`Đã đọc thành công ${records.length} mã ICD-10.`);

    const BATCH_SIZE = 3000;
    console.log(`Đang chèn dữ liệu vào DB theo batch (${BATCH_SIZE} bản ghi/lần)...`);

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);

        await prisma.icd10Code.createMany({
            data: batch,
            skipDuplicates: true,
        });

        console.log(`   -> Đã chèn ${Math.min(i + BATCH_SIZE, records.length)} / ${records.length} mã...`);
    }

    console.log('Seed thành công dữ liệu ICD-10!');
}