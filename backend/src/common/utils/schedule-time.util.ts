// workDate (DateTime @db.Date) có phần giờ = 00:00 UTC; startTime/endTime (DateTime @db.Time)
// chỉ có phần giờ:phút có giá trị -> ghép lại thành 1 mốc thời gian thật để so sánh với "now".
export function combineDateWithTimeOfDay(date: Date, time: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      time.getUTCHours(),
      time.getUTCMinutes(),
      0,
      0,
    ),
  );
}
