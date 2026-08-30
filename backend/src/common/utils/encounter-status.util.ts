// State machine cho Encounter (Module 3 — Tiếp đón & Đăng ký khám), viết theo đúng pattern
// appointment-status.util.ts: đặt tại 1 nơi duy nhất để mọi service (Encounter, DoctorQueueEntry)
// dùng chung, tránh mỗi chỗ tự viết 1 bản transition khác nhau.
//
//   arrived -> registered -> waiting_for_doctor -> in_progress -> finished
//   arrived/registered/waiting_for_doctor -> cancelled

export enum EncounterStatus {
  ARRIVED = 'arrived',
  REGISTERED = 'registered',
  WAITING_FOR_DOCTOR = 'waiting_for_doctor',
  IN_PROGRESS = 'in_progress',
  FINISHED = 'finished',
  CANCELLED = 'cancelled',
}

export const ENCOUNTER_STATUS_TRANSITIONS: Record<EncounterStatus, EncounterStatus[]> = {
  [EncounterStatus.ARRIVED]: [EncounterStatus.REGISTERED, EncounterStatus.CANCELLED],
  [EncounterStatus.REGISTERED]: [EncounterStatus.WAITING_FOR_DOCTOR, EncounterStatus.CANCELLED],
  [EncounterStatus.WAITING_FOR_DOCTOR]: [EncounterStatus.IN_PROGRESS, EncounterStatus.CANCELLED],
  [EncounterStatus.IN_PROGRESS]: [EncounterStatus.FINISHED],
  [EncounterStatus.FINISHED]: [],
  [EncounterStatus.CANCELLED]: [],
};

export function isValidEncounterTransition(current: string, next: string): boolean {
  const allowedNext = ENCOUNTER_STATUS_TRANSITIONS[current as EncounterStatus];
  return Boolean(allowedNext?.includes(next as EncounterStatus));
}