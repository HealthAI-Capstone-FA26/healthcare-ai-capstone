import { DEPARTMENT_SEED } from '../03-department_seed';
import { DepartmentSuggestionService } from './department-suggestion.service';
import { DepartmentEmbeddingService, sanitizeForExternalCall } from './department-embedding.service';
import { findPhrase, tokenize } from './keyword-matcher.util';
import { detectEmergency } from './emergency-red-flags';
import { derivePatientContext } from './patient-context.util';

const depts = DEPARTMENT_SEED.map((d) => ({
  departmentId: 'id-' + d.departmentCode,
  departmentCode: d.departmentCode,
  departmentName: d.departmentName,
  description: d.description,
  symptomKeywords: d.symptomKeywords,
}));
const prismaStub: any = { department: { findMany: async () => depts } };
const build = (embedding?: any) => new DepartmentSuggestionService(prismaStub, embedding ?? new DepartmentEmbeddingService());
const svc = build();
const top = async (text: string, age?: number) => (await svc.suggest(text, 3, { patientAgeYears: age }))[0];

describe('matcher: các lỗi của bản cũ', () => {
  const hit = (text: string, kw: string) => findPhrase(tokenize(text), kw) !== null;
  it('"không" và "họng" KHÔNG chứa "ho"', () => {
    expect(hit('hôm nay tôi không khỏe', 'ho')).toBe(false);
    expect(hit('tôi đau họng', 'ho')).toBe(false);
    expect(hit('tôi bị ho nhiều', 'ho')).toBe(true);
  });
  it('"điều trị" KHÔNG phải "trĩ"', () => {
    expect(hit('đang điều trị tiểu đường', 'trĩ')).toBe(false);
    expect(hit('tôi bị trĩ', 'trĩ')).toBe(true);
  });
  it('gõ không dấu vẫn khớp cụm >= 2 âm tiết', () => {
    expect(hit('toi bi dau dau nhieu', 'đau đầu')).toBe(true);
    expect(hit('bi sot cao', 'sốt cao')).toBe(true);
  });
  it('không dấu KHÔNG khớp cụm 1 âm tiết có dấu (mơ hồ: sot != sốt)', () => {
    expect(hit('bi sot', 'sốt')).toBe(false);
    expect(hit('bi ho', 'ho')).toBe(true); // "ho" gõ không dấu trùng khớp chính xác
  });
  it('token có dấu khác nghĩa không bị khớp nhờ bỏ dấu ("đâu" != "đau")', () => {
    expect(hit('đâu đầu', 'đau đầu')).toBe(false);
  });
  it('phủ định', () => {
    expect(hit('tôi không đau ngực', 'đau ngực')).toBe(false);
    expect(hit('không bị sốt cao', 'sốt cao')).toBe(false);
    expect(hit('hết sốt rồi', 'sốt')).toBe(false);
    expect(hit('không chỉ đau đầu mà còn chóng mặt', 'đau đầu')).toBe(true);
  });
  it('vị trí dấu cũ/mới: khoẻ = khỏe', () => {
    expect(hit('khám sức khoẻ', 'khám sức khỏe')).toBe(true);
  });
});

describe('phân loại theo triệu chứng (keyword-only)', () => {
  const table: [string, string][] = [
    ['Tôi đau bụng, buồn nôn, tiêu chảy từ sáng', 'GI'],
    ['Bị trĩ, đau rát hậu môn', 'SUR'],
    ['Tôi đang điều trị bệnh tiểu đường', 'END'],
    ['Khó thở khi gắng sức, hay hồi hộp', 'CAR'],
    ['Tôi khó thở khi leo cầu thang', 'CAR'],
    ['Đau mắt đỏ, ngứa mắt, chảy nước mắt', 'OPH'],
    ['Đau răng nhức răng, sưng nướu', 'DEN'],
    ['Nổi mẩn đỏ ngứa khắp người', 'DER'],
    ['Đau họng, nuốt vướng, khàn tiếng', 'ENT'],
    ['Tiểu buốt, tiểu rắt, nước tiểu có máu', 'URO'],
    ['Tôi bị đau đầu, chóng mặt, mất ngủ', 'NEU'],
    ['Đau khớp gối, cứng khớp buổi sáng', 'MSK'],
    ['Bị đau thần kinh tọa, thoát vị đĩa đệm', 'SPN'],
    ['Rách dây chằng chéo khi chơi bóng đá', 'ORT'],
    ['Chậm kinh, thử thai hai vạch, muốn khám thai', 'OBG'],
    ['Vợ chồng em hiếm muộn, muốn làm thụ tinh ống nghiệm', 'IVF'],
    ['Muốn sàng lọc dị tật thai, làm NIPT', 'FMD'],
    ['Muốn tiêm vắc xin cúm', 'VAC'],
    ['Nổi hạch cổ, sờ thấy khối u', 'ONC'],
    ['Muốn khám sức khỏe tổng quát', 'GEN'],
    ['Bị bỏng nước sôi ở tay', 'ER'],
    ['Sờ thấy búi trĩ', 'SUR'],
    ['Tôi bị dị ứng hải sản', 'IMM'],
    ['Muốn giảm cân vì thừa cân', 'WGT'],
    ['Cần tập vật lý trị liệu sau mổ', 'REH'],
    ['Đau bụng dưới bên phải, nghi viêm ruột thừa', 'SUR'],
    ['Đau bụng kinh dữ dội mỗi tháng', 'OBG'],
    ['Ho khan kéo dài, khò khè', 'RESP'],
    ['Sốt cao, đau nhức người, mệt mỏi', 'IM'],
    ['Bị ho', 'RESP'],
    ['Tôi bi dau dau va chong mat', 'NEU'], // gõ không dấu
  ];
  it.each(table)('%s -> %s', async (text, code) => {
    expect((await top(text)).departmentCode).toBe(code);
  });

  it('cụm dài thắng cụm ngắn: "đau ngực khi ho" -> RESP, không phải CAR', async () => {
    expect((await top('đau ngực khi ho nhiều ngày')).departmentCode).toBe('RESP');
  });
  it('không bị lẫn "không" thành "ho"', async () => {
    const r = await svc.suggest('hôm nay tôi không khỏe lắm');
    expect(r[0].method).toBe('fallback');
    expect(r[0].departmentCode).toBe('GEN');
    expect(r[0].confidence).toBe('low');
  });
  it('phủ định: "không đau ngực, chỉ mệt" -> không gợi ý Tim mạch', async () => {
    const r = await svc.suggest('Tôi không đau ngực, chỉ mệt');
    expect(r.map((x) => x.departmentCode)).not.toContain('CAR');
  });
  it('từ khoá 1 âm tiết vẫn được trả về (bản cũ bỏ rơi vì 0.5*0.6<0.4)', async () => {
    const r = await svc.suggest('bị trĩ');
    expect(r[0].departmentCode).toBe('SUR');
    expect(r[0].method).toBe('keyword');
  });
  it('fallback là Khoa Khám bệnh, không phải Nội', async () => {
    expect((await top('xyz abc')).departmentCode).toBe('GEN');
  });
  it('limit được chặn, kết quả xếp hạng ổn định', async () => {
    expect((await svc.suggest('sốt ho đau họng đau bụng', 99)).length).toBeLessThanOrEqual(5);
  });
});

describe('an toàn: cảnh báo cấp cứu', () => {
  const emergencies = [
    'Bố tôi méo miệng, nói khó, yếu nửa người',
    'Đau ngực dữ dội, vã mồ hôi',
    'Đau ngực kèm khó thở',
    'Tôi muốn tự tử',
    'Bé sốt cao co giật',
    'Bị ngộ độc thuốc trừ sâu',
    'Chị tôi vỡ ối rồi',
    'Nôn ra máu và đi phân đen',
    'Bị tai nạn giao thông đau đầu',
    'Sốc phản vệ sau khi ăn tôm',
    'khong tho duoc, tim tai', // không dấu
    'bi ngat xiu',
  ];
  it.each(emergencies)('%s -> ER + isEmergency', async (text) => {
    const r = await svc.suggest(text);
    expect(r[0].departmentCode).toBe('ER');
    expect(r[0].isEmergency).toBe(true);
    expect(r[0].method).toBe('emergency');
    expect(r[0].advice).toContain('115');
    expect(r[0].confidence).toBe('high');
  });

  const notEmergencies = [
    'Tôi không đau ngực, chỉ hơi mệt',
    'Cần tập phục hồi chức năng sau đột quỵ',
    'Tầm soát nguy cơ đột quỵ',
    'Khám vì hay bị ngất khi đứng dậy',
    'Đau lưng sau tai nạn giao thông tháng trước',
    'Đau đầu muốn chết', // thành ngữ, không phải ý định tự tử
    'Bị ngưng thở khi ngủ, ngáy to',
    'Không co giật, chỉ sốt nhẹ',
  ];
  it.each(notEmergencies)('%s -> KHÔNG kích hoạt cấp cứu', async (text) => {
    const r = await svc.suggest(text);
    expect(r.some((x) => x.isEmergency)).toBe(false);
  });

  it('thông điệp khủng hoảng tâm thần có hướng dẫn riêng', () => {
    const d = detectEmergency(tokenize('con tôi muốn tự tử'));
    expect(d.advice).toContain('tự làm hại');
  });
  it('lớp cấp cứu độc lập với DB: DB không có khoa ER vẫn giữ cảnh báo', async () => {
    const noEr: any = { department: { findMany: async () => depts.filter((d) => d.departmentCode !== 'ER') } };
    const s = new DepartmentSuggestionService(noEr, new DepartmentEmbeddingService());
    const r = await s.suggest('méo miệng, yếu nửa người');
    expect(r[0].isEmergency).toBe(true);
  });
  it('suggestTopDepartmentId trả ER khi cấp cứu', async () => {
    expect(await svc.suggestTopDepartmentId('đau ngực dữ dội')).toBe('id-ER');
  });
});

describe('ngữ cảnh nhi khoa', () => {
  it('"con tôi bị sốt cao" -> PED (không phải Nội)', async () => {
    expect((await top('Con tôi bị sốt cao 3 ngày')).departmentCode).toBe('PED');
  });
  it('tuổi truyền vào thắng suy luận từ văn bản', async () => {
    expect((await top('sốt, ho, đau họng', 5)).departmentCode).toBe('PED');
    expect((await top('sốt, ho, đau họng', 30)).departmentCode).not.toBe('PED');
  });
  it('văn bản "con tôi 30 tuổi" là người lớn', async () => {
    expect((await top('con tôi 30 tuổi bị sốt')).departmentCode).toBe('IM');
  });
  it('"bé bị nôn trớ, quấy khóc" -> Nhi có từ khoá thật (không chỉ điểm ngữ cảnh)', async () => {
    const r = (await svc.suggest('Bé bị nôn trớ hay quấy khóc, chậm tăng cân'))[0];
    expect(r.departmentCode).toBe('PED');
    expect(r.matchedKeywords.length).toBeGreaterThanOrEqual(2);
    expect(r.confidence).toBe('high');
  });
  it('bé 8 tuổi ho -> Nhi', async () => {
    expect((await top('bé 8 tuổi bị ho nhiều')).departmentCode).toBe('PED');
  });
  it('chuyên khoa hẹp không bị ép sang Nhi (mắt)', async () => {
    expect((await top('bé bị đau mắt đỏ')).departmentCode).toBe('OPH');
  });
  it('trẻ không rõ triệu chứng -> Nhi (context), không phải GEN', async () => {
    const r = await svc.suggest('cần khám gấp gấp', 3, { patientAgeYears: 6 });
    expect(r[0].departmentCode).toBe('PED');
    expect(r[0].method).toBe('context');
    expect(r[0].confidence).toBe('low');
  });
  it('sơ sinh -> Trung tâm Sơ sinh đứng đầu', async () => {
    expect((await top('bé 10 ngày tuổi bú kém, vàng da')).departmentCode).toBe('NEO');
    expect((await top('trẻ sơ sinh vàng da', 0.02)).departmentCode).toBe('NEO');
  });
  it('"trẻ hóa da" không phải nhi khoa', () => {
    expect(derivePatientContext(tokenize('muốn trẻ hóa da mặt')).isPediatric).toBe(false);
  });
});

describe('semantic (embedding giả lập)', () => {
  // Vector one-hot theo khoa: câu "bụng cồn cào" -> gần GI.
  const dim = DEPARTMENT_SEED.length + 1;
  const vecFor = (idx: number, strength = 1) => Array.from({ length: dim }, (_, i) => (i === idx ? strength : i === dim - 1 ? Math.sqrt(1 - strength ** 2) : 0));
  const fakeEmbedding = (queryIdx: number, sim = 1) => {
    const phraseMap = new Map<string, number[]>();
    for (const [i, d] of DEPARTMENT_SEED.entries()) for (const p of [d.departmentName, ...d.symptomKeywords]) phraseMap.set(p, vecFor(i));
    return {
      isEnabled: () => true,
      embedQuery: async () => vecFor(queryIdx, sim),
      ensurePhraseVectors: async () => true,
      getPhraseVector: (p: string) => phraseMap.get(p),
    } as any;
  };
  const idx = (code: string) => DEPARTMENT_SEED.findIndex((d) => d.departmentCode === code);

  it('semantic-only giờ THẮNG được (bản cũ: nhánh chết)', async () => {
    const s = build(fakeEmbedding(idx('GI'), 0.95));
    const r = await s.suggest('cồn cào trong bụng lâu rồi');
    expect(r[0].departmentCode).toBe('GI');
    expect(r[0].method).toBe('semantic');
    expect(r[0].confidence).not.toBe('high');
  });
  it('semantic dưới ngưỡng bị bỏ qua -> fallback', async () => {
    const s = build(fakeEmbedding(idx('GI'), 0.3));
    expect((await s.suggest('cồn cào trong bụng lâu rồi'))[0].method).toBe('fallback');
  });
  it('hybrid chỉ CỘNG điểm, không làm giảm điểm keyword', async () => {
    const kwOnly = (await svc.suggest('bị ho'))[0];
    const hybrid = (await build(fakeEmbedding(idx('RESP'), 0.9)).suggest('bị ho'))[0];
    expect(hybrid.method).toBe('hybrid');
    expect(hybrid.score).toBeGreaterThan(kwOnly.score);
  });
  it('keyword quyết đoán thì KHÔNG gọi embedding (tiết kiệm tiền + tránh gửi PHI ra ngoài)', async () => {
    const fe = fakeEmbedding(0);
    fe.embedQuery = vi.fn(async () => null);
    await build(fe).suggest('đau đầu chóng mặt');
    expect(fe.embedQuery).not.toHaveBeenCalled();
  });
  it('cấp cứu thì KHÔNG gọi embedding', async () => {
    const fe = fakeEmbedding(0);
    fe.embedQuery = vi.fn(async () => null);
    await build(fe).suggest('méo miệng yếu nửa người');
    expect(fe.embedQuery).not.toHaveBeenCalled();
  });
  it('provider lỗi -> tự động keyword-only, không throw', async () => {
    const fe = fakeEmbedding(0);
    fe.embedQuery = async () => null;
    const r = await build(fe).suggest('bị ho');
    expect(r[0].departmentCode).toBe('RESP');
    expect(r[0].method).toBe('keyword');
  });
});

describe('embedding service', () => {
  it('che SĐT/email/CCCD trước khi gửi bên thứ 3', () => {
    const out = sanitizeForExternalCall('tôi Lan 0912 345 678 mail a.b@x.vn cccd 079123456789 đau đầu');
    expect(out).not.toMatch(/0912|@|079123/);
    expect(out).toContain('đau đầu');
  });
  it('không cấu hình provider -> tắt', () => {
    expect(new DepartmentEmbeddingService().isEnabled()).toBe(false);
  });
  it('chống cache stampede + circuit breaker', async () => {
    process.env.DEPARTMENT_SUGGESTION_EMBEDDING_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'k';
    const calls: string[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: any) => {
      calls.push(String(url) + '|' + JSON.stringify(init.headers));
      await new Promise((r) => setTimeout(r, 20));
      const n = JSON.parse(init.body).requests.length;
      return { ok: true, json: async () => ({ embeddings: Array.from({ length: n }, () => ({ values: [1, 0] })) }) } as any;
    }) as any;
    try {
      const e = new DepartmentEmbeddingService();
      const [a, b] = await Promise.all([e.ensurePhraseVectors(['x', 'y']), e.ensurePhraseVectors(['y', 'x'])]);
      expect(a && b).toBe(true);
      expect(calls.length).toBe(1);
      expect(calls[0]).not.toContain('key=');
      expect(calls[0]).toContain('gemini-embedding-001');
      expect(calls[0]).toContain('x-goog-api-key');
      // lỗi -> mở circuit, các lần sau không gọi mạng
      globalThis.fetch = (async () => ({ ok: false, status: 500, text: async () => 'boom' })) as any;
      expect(await e.ensurePhraseVectors(['z'])).toBe(false);
      const spy = vi.fn();
      globalThis.fetch = spy as any;
      expect(await e.ensurePhraseVectors(['w'])).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = orig;
      delete process.env.DEPARTMENT_SUGGESTION_EMBEDDING_PROVIDER;
      delete process.env.GEMINI_API_KEY;
    }
  });
});
