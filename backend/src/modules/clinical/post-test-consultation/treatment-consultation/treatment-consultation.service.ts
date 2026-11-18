import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../../../../prisma/prisma.service";
import { ActorRoleService } from "../../../identity-access/user/actor-role.service";
import { DoctorService } from "../../../identity-access/doctor/doctor.service";
import { ACTOR_ROLE } from "../../../../common/constants/actor-role.constant";
import { AppointmentStatus } from "../../../../common/utils/appointment-status.util";
import { generateUniqueCode } from "../../../../common/utils/code-generator.util";
import { getHospitalWallClockNow } from "../../../../common/utils/hospital-clock.util";
import { assertEncounterAwaitingReview } from "../shared/encounter-lab-results.util";
import { UpsertTreatmentConsultationDto } from "./dto/upsert-treatment-consultation.dto";

const DIAGNOSIS_TYPE_FINAL = "final";
const APPOINTMENT_CODE_PREFIX = "LH";

/**
 * SE05, "Tư vấn điều trị": ghi nhận TreatmentConsultation (1-1 với Encounter, gọi lại là upsert).
 *
 * Tiền điều kiện:
 *  - Encounter đang 'awaiting_review' (cả tạo lần đầu lẫn sửa) — cùng cổng với kết luận chẩn đoán;
 *  - LẦN ĐẦU tạo: đã có ÍT NHẤT 1 chẩn đoán CHÍNH THỨC (final) — tư vấn luôn dựa trên kết luận đã chốt.
 *
 * KHÔNG còn đổi trạng thái Encounter. Bản cũ tự chuyển 'finished' ngay lần tạo đầu, khiến SE06 không thể kê đơn
 * (prescription chặn encounter đã 'finished'). Theo thiết kế mới: bác sĩ kê đơn + hẹn tái khám ở SE06, và việc
 * đóng lượt khám ('awaiting_review' -> 'finished') thuộc SE06. Sau khi SE06 đóng, encounter 'finished' nên không
 * sửa được tư vấn nữa (không sửa hồ sơ sau khi đã kết thúc).
 */
@Injectable()
export class TreatmentConsultationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly actorRoleService: ActorRoleService,
    private readonly doctorService: DoctorService,
  ) {}

  async upsert(
    encounterId: string,
    dto: UpsertTreatmentConsultationDto,
    currentUserId: string,
  ) {
    await this.actorRoleService.assertActorRole(currentUserId, [
      ACTOR_ROLE.DOCTOR,
    ]);
    const doctor = await this.doctorService.findByUserId(currentUserId);

    await assertEncounterAwaitingReview(this.prisma, encounterId);

    const existing = await this.prisma.treatmentConsultation.findUnique({
      where: { encounterId },
      select: { consultationId: true },
    });

    if (!existing) {
      const finalDiagnosisCount = await this.prisma.diagnosis.count({
        where: { encounterId, diagnosisType: DIAGNOSIS_TYPE_FINAL },
      });
      if (finalDiagnosisCount === 0) {
        throw new BadRequestException(
          "Lượt khám chưa có chẩn đoán chính thức (final) nào — cần hoàn tất bước kết luận chuyên môn " +
            "(post-test-consultation/.../diagnosis-conclusion) trước khi tư vấn điều trị.",
        );
      }
    }

    const followUpRequired = dto.followUpRequired ?? false;
    if (followUpRequired && !dto.followUpSlotId) {
      throw new BadRequestException(
        "Cần chọn slot tái khám khi followUpRequired = true",
      );
    }
    const followUpSlotId = dto.followUpSlotId;
    const encounter = await this.prisma.encounter.findUnique({
      where: { encounterId },
      select: { patientId: true, doctorId: true },
    });
    if (!encounter) {
      throw new NotFoundException(`Không tìm thấy lượt khám ${encounterId}`);
    }
    if (encounter.doctorId && encounter.doctorId !== doctor.doctorId) {
      throw new BadRequestException(
        "Bạn chỉ có thể đặt lịch tái khám cho lượt khám do chính mình phụ trách",
      );
    }

    const appointmentCode = followUpRequired
      ? await generateUniqueCode(APPOINTMENT_CODE_PREFIX, async (code) => {
          const existingAppointment = await this.prisma.appointment.findUnique({
            where: { appointmentCode: code },
          });
          return Boolean(existingAppointment);
        })
      : null;

    return this.prisma.$transaction(async (tx) => {
      const existingFollowUp = await tx.appointment.findUnique({
        where: { sourceEncounterId: encounterId },
        select: { appointmentId: true, slotId: true, status: true },
      });

      if (!followUpRequired) {
        if (
          existingFollowUp &&
          [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED].includes(
            existingFollowUp.status as AppointmentStatus,
          )
        ) {
          throw new BadRequestException(
            "Lượt khám đã có lịch tái khám đang hoạt động. Hãy huỷ lịch trước khi bỏ chọn tái khám.",
          );
        }
      } else {
        const slot = await tx.appointmentSlot.findUnique({
          where: { slotId: followUpSlotId },
          include: { schedule: true },
        });
        if (
          !slot ||
          slot.schedule.doctorId !== doctor.doctorId ||
          slot.schedule.status !== "active" ||
          (slot.status !== "free" && slot.slotId !== existingFollowUp?.slotId)
        ) {
          throw new BadRequestException(
            "Slot tái khám không tồn tại, không thuộc bác sĩ đang khám, đã bị khoá hoặc đã hết chỗ",
          );
        }
        if (
          slot.slotStartTime.getTime() <= getHospitalWallClockNow().getTime()
        ) {
          throw new BadRequestException(
            "Slot tái khám phải nằm trong tương lai",
          );
        }

        if (existingFollowUp) {
          if (
            ![AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED].includes(
              existingFollowUp.status as AppointmentStatus,
            )
          ) {
            throw new BadRequestException(
              "Lịch tái khám đã bắt đầu hoặc đã hoàn tất nên không thể đổi slot",
            );
          }
          if (existingFollowUp.slotId !== slot.slotId) {
            if (existingFollowUp.slotId) {
              await tx.appointmentSlot.update({
                where: { slotId: existingFollowUp.slotId },
                data: { bookedCount: { decrement: 1 }, status: "free" },
              });
            }
            const reserved = await tx.appointmentSlot.updateMany({
              where: {
                slotId: slot.slotId,
                bookedCount: { lt: slot.capacity },
              },
              data: { bookedCount: { increment: 1 } },
            });
            if (reserved.count === 0) {
              throw new ConflictException(
                "Slot tái khám đã đầy, vui lòng chọn slot khác",
              );
            }
            if (slot.bookedCount + 1 >= slot.capacity) {
              await tx.appointmentSlot.update({
                where: { slotId: slot.slotId },
                data: { status: "full" },
              });
            }
          }
          await tx.appointment.update({
            where: { appointmentId: existingFollowUp.appointmentId },
            data: {
              doctorId: doctor.doctorId,
              slotId: slot.slotId,
              appointmentDate: slot.slotStartTime,
              appointmentTime: slot.slotStartTime,
            },
          });
        } else {
          const reserved = await tx.appointmentSlot.updateMany({
            where: { slotId: slot.slotId, bookedCount: { lt: slot.capacity } },
            data: { bookedCount: { increment: 1 } },
          });
          if (reserved.count === 0) {
            throw new ConflictException(
              "Slot tái khám đã đầy, vui lòng chọn slot khác",
            );
          }
          if (slot.bookedCount + 1 >= slot.capacity) {
            await tx.appointmentSlot.update({
              where: { slotId: slot.slotId },
              data: { status: "full" },
            });
          }
          await tx.appointment.create({
            data: {
              appointmentCode: appointmentCode!,
              patientId: encounter.patientId,
              doctorId: doctor.doctorId,
              slotId: slot.slotId,
              bookingChannel: "doctor_follow_up",
              appointmentType: "follow_up",
              sourceEncounterId: encounterId,
              appointmentDate: slot.slotStartTime,
              appointmentTime: slot.slotStartTime,
              status: AppointmentStatus.PENDING,
            },
          });
        }
      }

      const data = {
        doctorId: doctor.doctorId,
        conditionExplanation: dto.conditionExplanation,
        treatmentPlan: dto.treatmentPlan,
        lifestyleAdvice: dto.lifestyleAdvice,
        nutritionAdvice: dto.nutritionAdvice,
        followUpRequired,
        followUpIntervalDays: followUpRequired
          ? (dto.followUpIntervalDays ?? null)
          : null,
        consultedAt: dto.consultedAt ? new Date(dto.consultedAt) : new Date(),
      };

      return tx.treatmentConsultation.upsert({
        where: { encounterId },
        create: { encounterId, ...data },
        update: data,
        include: { doctor: true },
      });
    });
  }

  async findByEncounterId(encounterId: string) {
    const consultation = await this.prisma.treatmentConsultation.findUnique({
      where: { encounterId },
      include: {
        doctor: true,
        encounter: {
          include: {
            followUpAppointment: {
              include: { slot: true },
            },
          },
        },
      },
    });

    if (!consultation) {
      throw new NotFoundException(
        `Lượt khám ${encounterId} chưa có bản ghi tư vấn điều trị`,
      );
    }

    return consultation;
  }
}
