// Đúng comment field `status` của model DoctorQueueEntry (prisma/schema.prisma): copy pattern
// TriageQueueStatus (triage-queue.constants.ts).
export enum DoctorQueueStatus {
  WAITING = 'waiting',
  CALLED = 'called',
  IN_PROGRESS = 'in_progress',
  DONE = 'done',
  SKIPPED = 'skipped',
  CANCELLED = 'cancelled',
}

// Các trạng thái được tính là "đang giữ tải" của bác sĩ khi cân bằng hàng đợi — done/skipped/cancelled
// không tính vì bác sĩ đã rảnh tay với ca đó (giống ACTIVE_TRIAGE_STATUSES ở TriageQueueService).
export const ACTIVE_DOCTOR_QUEUE_STATUSES: string[] = [
  DoctorQueueStatus.WAITING,
  DoctorQueueStatus.CALLED,
  DoctorQueueStatus.IN_PROGRESS,
];

// Key advisory lock chung cho MỌI nơi sinh queueOrder của hàng đợi bác sĩ trong 1 khoa/ngày.
// Module 6 (gọi số/route bác sĩ) khi được viết PHẢI dùng đúng hàm này để không đụng unique
// [departmentId, doctorQueueDate, queueOrder].
export function doctorQueueLockKey(departmentId: string, doctorQueueDate: Date): string {
  return `doctor-queue:${departmentId}:${doctorQueueDate.toISOString().slice(0, 10)}`;
}
