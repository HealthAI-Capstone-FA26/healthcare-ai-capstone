import { BadRequestException } from '@nestjs/common';
import { EncounterStatus } from '../../../common/utils/encounter-status.util';

/**
 * Trạng thái Encounter cho phép bác sĩ GHI khám lâm sàng / chẩn đoán ban đầu.
 * Không gồm: arrived, registered (chưa tới lượt bác sĩ), finished, cancelled.
 */
export const DOCTOR_WRITABLE_STATUSES: string[] = [
    EncounterStatus.WAITING_FOR_DOCTOR,
    EncounterStatus.IN_PROGRESS,
    EncounterStatus.AWAITING_DIAGNOSTICS,
    EncounterStatus.DIAGNOSTICS_IN_PROGRESS,
    EncounterStatus.AWAITING_REVIEW,
];

/**
 * Trạng thái cho phép CHỈ ĐỊNH cận lâm sàng. Không cho 'waiting_for_doctor' — bác sĩ phải bắt đầu khám
 * (in_progress) trước. Cho phép chỉ định bổ sung khi đang chờ/đang thực hiện/đã có kết quả.
 */
export const ORDERABLE_STATUSES: string[] = [
    EncounterStatus.IN_PROGRESS,
    EncounterStatus.AWAITING_DIAGNOSTICS,
    EncounterStatus.DIAGNOSTICS_IN_PROGRESS,
    EncounterStatus.AWAITING_REVIEW,
];

export function assertEncounterStatusIn(status: string, allowed: string[], action: string): void {
    if (allowed.includes(status)) return;

    if (status === EncounterStatus.CANCELLED || status === EncounterStatus.FINISHED) {
        throw new BadRequestException(`Lượt khám đang ở trạng thái '${status}', không thể ${action}.`);
    }
    throw new BadRequestException(
        `Lượt khám đang ở trạng thái '${status}' (chưa tới bước phù hợp), chưa thể ${action}.`,
    );
}

/** Chỉ lộ thông tin nghề nghiệp của bác sĩ (không trả userId / số giấy phép ra API đọc chung). */
export const DOCTOR_PUBLIC_SELECT = {
    doctorId: true,
    doctorCode: true,
    fullName: true,
    title: true,
    specialization: true,
} as const;

