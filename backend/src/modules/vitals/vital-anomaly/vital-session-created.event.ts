/**
 * Event được emit ngay sau khi 1 VitalSignSession (kèm observations) đã lưu DB thành công.
 * Listener (VitalSignDetectionListener) sẽ lắng nghe event này để chạy detection ở background,
 * không block response của API tạo session.
 */
export class VitalSessionCreatedEvent {
    constructor(public readonly vitalSessionId: string) {}
}

export const VITAL_SESSION_CREATED_EVENT = 'vital-session.created';
