import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { DOCTOR_PUBLIC_SELECT, DOCTOR_WRITABLE_STATUSES } from '../common/encounter-status.guard';
import { DoctorEncounterAccessService } from '../common/doctor-encounter-access.service';
import { UpsertClinicalExaminationDto } from './dto/upsert-clinical-examination.dto';
import {
    StructuredFindings,
    assertStructuredConsistent,
    composeTexts,
    normalizeStructured,
} from './findings-composer';

type TextKey = 'inspectionFindings' | 'palpationFindings' | 'percussionFindings' | 'auscultationFindings';
const TEXT_KEYS: TextKey[] = ['inspectionFindings', 'palpationFindings', 'percussionFindings', 'auscultationFindings'];

const trimmed = (v?: string | null) => {
    const t = v?.trim();
    return t ? t : undefined;
};

/**
 * SE02 — Khám tim mạch (bác sĩ): tư thế -> nhìn -> sờ -> gõ -> nghe -> nhận định (theo phiếu thăm khám lâm sàng
 * tim mạch). 1 Encounter = 1 ClinicalExamination (upsert, lưu nháp từng phần được).
 *
 * - Dữ liệu có cấu trúc (`structured`) lưu ở cột JSONB `structuredFindings`, merge THEO MỤC (mục gửi lên ghi đè
 *   nguyên mục, mục không gửi giữ nguyên). Đồng thời sinh văn bản tiếng Việt vào các cột text cũ để timeline /
 *   AI review / báo cáo đọc như trước.
 * - Ghi phiếu = "bác sĩ bắt đầu khám": nếu Encounter đang 'waiting_for_doctor' thì chuyển 'in_progress' và đồng bộ
 *   DoctorQueueEntry (xem DoctorEncounterAccessService.startExaminationIfNeeded).
 */
@Injectable()
export class ClinicalExaminationService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly access: DoctorEncounterAccessService,
    ) { }

    async upsert(encounterId: string, dto: UpsertClinicalExaminationDto, currentUserId: string) {
        const structured = normalizeStructured(dto.structured);
        assertStructuredConsistent(structured);

        const hasContent =
            Boolean(trimmed(dto.patientPosition)) ||
            Boolean(trimmed(dto.clinicalNotes)) ||
            TEXT_KEYS.some((k) => trimmed(dto[k])) ||
            Object.keys(structured).length > 0;
        if (!hasContent) {
            throw new BadRequestException(
                'Cần nhập ít nhất 1 nội dung: tư thế, nhìn, sờ, gõ, nghe, nhận định hoặc ghi chú lâm sàng.',
            );
        }

        const { doctor, encounter } = await this.access.prepareWrite(
            encounterId,
            currentUserId,
            DOCTOR_WRITABLE_STATUSES,
            'ghi nhận khám lâm sàng',
        );

        const composed = composeTexts(structured);

        return this.prisma.$transaction(async (tx) => {
            // Serialize theo lượt khám: 2 request lưu nháp các mục khác nhau không được ghi đè mất nhau khi merge JSON.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`clinical-exam:${encounterId}`}))`;

            const existing = await tx.clinicalExamination.findUnique({ where: { encounterId } });

            const texts: Partial<Record<TextKey | 'clinicalNotes', string>> = {};
            for (const key of TEXT_KEYS) {
                const generated = composed[key];
                const free = trimmed(dto[key]);
                if (generated === undefined && free === undefined) continue; // không đụng tới mục này
                texts[key] = [generated, free].filter(Boolean).join('\n');
            }
            const notes = trimmed(dto.clinicalNotes) ?? composed.clinicalNotes;
            if (notes !== undefined) texts.clinicalNotes = notes;

            const mergedStructured: StructuredFindings = {
                ...((existing?.structuredFindings as StructuredFindings | null) ?? {}),
                ...structured,
            };

            const data = {
                doctorId: doctor.doctorId,
                patientPosition: trimmed(dto.patientPosition),
                ...texts,
                ...(Object.keys(mergedStructured).length
                    ? { structuredFindings: mergedStructured as Prisma.InputJsonObject }
                    : {}),
                ...(dto.examinedAt ? { examinedAt: new Date(dto.examinedAt) } : {}),
            };

            const examination = await tx.clinicalExamination.upsert({
                where: { encounterId },
                // Cập nhật giữ nguyên examinedAt gốc (mốc bắt đầu khám) nếu client không truyền.
                create: { encounterId, ...data, examinedAt: data.examinedAt ?? new Date() },
                update: data,
                include: { doctor: { select: DOCTOR_PUBLIC_SELECT } },
            });

            await this.access.startExaminationIfNeeded(tx, encounter, doctor.doctorId);
            return examination;
        });
    }

    /** Bác sĩ bấm "Bắt đầu khám" (gọi bệnh nhân vào) — chưa cần nhập phiếu. */
    async startExamination(encounterId: string, currentUserId: string) {
        const { doctor, encounter } = await this.access.prepareWrite(
            encounterId,
            currentUserId,
            DOCTOR_WRITABLE_STATUSES,
            'bắt đầu khám',
        );

        const started = await this.prisma.$transaction((tx) =>
            this.access.startExaminationIfNeeded(tx, encounter, doctor.doctorId),
        );

        const fresh = await this.prisma.encounter.findUniqueOrThrow({
            where: { encounterId },
            select: { encounterId: true, status: true, doctorId: true },
        });
        return { ...fresh, started };
    }

    async findByEncounterId(encounterId: string) {
        const examination = await this.prisma.clinicalExamination.findUnique({
            where: { encounterId },
            include: { doctor: { select: DOCTOR_PUBLIC_SELECT } },
        });

        if (!examination) {
            throw new NotFoundException(`Lượt khám ${encounterId} chưa có bản ghi khám lâm sàng`);
        }
        return examination;
    }
}
