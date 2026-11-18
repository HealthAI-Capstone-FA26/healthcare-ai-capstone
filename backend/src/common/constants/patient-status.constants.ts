// Patient.status: 'draft' (hồ sơ tạo tự động khi khách vãng lai đặt lịch qua OTP, chưa được xác
// nhận danh tính) | 'main' (hồ sơ chính thức — tạo qua luồng đã xác thực, hoặc draft đã được lễ
// tân xác nhận khi bệnh nhân đến khám). Patient status='draft' quá hạn mà chưa chuyển 'main' sẽ
// bị CleanupDraftPatientsCron xoá mỗi ngày (xem cleanup-draft-patients.cron.ts).
export enum PatientStatus {
  DRAFT = 'draft',
  MAIN = 'main',
}

// Số ngày 1 patient được phép ở trạng thái draft trước khi bị cronjob dọn dẹp.
export const DRAFT_PATIENT_RETENTION_DAYS = 1;
