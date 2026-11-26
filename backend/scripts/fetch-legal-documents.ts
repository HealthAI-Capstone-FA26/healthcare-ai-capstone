/**
 * Tải các văn bản pháp lý trong manifest về prisma/seeds/legal/files/ và ghi checksum.
 * Chạy ở máy dev/CI có internet:  npx ts-node scripts/fetch-legal-documents.ts
 *
 * Văn bản chưa có sourceUrl trực tiếp (tải tay từ pageUrl) chỉ cần đặt đúng tên `localFile`
 * vào thư mục files/; script sẽ kiểm tra PDF và ghi checksum cho các file đó.
 */
import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { LEGAL_DOCUMENTS } from '../prisma/seeds/legal/legal-documents.manifest';

const FILES_DIR = join(__dirname, '..', 'prisma', 'seeds', 'legal', 'files');
const LOCK_FILE = join(FILES_DIR, 'checksums.json');

const isPdf = (buf: Buffer): boolean => buf.subarray(0, 5).toString('latin1') === '%PDF-';
const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');

async function main(): Promise<void> {
    await mkdir(FILES_DIR, { recursive: true });
    const checksums: Record<string, string> = existsSync(LOCK_FILE)
        ? JSON.parse(await readFile(LOCK_FILE, 'utf8'))
        : {};
    const manual: string[] = [];

    for (const doc of LEGAL_DOCUMENTS) {
        const target = join(FILES_DIR, doc.localFile);

        if (!doc.sourceUrl) {
            if (!existsSync(target)) {
                manual.push(`${doc.code}: tải tay từ ${doc.pageUrl} -> ${doc.localFile}`);
                continue;
            }
            const buf = await readFile(target);
            if (!isPdf(buf)) {
                manual.push(`${doc.code}: ${doc.localFile} không phải PDF hợp lệ`);
                continue;
            }
            checksums[doc.localFile] = sha256(buf);
            console.log(`OK  ${doc.code} (file thủ công, ${buf.length} bytes)`);
            continue;
        }

        const res = await fetch(doc.sourceUrl, { redirect: 'follow' });
        if (!res.ok) {
            manual.push(`${doc.code}: HTTP ${res.status} từ ${doc.sourceUrl}; tải tay từ ${doc.pageUrl}`);
            continue;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (!isPdf(buf)) {
            manual.push(`${doc.code}: nội dung tải về không phải PDF (có thể bị chặn/đăng nhập); tải tay từ ${doc.pageUrl}`);
            continue;
        }

        await writeFile(target, buf);
        checksums[doc.localFile] = sha256(buf);
        console.log(`OK  ${doc.code} (${buf.length} bytes)`);
    }

    await writeFile(LOCK_FILE, JSON.stringify(checksums, null, 2));

    if (manual.length) {
        console.log('\nCần xử lý thủ công:');
        manual.forEach((m) => console.log(` - ${m}`));
        process.exitCode = 1;
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});