import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { ACTOR_ROLE, roleCodesOfActorRole } from '../../../src/common/constants/actor-role.constant';
import {
  ECG_ANOMALY_PROVIDER,
  EcgAiError,
  EcgAnalyzeInput,
  EcgAnalyzeResult,
  EcgAnomalyProvider,
} from '../../../src/modules/lab-test/ecg-ai-analysis/ecg-anomaly-provider.port';
import { getRequiredEcgLeads } from '../../../src/modules/lab-test/ecg-recording/ecg-upload.config';
import { client, expectSuccess, signToken } from './app';
import { FlowContext, runRegistrationFlow } from './flow';

export { ECG_ANOMALY_PROVIDER };

/**
 * WF-03 e2e: dịch vụ AI ECG (Python) không có trong CI nên thay đúng cổng ECG_ANOMALY_PROVIDER bằng test double.
 * Mọi thứ còn lại (Postgres, Redis, MinIO, event listener, cron, guard, validation) là THẬT.
 *   mode 'anomaly' -> AI trả 1 đoạn bất thường mức high (DS-05)
 *   mode 'fail'    -> AI lỗi/timeout (DS-06: AI failure never blocks outpatient process)
 */
export class ControllableEcgProvider implements EcgAnomalyProvider {
  mode: 'anomaly' | 'fail' = 'anomaly';
  calls: EcgAnalyzeInput[] = [];

  isConfigured(): boolean {
    return true;
  }

  async analyze(input: EcgAnalyzeInput): Promise<EcgAnalyzeResult> {
    this.calls.push(input);
    if (this.mode === 'fail') {
      throw new EcgAiError('AI_UNAVAILABLE', 'ECG AI service unavailable (simulated timeout)');
    }
    return {
      overallResult: 'abnormal',
      maxAnomalyScore: 0.93,
      thresholdUsed: 0.5,
      windowMs: 2000,
      strideMs: 1000,
      signalQuality: 0.97,
      summaryMetrics: { hrMean: 112, hrMin: 98, hrMax: 131, abnormalDurationMs: 1800 },
      inferenceLatencyMs: 42,
      anomalies: [
        {
          anomalyType: 'afib',
          score: 0.93,
          severity: 'high',
          startOffsetMs: 1000,
          endOffsetMs: 2800,
          affectedLeads: ['II'],
          heartRateBpm: 131,
          details: null,
        },
      ],
      scoreSeries: [
        { tMs: 0, score: 0.1 },
        { tMs: 1000, score: 0.93 },
        { tMs: 2000, score: 0.8 },
      ],
    };
  }
}

/** Poll tới khi `probe` trả giá trị khác undefined/null/false (event listener chạy nền nên không có kết quả tức thì). */
export async function waitFor<T>(
  probe: () => Promise<T | undefined | null | false>,
  label: string,
  { timeoutMs = 20_000, intervalMs = 250 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout ${timeoutMs}ms khi chờ: ${label}${last ? ` (lỗi cuối: ${(last as Error).message})` : ''}`);
}

export interface Wf03Actors {
  labStaff: { userId: string; email: string; token: string };
  admin: { userId: string; email: string; token: string };
}

/** Dựng KTV (LAB_STAFF) + admin. Email bắt đầu bằng `e2e-` nên seedFixtures của spec kế tiếp sẽ tự vô hiệu hoá. */
export async function seedLabActors(app: INestApplication): Promise<Wf03Actors> {
  const prisma = app.get(PrismaService);
  const runId = randomBytes(4).toString('hex');

  const create = async (actorRole: string, label: string) => {
    const role = await prisma.role.findFirst({ where: { roleCode: { in: roleCodesOfActorRole(actorRole) } } });
    if (!role) throw new Error(`Chưa có role ${actorRole} trong DB — cần chạy "npx prisma db seed" trước khi chạy e2e.`);
    const user = await prisma.user.create({
      data: {
        email: `e2e-${label}-${runId}@example.test`,
        passwordHash: 'e2e-not-used',
        status: 'active',
        emailVerified: true,
        roleId: role.roleId,
      },
    });
    return { userId: user.userId, email: user.email, token: signToken(app, user) };
  };

  return { labStaff: await create(ACTOR_ROLE.LAB_STAFF, 'labstaff'), admin: await create(ACTOR_ROLE.ADMIN, 'admin') };
}

/** Điều kiện của DS-05/DS-06: cần 1 model AI ECG 'active' (seed có sẵn). Không có thì tạo tối thiểu để pipeline chạy. */
export async function ensureActiveEcgModel(app: INestApplication): Promise<void> {
  const prisma = app.get(PrismaService);
  const existing = await prisma.aiModelVersion.findFirst({ where: { taskType: 'ecg_anomaly_detection', status: 'active' } });
  if (existing) return;
  try {
    await prisma.aiModelVersion.create({
      data: {
        taskType: 'ecg_anomaly_detection',
        modelName: 'e2e-ecg-anomaly',
        version: `e2e-${randomBytes(3).toString('hex')}`,
        status: 'active',
        deployedAt: new Date(),
      } as any,
    });
  } catch (err) {
    throw new Error(
      `Không có AiModelVersion 'active' cho ecg_anomaly_detection và không tự tạo được (${(err as Error).message}). Hãy chạy "npx prisma db seed".`,
    );
  }
}

export interface OrderedEncounter {
  encounterId: string;
  patientId: string;
  patientDob: string;
  doctor: { doctorId: string; userId: string; email: string; token: string };
  orderId: string;
  invoiceId: string;
  /** modality -> task */
  tasks: Record<string, { taskId: string; diagnosticRoomId: string; orderItemId: string }>;
}

type Modality = 'blood_test' | 'ecg' | 'xray' | 'echo';

/**
 * Đưa 1 encounter từ đầu workflow tới "đã chỉ định CLS + đã lập hoá đơn diagnostics, CHƯA thanh toán"
 * (task 'payment_pending'), bằng chính các API thật của WF-01/WF-02:
 *   đăng ký -> y tá đo sinh hiệu -> điều phối bác sĩ -> bác sĩ chẩn đoán ban đầu I20.9 -> chỉ định CLS -> lễ tân lập hoá đơn.
 * Bác sĩ được điều phối có thể KHÔNG phải bác sĩ fixture (DB dùng chung) nên token bác sĩ lấy theo doctorId thực sự được chọn.
 */
export async function orderDiagnostics(
  ctx: FlowContext,
  labActors: Wf03Actors,
  modalities: Modality[],
): Promise<OrderedEncounter> {
  const { app, fixtures } = ctx;
  const prisma = app.get(PrismaService);

  // --- WF-01: tiếp đón -> triage -> sinh hiệu -> điều phối bác sĩ
  const reg = await runRegistrationFlow(ctx);
  const nurse = client(app, fixtures.nurse.token);
  expectSuccess(await nurse.post('/triage-queue/dequeue'), 'dequeue triage');
  expectSuccess(await nurse.patch(`/triage-queue/${reg.triageQueueEntryId}/start`), 'start triage');
  expectSuccess(
    await nurse.post('/vital-sessions', {
      encounterId: reg.encounterId,
      patientId: reg.patientId,
      recordedByUserId: fixtures.nurse.userId,
      queueEntryId: reg.triageQueueEntryId,
      pulse: 78,
      systolicBp: 120,
      diastolicBp: 80,
      temperature: 36.8,
      respiratoryRate: 16,
      spo2: 98,
      height: 170,
      weight: 65,
    }),
    'record vitals',
  );
  const routed = expectSuccess(await nurse.post(`/encounters/${reg.encounterId}/route-doctor`), 'route doctor');
  const doctorRow = await prisma.doctor.findUniqueOrThrow({
    where: { doctorId: routed.queueEntry.doctorId },
    include: { user: true },
  });
  const doctor = {
    doctorId: doctorRow.doctorId,
    userId: doctorRow.userId,
    email: doctorRow.user.email,
    token: signToken(app, { userId: doctorRow.userId, email: doctorRow.user.email }),
  };

  // --- WF-02: chẩn đoán ban đầu (tự bắt đầu khám: waiting_for_doctor -> in_progress) + chỉ định CLS
  const http = client(app, doctor.token);
  const diagnosis = expectSuccess(
    await http.post(`/doctor-examination/encounters/${reg.encounterId}/diagnoses`, { icd10Code: 'I20.9' }),
    'initial diagnosis',
  );

  const items: { serviceId: string }[] = [];
  for (const modality of modalities) {
    const services = expectSuccess(await http.get(`/doctor-examination/services?modality=${modality}`), `services ${modality}`);
    const list: any[] = Array.isArray(services) ? services : (services.items ?? services.data ?? []);
    if (list.length === 0) throw new Error(`Không có dịch vụ '${modality}' đang hoạt động — cần chạy "npx prisma db seed".`);
    // Khớp seed 06-service-catalog: BLOODFULL (full_blood_panel), RESTECG12 (resting_ecg), CXRPA (chest_xray).
    const SEEDED_CODE: Partial<Record<Modality, string>> = { blood_test: 'BLOODFULL', ecg: 'RESTECG12', xray: 'CXRPA' };
    const preferred = list.find((s) => s.serviceCode === SEEDED_CODE[modality]);
    if (!preferred) {
      throw new Error(`Không thấy dịch vụ seed '${SEEDED_CODE[modality]}' (modality ${modality}) — kiểm tra 06-service-catalog.seed.ts đã chạy.`);
    }
    items.push({ serviceId: preferred.serviceId });
  }

  const order = expectSuccess(
    await http.post(`/doctor-examination/encounters/${reg.encounterId}/test-orders`, {
      diagnosisId: diagnosis.diagnosisId,
      clinicalIndication: 'E2E WF-03',
      items,
    }),
    'create test order',
  );

  // --- Lễ tân lập hoá đơn diagnostics (chưa thu tiền)
  const invoice = expectSuccess(
    await client(app, fixtures.receptionist.token).post('/invoices/generate', { encounterId: reg.encounterId }),
    'generate diagnostics invoice',
  );

  // --- Gom task theo modality + phân công KTV vào đúng phòng (DiagnosticStaffRoomAssignment)
  const dbTasks = await prisma.diagnosticTask.findMany({
    where: { orderItem: { orderId: order.orderId } },
    include: { orderItem: { include: { service: { select: { modality: true } } } } },
  });
  const tasks: OrderedEncounter['tasks'] = {};
  for (const t of dbTasks) {
    tasks[t.orderItem.service.modality] = {
      taskId: t.taskId,
      diagnosticRoomId: t.diagnosticRoomId,
      orderItemId: t.orderItemId,
    };
  }
  const admin = client(app, labActors.admin.token);
  for (const roomId of new Set(Object.values(tasks).map((t) => t.diagnosticRoomId))) {
    expectSuccess(await admin.post(`/lab-rooms/${roomId}/staff`, { userId: labActors.labStaff.userId }), 'assign lab staff to room');
  }

  return {
    encounterId: reg.encounterId,
    patientId: reg.patientId,
    patientDob: reg.patientPayload.dateOfBirth,
    doctor,
    orderId: order.orderId,
    invoiceId: invoice.invoiceId,
    tasks,
  };
}

/** Thu tiền mặt đủ hoá đơn diagnostics -> task payment_pending => ready (paymentVerified = true). */
export async function payDiagnosticsInvoice(ctx: FlowContext, ordered: OrderedEncounter): Promise<void> {
  const prisma = ctx.app.get(PrismaService);
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { invoiceId: ordered.invoiceId } });
  const http = client(ctx.app, ctx.fixtures.receptionist.token);
  const payment = expectSuccess(
    await http.post('/payments/cash', { invoiceId: ordered.invoiceId, amount: Number(invoice.totalAmount) }),
    'create cash payment (diagnostics)',
  );
  expectSuccess(await http.post(`/payments/cash/${payment.paymentId}/confirm`, {}), 'confirm cash payment (diagnostics)');

  await waitFor(async () => {
    const tasks = await prisma.diagnosticTask.findMany({ where: { orderItem: { orderId: ordered.orderId } } });
    return tasks.length > 0 && tasks.every((t) => t.status === 'ready' && t.paymentVerified) && tasks;
  }, 'tất cả task diagnostics chuyển ready + paymentVerified sau khi thanh toán');
}

/** Tín hiệu ECG giả dạng CSV (mỗi lead 1 cột). Seed ngẫu nhiên để checksum khác nhau giữa các lần upload. */
export function buildEcgCsv(seconds = 5, sampleRateHz = 500): { buffer: Buffer; numLeads: number; leadNames: string } {
  const numLeads = getRequiredEcgLeads() || 12;
  const standard = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];
  const leadNames = standard.slice(0, numLeads);
  const phase = Math.random() * Math.PI;
  const rows: string[] = [leadNames.join(',')];
  for (let i = 0; i < seconds * sampleRateHz; i++) {
    const t = i / sampleRateHz;
    rows.push(
      leadNames.map((_, k) => (Math.sin(2 * Math.PI * 1.2 * t + phase + k * 0.1) + (i % 97 === 0 ? 0.5 : 0)).toFixed(4)).join(','),
    );
  }
  return { buffer: Buffer.from(rows.join('\n') + '\n', 'utf8'), numLeads, leadNames: leadNames.join(',') };
}

/** PNG 1x1 hợp lệ (đủ chữ ký 8 byte + >16 byte) để qua assertFileSignature của upload X-quang. */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface ThresholdRow {
  isActive?: boolean;
  gender?: string | null;
  ageMin?: number | null;
  ageMax?: number | null;
  effectiveFrom?: string;
  rangeMin?: string | number | null;
  rangeMax?: string | number | null;
  riskLevel: string;
}

function midpoint(row: ThresholdRow): number {
  const min = row.rangeMin === null || row.rangeMin === undefined ? null : Number(row.rangeMin);
  const max = row.rangeMax === null || row.rangeMax === undefined ? null : Number(row.rangeMax);
  const v = min !== null && max !== null ? (min + max) / 2 : min !== null ? min + 1 : max !== null ? max - 1 : 1;
  return Math.round(v * 100) / 100;
}

/**
 * Dựng bộ chỉ số cho TOÀN BỘ tham số active của dịch vụ máu (đủ Full panel để doctor có thể chốt 'final').
 * Giá trị lấy từ chính bảng ngưỡng seed theo tuổi/giới của bệnh nhân (cùng luật chọn dòng của ResultThresholdResolver):
 * mặc định 'normal'; tham số có mã khớp `critical` (vd. HGB) lấy giá trị trong dòng 'critical'.
 */
export function buildBloodValues(
  taskDetail: any,
  patient: { age: number; gender: string },
  critical: { parameterCode: RegExp },
): { values: any[]; criticalParameterId: string } {
  const params: any[] = (taskDetail.orderItem.service.resultParameters ?? []).filter((p: any) => p.isActive !== false);
  let criticalParameterId = '';
  const values = params.map((p) => {
    if (p.dataType === 'boolean') return { parameterId: p.parameterId, valueBoolean: false };
    if (p.dataType === 'enum') {
      const allowed: any[] = Array.isArray(p.allowedValues) ? p.allowedValues : [];
      const first = allowed[0];
      return { parameterId: p.parameterId, valueText: typeof first === 'string' ? first : String(first?.value ?? 'normal') };
    }
    if (p.dataType !== 'numeric') return { parameterId: p.parameterId, valueText: 'normal' };

    const all: ThresholdRow[] = (p.thresholds ?? []).filter((r: ThresholdRow) => r.isActive !== false);
    const fitsAge = (r: ThresholdRow) => (r.ageMin == null || r.ageMin <= patient.age) && (r.ageMax == null || r.ageMax >= patient.age);
    const candidates = all.filter((r) => fitsAge(r) && (r.gender == null || r.gender === patient.gender));
    const gendered = candidates.filter((r) => r.gender === patient.gender);
    const pool = gendered.length ? gendered : candidates.filter((r) => !r.gender).length ? candidates.filter((r) => !r.gender) : candidates;
    const latest = pool.map((r) => r.effectiveFrom ?? '').sort().pop();
    const rows = pool.filter((r) => (r.effectiveFrom ?? '') === latest);

    const wantCritical = critical.parameterCode.test(p.parameterCode);
    const row = wantCritical
      ? rows.find((r) => r.riskLevel === 'critical')
      : rows.find((r) => r.riskLevel === 'normal');
    if (wantCritical) criticalParameterId = p.parameterId;
    if (wantCritical && !row) {
      throw new Error(`Tham số '${p.parameterCode}' không có ngưỡng 'critical' áp dụng cho bệnh nhân ${patient.gender}/${patient.age} tuổi — kiểm tra seed ngưỡng HGB.`);
    }
    return { parameterId: p.parameterId, valueNumeric: row ? midpoint(row) : 1 };
  });
  if (!criticalParameterId) throw new Error(`Dịch vụ máu không có tham số khớp ${critical.parameterCode} (HGB).`);
  return { values, criticalParameterId };
}

export function ageAt(dateOfBirth: string, at = new Date()): number {
  const dob = new Date(dateOfBirth);
  let age = at.getFullYear() - dob.getFullYear();
  const m = at.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < dob.getDate())) age--;
  return age;
}
