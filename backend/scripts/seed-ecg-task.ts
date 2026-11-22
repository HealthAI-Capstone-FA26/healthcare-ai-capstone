/**
 * Seed task ECG (đã ở trạng thái in_progress) + bản ghi ECG vào PostgreSQL và S3/MinIO.
 *
 * Đặt file này vào  <backend>/scripts/seed-ecg-task.ts  rồi chạy ở thư mục gốc backend (cùng .env với app):
 *
 *   # Seed cả 6 dataset ECG_A..ECG_F (mỗi dataset = 1 task + 1 bản ghi ECG):
 *   npx ts-node --transpile-only scripts/seed-ecg-task.ts --dir ./datasets/ecg
 *
 *   # Chỉ một vài dataset:
 *   npx ts-node --transpile-only scripts/seed-ecg-task.ts --dir ./datasets/ecg --only B,C
 *
 *   # Một file .npy bất kỳ (tham số thứ 2 = sampleRateHz, mặc định 100):
 *   npx ts-node --transpile-only scripts/seed-ecg-task.ts ./ECG_A/ECG_test.npy 100
 *
 *   # Chỉ tạo task, không upload (rồi tự upload bằng API POST /lab-tasks/:id/ecg-recordings):
 *   npx ts-node --transpile-only scripts/seed-ecg-task.ts --task-only
 *
 * Với --dir: mỗi dataset tìm theo thứ tự  <dir>/ECG_X/ECG_test.npy  rồi  <dir>/ECG_X.npy.
 * Tần số lấy mẫu lấy từ <dir>/ECG_X/meta.json { "sampleRateHz": N } nếu có, không thì biến môi trường
 * ECG_DATASET_SAMPLE_RATE_HZ / SEED_SAMPLE_RATE_HZ, mặc định 100 (giống ecg-dataset.catalog.ts của backend).
 * Chạy lại nhiều lần an toàn: file đã seed (cùng checksum, cùng lượt khám) sẽ bị bỏ qua.
 *
 * Script dùng S3 client của dự án (minioClient, BUCKET_NAME) nên đọc cùng biến môi trường: DATABASE_URL, MINIO_* hoặc S3_*.
 * Nó KHÔNG phát event 'ecg-recording.completed' nên AI không tự chạy; muốn phân tích AI thì gọi
 * POST /api/v1/ecg-recordings/:id/analyses sau đó.
 */
import 'dotenv/config';
import { createHash, randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { basename, extname, join } from 'path';
import { PrismaClient } from '@prisma/client';
// Prisma 7+: bắt buộc driver adapter. Nếu thiếu gói:  npm i @prisma/adapter-pg pg
import { PrismaPg } from '@prisma/adapter-pg';
import { BUCKET_NAME, minioClient } from '../src/common/configs/upload.config';

// ====== ĐIỀN / SỬA CHO KHỚP DB CỦA BẠN (mặc định lấy từ dữ liệu bạn đã gửi) ======
const CFG = {
    encounterId: process.env.SEED_ENCOUNTER_ID ?? '1677f7de-f9d9-4086-ae0c-ef23eb5a8f89',
    doctorId: process.env.SEED_DOCTOR_ID ?? '4e233709-a54a-48da-b1fc-774ca4fa4b57', // bshuy
    diagnosisId: process.env.SEED_DIAGNOSIS_ID ?? 'b042747e-13ca-4d4e-853e-809a48883cac', // chẩn đoán initial
    labStaffUserId: process.env.SEED_LAB_STAFF_ID ?? '1bae6271-c00b-48fa-a156-038386dda930', // lab@gmail.com
};
// ==============================================================================

const DATASET_NAMES = ['ECG_A', 'ECG_B', 'ECG_C', 'ECG_D', 'ECG_E', 'ECG_F'] as const;
const NPY_MAGIC = Buffer.from([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]);

interface Source {
    label: string;
    filePath?: string; // undefined = chỉ tạo task, không upload
    sampleRateHz: number;
}
interface Prepared {
    buf: Buffer;
    steps: number;
    checksum: string;
}
interface SeedResult {
    label: string;
    status: 'ok' | 'skipped' | 'failed';
    taskId?: string;
    recordingId?: string;
    note?: string;
}

/** Đọc shape từ header .npy (không cần numpy). */
function readNpyShape(buf: Buffer): number[] {
    if (buf.length < 10 || !buf.subarray(0, 6).equals(NPY_MAGIC)) throw new Error('Không phải tệp .npy hợp lệ (sai magic).');
    const major = buf[6];
    const headerLen = major === 1 ? buf.readUInt16LE(8) : buf.readUInt32LE(8);
    const start = major === 1 ? 10 : 12;
    const header = buf.subarray(start, start + headerLen).toString('latin1');
    const m = /'shape'\s*:\s*\(([^)]*)\)/.exec(header);
    if (!m) throw new Error('Header .npy thiếu shape.');
    return m[1].split(',').map((s) => s.trim()).filter(Boolean).map(Number);
}

/** Backend chỉ nhận 2 lead (ECG_REQUIRED_LEADS=2): shape phải là [steps,2] hoặc [2,steps]. */
function resolveSteps(shape: number[]): { steps: number; leads: number } {
    if (shape.length !== 2) {
        throw new Error(`Shape .npy là (${shape.join(', ')}). Cần mảng 2 chiều (steps×2 hoặc 2×steps) — hãy tách 1 recording trước khi upload.`);
    }
    const [a, b] = shape;
    if (b === 2) return { steps: a, leads: 2 };
    if (a === 2) return { steps: b, leads: 2 };
    throw new Error(`Shape .npy là (${a}, ${b}) nhưng hệ thống yêu cầu đúng 2 lead.`);
}

/** Đọc + kiểm tra file TRƯỚC khi đụng DB. */
async function prepareFile(filePath: string): Promise<Prepared> {
    if (extname(filePath).toLowerCase() !== '.npy') throw new Error('File phải có đuôi .npy');
    const buf = await fs.readFile(filePath);
    const { steps, leads } = resolveSteps(readNpyShape(buf));
    console.log(`  File: ${basename(filePath)} · ${buf.length} bytes · ${steps} mẫu × ${leads} lead`);
    return { buf, steps, checksum: createHash('sha256').update(buf).digest('hex') };
}

async function exists(p: string): Promise<boolean> {
    try {
        return (await fs.stat(p)).isFile();
    } catch {
        return false;
    }
}

function defaultSampleRate(): number {
    return Number(process.env.ECG_DATASET_SAMPLE_RATE_HZ ?? process.env.SEED_SAMPLE_RATE_HZ ?? 100);
}

async function datasetSampleRate(dir: string, name: string): Promise<number> {
    try {
        const meta: unknown = JSON.parse(await fs.readFile(join(dir, name, 'meta.json'), 'utf8'));
        const v = (meta as { sampleRateHz?: unknown })?.sampleRateHz;
        if (typeof v === 'number' && Number.isFinite(v) && v >= 50 && v <= 4000) return v;
    } catch {
        /* không có meta.json -> mặc định */
    }
    return defaultSampleRate();
}

/** Tìm file của từng dataset ECG_A..F trong thư mục dataset. */
async function resolveDatasetSources(dir: string, only: string[] | undefined): Promise<Source[]> {
    const wanted = only?.length
        ? DATASET_NAMES.filter((n) => only.some((o) => n === o.toUpperCase() || n === `ECG_${o.toUpperCase()}`))
        : [...DATASET_NAMES];
    if (only?.length && wanted.length === 0) throw new Error(`--only không khớp dataset nào (hợp lệ: ${DATASET_NAMES.join(', ')}).`);

    const sources: Source[] = [];
    for (const name of wanted) {
        const candidates = [join(dir, name, 'ECG_test.npy'), join(dir, `${name}.npy`)];
        let found: string | undefined;
        for (const c of candidates) {
            if (await exists(c)) {
                found = c;
                break;
            }
        }
        if (!found) {
            console.warn(`[${name}] Không thấy file trong ${dir} (đã thử: ${candidates.join(' | ')}) -> bỏ qua.`);
            continue;
        }
        sources.push({ label: name, filePath: found, sampleRateHz: await datasetSampleRate(dir, name) });
    }
    return sources;
}

function argValue(args: string[], flag: string): string | undefined {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
}

async function seedOne(
    prisma: PrismaClient,
    ctx: { room: { diagnosticRoomId: string }; service: { serviceId: string; price: any } },
    src: Source,
    prepared: Prepared | undefined,
): Promise<SeedResult> {
    // Bỏ qua nếu file này đã được seed cho lượt khám (tránh nhân đôi khi chạy lại).
    if (prepared) {
        const dup = await prisma.ecgRecording.findFirst({
            where: { encounterId: CFG.encounterId, signalChecksum: prepared.checksum, status: { not: 'cancelled' } },
            select: { ecgRecordingId: true, taskId: true },
        });
        if (dup) return { label: src.label, status: 'skipped', taskId: dup.taskId, recordingId: dup.ecgRecordingId, note: 'đã seed trước đó (cùng checksum)' };
    }

    const now = new Date();
    const order = await prisma.diagnosticOrder.create({
        data: {
            orderCode: `CD${now.toISOString().slice(2, 10).replace(/-/g, '')}${randomBytes(3).toString('hex').toUpperCase()}`,
            encounterId: CFG.encounterId,
            doctorId: CFG.doctorId,
            diagnosisId: CFG.diagnosisId,
            priority: 'routine',
            status: 'in_progress',
            orderedAt: now,
        },
    });
    const item = await prisma.diagnosticOrderItem.create({
        data: { orderId: order.orderId, serviceId: ctx.service.serviceId, unitPrice: ctx.service.price, status: 'ordered' },
    });
    const task = await prisma.diagnosticTask.create({
        data: {
            orderItemId: item.orderItemId,
            diagnosticRoomId: ctx.room.diagnosticRoomId,
            assignedStaffUserId: CFG.labStaffUserId,
            paymentVerified: true,
            paymentVerifiedAt: now,
            priority: 'routine',
            status: 'in_progress',
            readyAt: now,
            receivedAt: now,
            startedAt: now,
        },
    });
    console.log(`  Đã tạo task ECG (in_progress): ${task.taskId}`);

    if (!prepared || !src.filePath) return { label: src.label, status: 'ok', taskId: task.taskId, note: 'chỉ tạo task' };

    // Upload file lên S3/MinIO + ghi EcgRecording (giống EcgRecordingService.createFromFile)
    const rec = await prisma.ecgRecording.create({
        data: {
            taskId: task.taskId,
            encounterId: CFG.encounterId,
            recordingMode: 'file_upload',
            recordingType: 'rhythm_strip',
            status: 'pending',
            sampleRateHz: src.sampleRateHz,
            numLeads: 2,
            leadNames: ['I', 'II'],
            durationMs: Math.round((prepared.steps / src.sampleRateHz) * 1000),
            signalFormat: 'npy',
            signalSizeBytes: BigInt(prepared.buf.length),
            signalChecksum: prepared.checksum,
            acquisitionMeta: { originalFileName: basename(src.filePath), dataset: src.label, seededBy: 'seed-ecg-task.ts' },
        },
        select: { ecgRecordingId: true },
    });

    const objectName = `ecg/${CFG.encounterId}/${rec.ecgRecordingId}.npy`;
    try {
        await minioClient.putObject(BUCKET_NAME, objectName, prepared.buf, prepared.buf.length, { 'Content-Type': 'application/octet-stream' });
    } catch (err) {
        await prisma.ecgRecording.delete({ where: { ecgRecordingId: rec.ecgRecordingId } }).catch(() => undefined);
        throw new Error(`Upload S3 thất bại (bản ghi nháp đã xoá, task ${task.taskId} vẫn còn): ${(err as Error).message}`);
    }
    await prisma.ecgRecording.update({
        where: { ecgRecordingId: rec.ecgRecordingId },
        data: { signalFileUrl: objectName, status: 'completed' },
    });
    console.log(`  Đã upload s3://${BUCKET_NAME}/${objectName}`);
    return { label: src.label, status: 'ok', taskId: task.taskId, recordingId: rec.ecgRecordingId };
}

async function main() {
    const args = process.argv.slice(2);
    const taskOnly = args.includes('--task-only');
    const dir = argValue(args, '--dir');
    const only = argValue(args, '--only')?.split(',').map((s) => s.trim()).filter(Boolean);

    // Giá trị của --dir/--only không được tính là tham số vị trí.
    const flagValues = new Set([dir, argValue(args, '--only')].filter((v): v is string => !!v));
    const positional = args.filter((a) => !a.startsWith('--') && !flagValues.has(a));

    let sources: Source[];
    if (dir) {
        sources = await resolveDatasetSources(dir, only);
        if (sources.length === 0) throw new Error(`Không tìm thấy dataset nào trong ${dir}.`);
        if (taskOnly) sources = sources.map((s) => ({ ...s, filePath: undefined }));
    } else if (taskOnly) {
        sources = [{ label: 'task-only', sampleRateHz: defaultSampleRate() }];
    } else {
        const filePath = positional[0];
        if (!filePath) throw new Error('Thiếu đường dẫn file .npy (hoặc dùng --dir <thư mục dataset> / --task-only).');
        const sr = Number(positional[1] ?? defaultSampleRate());
        sources = [{ label: basename(filePath), filePath, sampleRateHz: sr }];
    }
    for (const s of sources) {
        if (!Number.isInteger(s.sampleRateHz) || s.sampleRateHz < 50 || s.sampleRateHz > 4000) {
            throw new Error(`[${s.label}] sampleRateHz phải là số nguyên 50–4000 (nhận ${s.sampleRateHz}).`);
        }
    }

    if (!process.env.DATABASE_URL) throw new Error('Thiếu DATABASE_URL trong .env');
    // Nếu DATABASE_URL có ?schema=xyz thì đặt thêm SEED_DB_SCHEMA=xyz (adapter không tự đọc tham số này).
    // Nếu Postgres (vd Supabase/Render) yêu cầu SSL mà kết nối lỗi chứng chỉ: đặt SEED_DB_SSL=true.
    const adapter = new PrismaPg(
        {
            connectionString: process.env.DATABASE_URL,
            ...(process.env.SEED_DB_SSL === 'true' ? { ssl: { rejectUnauthorized: false } } : {}),
        },
        process.env.SEED_DB_SCHEMA ? { schema: process.env.SEED_DB_SCHEMA } : undefined,
    );
    const prisma = new PrismaClient({ adapter });
    const results: SeedResult[] = [];
    try {
        // 1) Phòng ECG (dùng phòng có sẵn, không có thì tạo)
        let room = await prisma.diagnosticRoom.findFirst({ where: { modality: 'ecg', isActive: true } });
        if (!room) {
            room = await prisma.diagnosticRoom.create({
                data: { diagnosticRoomCode: 'ECG-ROOM', diagnosticRoomName: 'Phòng Điện tâm đồ (ECG)', modality: 'ecg', location: 'Tầng 1 - Phòng ECG', isActive: true },
            });
            console.log('Đã tạo phòng ECG:', room.diagnosticRoomId);
        }

        // 2) Dịch vụ ECG (resultKind 'waveform' = ECG theo code backend)
        let service = await prisma.serviceCatalog.findFirst({ where: { modality: 'ecg', isActive: true } });
        if (!service) {
            service = await prisma.serviceCatalog.create({
                data: {
                    serviceCode: 'ECG01',
                    serviceName: 'Điện tâm đồ (ECG)',
                    modality: 'ecg',
                    resultKind: 'waveform',
                    requiresFasting: false,
                    price: 150000,
                    turnaroundMins: 30,
                    defaultRoomId: room.diagnosticRoomId,
                    isActive: true,
                },
            });
            console.log('Đã tạo dịch vụ ECG:', service.serviceId);
        }

        // 3) Phân công KTV vào phòng ECG (receive/ghi nhận yêu cầu bước này)
        await prisma.diagnosticStaffRoomAssignment.upsert({
            where: { userId_diagnosticRoomId: { userId: CFG.labStaffUserId, diagnosticRoomId: room.diagnosticRoomId } },
            create: { userId: CFG.labStaffUserId, diagnosticRoomId: room.diagnosticRoomId, isPrimary: true },
            update: {},
        });

        // 4) Mỗi dataset: chỉ định + hạng mục + task (đã thanh toán, đã tiếp nhận) + upload + EcgRecording.
        //    Một dataset lỗi không làm dừng các dataset còn lại.
        const ctx = { room, service };
        for (const src of sources) {
            console.log(`\n[${src.label}]`);
            try {
                const prepared = src.filePath ? await prepareFile(src.filePath) : undefined;
                results.push(await seedOne(prisma, ctx, src, prepared));
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error(`  LỖI: ${msg}`);
                results.push({ label: src.label, status: 'failed', note: msg });
            }
        }

        // Đồng bộ trạng thái lượt khám như luồng thật (không bắt buộc; lỗi thì bỏ qua)
        if (results.some((r) => r.status === 'ok')) {
            try {
                await (prisma as any).encounter.updateMany({ where: { encounterId: CFG.encounterId }, data: { status: 'diagnostics_in_progress' } });
            } catch (e) {
                console.warn('Bỏ qua cập nhật trạng thái encounter:', (e as Error).message);
            }
        }
    } finally {
        await prisma.$disconnect();
    }

    console.log('\n===== TÓM TẮT =====');
    for (const r of results) {
        console.log(`${r.label.padEnd(12)} ${r.status.padEnd(8)} task=${r.taskId ?? '-'} recording=${r.recordingId ?? '-'}${r.note ? `  (${r.note})` : ''}`);
    }
    if (results.some((r) => r.status === 'failed')) process.exit(1);
}

main().catch((e) => {
    console.error('LỖI:', e instanceof Error ? e.message : e);
    process.exit(1);
});