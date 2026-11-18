/** Tiền tố global của app (main.ts: app.setGlobalPrefix('api/v1')). */
export const API_PREFIX = '/api/v1';

/**
 * Chỉ GHI LOG các request ĐỌC (GET) tới tài nguyên chứa dữ liệu bệnh nhân (NĐ 13/2023 — truy vết truy cập).
 * Danh mục dùng chung (icd10-codes, lab-rooms, vital-items, examination-fees, doctors, doctor-schedules,
 * consent-policies, pki, notifications...) không chứa PHI nên bỏ qua để log không phình vô ích.
 * Mọi request GHI (POST/PUT/PATCH/DELETE) đều được log bất kể tài nguyên (trừ SKIP_WRITE_PREFIXES).
 */
export const AUDITED_READ_RESOURCES: ReadonlySet<string> = new Set([
  'allergies',
  'appointments',
  'audit-logs',
  'consents',
  'doctor-examination',
  'ecg-analyses',
  'ecg-anomaly-events',
  'ecg-recordings',
  'encounters',
  'invoices',
  'lab-attachments',
  'lab-results',
  'lab-tasks',
  'medical-history',
  'patients',
  'payments',
  'post-test-consultation',
  'prescriptions',
  'queue-tickets',
  'result-alerts',
  'triage-queue',
  'users',
  'vital-sessions',
]);

/** Đường dẫn con của resource đọc được loại khỏi audit (catalog dùng chung). */
export const SKIP_READ_PATH_PREFIXES: readonly string[] = ['/prescriptions/drug-catalog'];

/** Không log request ghi tới các đường dẫn này (tự phát sinh, nhiễu, hoặc tự tham chiếu). */
export const SKIP_WRITE_PREFIXES: readonly string[] = ['/notifications'];

/** Tên field KHÔNG bao giờ được đưa vào audit (kể cả tên field) vì bản thân tên đã nhạy cảm/ít giá trị. */
export const SENSITIVE_FIELD_PATTERN = /pass(word)?|secret|token|otp|pin|private|signature|authorization/i;

export const AUDIT_ACTION = {
  READ: 'read',
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  EXPORT: 'export',
  PRINT: 'print',
  SIGN: 'sign',
  LOGIN: 'login',
  LOGIN_FAILED: 'login_failed',
} as const;
export type AuditActionCode = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];

export const AUDIT_OUTCOME = { SUCCESS: 'success', DENIED: 'denied', ERROR: 'error' } as const;
export type AuditOutcomeCode = (typeof AUDIT_OUTCOME)[keyof typeof AUDIT_OUTCOME];
