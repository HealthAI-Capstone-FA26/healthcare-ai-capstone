// State machine cho Encounter — đặt tại 1 nơi duy nhất để mọi service (Encounter, DoctorQueueEntry,
// pre-doctor-examination, lab-test, post-test-consultation) dùng chung.
//
//   arrived -> registered -> waiting_for_doctor -> in_progress
//     -> awaiting_diagnostics -> diagnostics_in_progress -> awaiting_review -> finished
//   arrived / registered / waiting_for_doctor -> cancelled
//
// Quyền chuyển trạng thái (xem REFACTOR_PLAN mục 4):
//   - SE02 pre-doctor-examination : waiting_for_doctor -> in_progress ;
//                                   in_progress | awaiting_review -> awaiting_diagnostics (khi tạo chỉ định)
//   - SE04 lab-test               : -> diagnostics_in_progress, -> awaiting_review, -> in_progress (huỷ hết chỉ định)
//   - SE06 (kê đơn + tái khám)    : awaiting_review -> finished
//
// Lưu ý: transition in_progress -> finished được GIỮ LẠI để không làm vỡ luồng SE01 hiện có.

export enum EncounterStatus {
  ARRIVED = 'arrived',
  REGISTERED = 'registered',
  WAITING_FOR_DOCTOR = 'waiting_for_doctor',
  IN_PROGRESS = 'in_progress',
  AWAITING_DIAGNOSTICS = 'awaiting_diagnostics',
  DIAGNOSTICS_IN_PROGRESS = 'diagnostics_in_progress',
  AWAITING_REVIEW = 'awaiting_review',
  FINISHED = 'finished',
  CANCELLED = 'cancelled',
}

export const ENCOUNTER_STATUS_TRANSITIONS: Record<EncounterStatus, EncounterStatus[]> = {
  [EncounterStatus.ARRIVED]: [EncounterStatus.REGISTERED, EncounterStatus.CANCELLED],
  [EncounterStatus.REGISTERED]: [EncounterStatus.WAITING_FOR_DOCTOR, EncounterStatus.CANCELLED],
  [EncounterStatus.WAITING_FOR_DOCTOR]: [EncounterStatus.IN_PROGRESS, EncounterStatus.CANCELLED],
  [EncounterStatus.IN_PROGRESS]: [EncounterStatus.AWAITING_DIAGNOSTICS, EncounterStatus.FINISHED],
  [EncounterStatus.AWAITING_DIAGNOSTICS]: [
    EncounterStatus.DIAGNOSTICS_IN_PROGRESS,
    EncounterStatus.AWAITING_REVIEW,
    EncounterStatus.IN_PROGRESS, // huỷ hết chỉ định -> bác sĩ chỉ định lại
  ],
  [EncounterStatus.DIAGNOSTICS_IN_PROGRESS]: [
    EncounterStatus.AWAITING_REVIEW,
    EncounterStatus.AWAITING_DIAGNOSTICS, // có chỉ định bổ sung chưa vào hàng đợi
    EncounterStatus.IN_PROGRESS,
  ],
  [EncounterStatus.AWAITING_REVIEW]: [EncounterStatus.FINISHED, EncounterStatus.AWAITING_DIAGNOSTICS],
  [EncounterStatus.FINISHED]: [],
  [EncounterStatus.CANCELLED]: [],
};

export function isValidEncounterTransition(current: string, next: string): boolean {
  const allowedNext = ENCOUNTER_STATUS_TRANSITIONS[current as EncounterStatus];
  return Boolean(allowedNext?.includes(next as EncounterStatus));
}
