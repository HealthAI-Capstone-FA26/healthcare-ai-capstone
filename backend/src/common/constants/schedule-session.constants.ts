export enum ScheduleSession {
  MORNING = 'morning',
  AFTERNOON = 'afternoon',
  EVENING = 'evening',
}

export interface SessionDefault {
  startTime: string; // HH:mm
  endTime: string; // HH:mm
}

// Giờ mặc định theo từng session — dùng khi request tạo lịch không truyền rõ startTime/endTime.
// có thể chỉnh lại theo cấu hình khoa sau này.
export const SESSION_DEFAULTS: Record<ScheduleSession, SessionDefault> = {
  [ScheduleSession.MORNING]: { startTime: '07:30', endTime: '11:30' },
  [ScheduleSession.AFTERNOON]: { startTime: '13:00', endTime: '17:00' },
  [ScheduleSession.EVENING]: { startTime: '17:30', endTime: '20:30' },
};

export const DEFAULT_SLOT_DURATION_MINS = 60;
export const DEFAULT_MAX_PATIENTS_PER_SLOT = 3;

// Kết hợp workDate (chỉ lấy phần ngày) với giờ "HH:mm" -> Date đầy đủ theo local time.
export function combineDateAndTime(workDate: Date, hhmm: string): Date {
  const [hours, minutes] = hhmm.split(':').map(Number);
  // Dùng UTC để ngày/giờ không bị thay đổi khi server chạy ở timezone khác.
  const combined = new Date(
    Date.UTC(workDate.getUTCFullYear(), workDate.getUTCMonth(), workDate.getUTCDate(), hours, minutes, 0, 0),
  );
  return combined;
}

// Prisma field @db.Time chỉ cần 1 Date bất kỳ mang đúng giờ:phút, dùng mốc cố định 1970-01-01.
export function timeOfDay(hhmm: string): Date {
  const [hours, minutes] = hhmm.split(':').map(Number);
  // Phần ngày bị bỏ qua; chỉ giờ và phút được Prisma dùng cho kiểu Time.
  return new Date(Date.UTC(1970, 0, 1, hours, minutes, 0, 0));
}
