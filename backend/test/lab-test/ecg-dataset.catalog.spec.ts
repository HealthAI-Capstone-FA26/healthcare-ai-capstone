import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ECG_DATASET_NAMES, EcgDatasetCatalog, normalizeDatasetName } from '../../src/modules/lab-test/ecg-stream/ecg-dataset.catalog';

describe('normalizeDatasetName', () => {
    it('chuẩn hoá chữ hoa/thường, chỉ nhận ECG_A..ECG_F', () => {
        expect(normalizeDatasetName('ecg_a')).toBe('ECG_A');
        expect(normalizeDatasetName(' ECG_F ')).toBe('ECG_F');
        for (const bad of ['ECG_G', 'ECG_', '../ECG_A', 'ECG_A/../../etc/passwd', '', 5, null, undefined, {}]) expect(normalizeDatasetName(bad)).toBeNull();
        expect(ECG_DATASET_NAMES).toHaveLength(6);
    });
});

describe('EcgDatasetCatalog', () => {
    let dir: string;
    const prev = { dir: process.env.ECG_DATASET_DIR, fs: process.env.ECG_DATASET_SAMPLE_RATE_HZ };
    const catalog = new EcgDatasetCatalog();

    beforeEach(async () => {
        dir = await fs.mkdtemp(join(tmpdir(), 'ecg-ds-'));
        process.env.ECG_DATASET_DIR = dir;
        delete process.env.ECG_DATASET_SAMPLE_RATE_HZ;
    });
    afterEach(async () => {
        await fs.rm(dir, { recursive: true, force: true });
    });
    afterAll(() => {
        for (const [k, v] of [['ECG_DATASET_DIR', prev.dir], ['ECG_DATASET_SAMPLE_RATE_HZ', prev.fs]] as const) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    });

    it('list: đánh dấu dataset nào đã cài; sampleRate mặc định 100Hz, null nếu chưa cài', async () => {
        await fs.mkdir(join(dir, 'ECG_A'));
        await fs.writeFile(join(dir, 'ECG_A', 'ECG_test.npy'), 'x');
        await fs.writeFile(join(dir, 'ECG_C.csv'), 'x');
        const list = await catalog.list();
        expect(list.map((d) => d.name)).toEqual([...ECG_DATASET_NAMES]);
        expect(list.find((d) => d.name === 'ECG_A')).toEqual({ name: 'ECG_A', available: true, sampleRateHz: 100 });
        expect(list.find((d) => d.name === 'ECG_C')).toEqual({ name: 'ECG_C', available: true, sampleRateHz: 100 });
        expect(list.find((d) => d.name === 'ECG_B')).toEqual({ name: 'ECG_B', available: false, sampleRateHz: null });
    });

    it('load: ưu tiên ECG_A/ECG_test.npy, trả buffer + format + fileName + version', async () => {
        await fs.mkdir(join(dir, 'ECG_A'));
        await fs.writeFile(join(dir, 'ECG_A', 'ECG_test.npy'), Buffer.from('npydata'));
        await fs.writeFile(join(dir, 'ECG_A.csv'), 'csvdata');
        const d = await catalog.load('ECG_A');
        expect(d).toMatchObject({ name: 'ECG_A', format: 'npy', fileName: 'ECG_A.npy', sampleRateHz: 100 });
        expect(d.buffer.toString()).toBe('npydata');
        expect(d.version).toMatch(/^\d+-7$/);
    });

    it('load: bố cục phẳng ECG_B.csv', async () => {
        await fs.writeFile(join(dir, 'ECG_B.csv'), 'a,b\n1,2\n');
        expect(await catalog.load('ECG_B')).toMatchObject({ format: 'csv', fileName: 'ECG_B.csv' });
    });

    it('sampleRate: env mặc định, meta.json ghi đè từng dataset, giá trị sai bị bỏ qua', async () => {
        process.env.ECG_DATASET_SAMPLE_RATE_HZ = '250';
        await fs.mkdir(join(dir, 'ECG_A'));
        await fs.writeFile(join(dir, 'ECG_A', 'ECG_test.npy'), 'x');
        await fs.writeFile(join(dir, 'ECG_A', 'meta.json'), JSON.stringify({ sampleRateHz: 360 }));
        await fs.writeFile(join(dir, 'ECG_B.npy'), 'x');
        await fs.mkdir(join(dir, 'ECG_D'));
        await fs.writeFile(join(dir, 'ECG_D', 'ECG_test.npy'), 'x');
        await fs.writeFile(join(dir, 'ECG_D', 'meta.json'), '{"sampleRateHz": -5}');
        expect((await catalog.load('ECG_A')).sampleRateHz).toBe(360);
        expect((await catalog.load('ECG_B')).sampleRateHz).toBe(250);
        expect((await catalog.load('ECG_D')).sampleRateHz).toBe(250);
    });

    it('load: chưa cài -> DATASET_NOT_AVAILABLE, thông điệp không lộ đường dẫn', async () => {
        const p = catalog.load('ECG_E');
        await expect(p).rejects.toMatchObject({ code: 'DATASET_NOT_AVAILABLE' });
        await expect(p).rejects.not.toThrow(dir);
    });
});
