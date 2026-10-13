// State machine dùng chung cho Appointment (Online lẫn At_hospital, xem Phase 4 & Phase 5).
// Đặt tại 1 nơi duy nhất để tránh 2 phase viết 2 bản transition khác nhau.
//
//   pending -> confirmed -> checked_in -> in_progress -> completed
//   pending/confirmed -> cancelled
//   pending/confirmed/checked_in -> no_show

export enum AppointmentStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  CHECKED_IN = 'checked_in',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  NO_SHOW = 'no_show',
}

export const APPOINTMENT_STATUS_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  [AppointmentStatus.PENDING]: [
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.CANCELLED,
    AppointmentStatus.NO_SHOW,
  ],
  [AppointmentStatus.CONFIRMED]: [
    AppointmentStatus.CHECKED_IN,
    AppointmentStatus.CANCELLED,
    AppointmentStatus.NO_SHOW,
  ],
  [AppointmentStatus.CHECKED_IN]: [AppointmentStatus.IN_PROGRESS, AppointmentStatus.NO_SHOW],
  [AppointmentStatus.IN_PROGRESS]: [AppointmentStatus.COMPLETED],
  [AppointmentStatus.COMPLETED]: [],
  [AppointmentStatus.CANCELLED]: [],
  [AppointmentStatus.NO_SHOW]: [],
};

export function isValidAppointmentTransition(current: string, next: string): boolean {
  const allowedNext = APPOINTMENT_STATUS_TRANSITIONS[current as AppointmentStatus];
  return Boolean(allowedNext?.includes(next as AppointmentStatus));
}

// `cancel` chỉ cho phép từ pending/confirmed (xác nhận lại rule này với PO nếu cần mở rộng).
export function canCancelAppointment(current: string): boolean {
  return current === AppointmentStatus.PENDING || current === AppointmentStatus.CONFIRMED;
}
