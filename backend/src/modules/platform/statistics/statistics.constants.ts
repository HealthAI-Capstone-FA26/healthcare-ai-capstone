/** Khớp EncounterStageEvent.stage / StageStatistic.stage (xem schema.prisma). */
export const STAGES = [
  'reception_queue',
  'reception_checkin',
  'triage_wait',
  'vitals',
  'doctor_wait',
  'consultation',
  'payment',
  'diagnostic_wait',
  'diagnostic_execution',
  'result_review',
] as const;
export type StageCode = (typeof STAGES)[number];

/**
 * Loại chặng quyết định cách tính:
 *  - wait    : chỉ có thời gian CHỜ (enteredAt -> startedAt).
 *  - process : chỉ có thời gian XỬ LÝ (startedAt -> completedAt).
 *  - both    : cả hai (thanh toán: chờ tới khi bắt đầu trả, rồi thời gian trả).
 */
export const STAGE_KIND: Record<StageCode, 'wait' | 'process' | 'both'> = {
  reception_queue: 'wait',
  reception_checkin: 'process',
  triage_wait: 'wait',
  vitals: 'process',
  doctor_wait: 'wait',
  consultation: 'process',
  payment: 'both',
  diagnostic_wait: 'wait',
  diagnostic_execution: 'process',
  result_review: 'wait',
};

/**
 * Ước lượng thời gian chờ: chờ ở chặng A ≈ (số người phía trước / số điểm phục vụ) × thời gian xử lý TB của chặng phục vụ tương ứng.
 */
export const WAIT_STAGE_TO_SERVICE_STAGE: Partial<Record<StageCode, StageCode>> = {
  reception_queue: 'reception_checkin',
  triage_wait: 'vitals',
  doctor_wait: 'consultation',
  diagnostic_wait: 'diagnostic_execution',
};

/** referenceType của các EncounterStageEvent do collector sinh ra (dùng để xoá-rồi-ghi lại idempotent). */
export const DERIVED_REFERENCE_TYPES = [
  'queue_ticket',
  'triage_queue',
  'doctor_queue',
  'diagnostic_task',
  'invoice',
  'diagnostic_order',
] as const;

/** Giờ bệnh viện cố định UTC+7 (Việt Nam không có DST). */
export const HOSPITAL_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;
export const MAX_RANGE_DAYS = 92;
