/**
 * Mã (itemCode) của các chỉ số sinh hiệu / thể trạng trong danh mục VitalSignItem.
 * Các mã này PHẢI khớp với dữ liệu đã seed trong bảng vital_sign_items — nếu đổi
 * itemCode khi seed dữ liệu thì phải cập nhật lại tương ứng ở đây.
 *
 * BMI được đánh dấu isCalculated = true trong danh mục vì được hệ thống tự tính,
 * không do điều dưỡng nhập trực tiếp.
 */
export const VITAL_ITEM_CODE = {
    PULSE: 'HR', // Nhịp tim / Mạch (bpm)
    BP_SYSTOLIC: 'SBP', // Huyết áp tâm thu (mmHg)
    BP_DIASTOLIC: 'DBP', // Huyết áp tâm trương (mmHg)
    TEMPERATURE: 'TEMP', // Thân nhiệt (°C)
    RESPIRATORY_RATE: 'RR', // Nhịp thở (breaths/min)
    SPO2: 'SPO2', // Nồng độ Oxy trong máu (%)
    HEIGHT: 'HEIGHT', // Chiều cao (cm)
    WEIGHT: 'WEIGHT', // Cân nặng (kg)
    BMI: 'BMI', // Chỉ số khối cơ thể — tự động tính từ HEIGHT + WEIGHT (kg/m2)
} as const;

export type VitalItemCode = (typeof VITAL_ITEM_CODE)[keyof typeof VITAL_ITEM_CODE];
