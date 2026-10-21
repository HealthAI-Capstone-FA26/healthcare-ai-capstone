import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { generateUniqueCode } from '../../../common/utils/code-generator.util';
import { EncounterStatus } from '../../../common/utils/encounter-status.util';
import {
    AppointmentStatus,
    isValidAppointmentTransition,
} from '../../../common/utils/appointment-status.util';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import { RequestUser } from '../../auth/strategies/jwt.strategy';
import { DoctorService } from '../../doctor/doctor.service';
import { ActorRoleService } from '../../user/actor-role.service';
import { NotificationDispatcherService } from '../notification/notification-dispatcher.service';
import { getHospitalWallClockNow } from '../../../common/utils/hospital-clock.util';
import { ScheduleFollowupDto } from './dtos/schedule-followup.dto';

const APPOINTMENT_CODE_PREFIX = 'LH';

@Injectable()
export class PrescriptionFollowupService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly doctorService: DoctorService,
        private readonly actorRoleService: ActorRoleService,
        private readonly notificationDispatcher: NotificationDispatcherService,
    ) {}

    private generateAppointmentCode(): Promise<string> {
        return generateUniqueCode(APPOINTMENT_CODE_PREFIX, async (code) => {
            const existing = await this.prisma.appointment.findUnique({
                where: { appointmentCode: code },
            });
            return Boolean(existing);
        });
    }

    private async resolveCurrentDoctor(currentUser: RequestUser) {
        await this.actorRoleService.assertActorRole(currentUser.userId, [ACTOR_ROLE.DOCTOR]);
        return this.doctorService.findByUserId(currentUser.userId);
    }

    private async completeAppointmentForEncounter(
        tx: Prisma.TransactionClient,
        appointmentId: string,
    ) {
        const appointment = await tx.appointment.findUnique({ where: { appointmentId } });
        if (!appointment) {
            throw new NotFoundException('Không tìm thấy lịch hẹn liên kết với lượt khám');
        }

        if (appointment.status === AppointmentStatus.COMPLETED) {
            return appointment;
        }

        let currentStatus = appointment.status;
        if (currentStatus !== AppointmentStatus.IN_PROGRESS) {
            if (!isValidAppointmentTransition(currentStatus, AppointmentStatus.IN_PROGRESS)) {
                throw new BadRequestException(
                    `Không thể hoàn tất lịch hẹn đang ở trạng thái '${currentStatus}'`,
                );
            }

            await tx.appointment.update({
                where: { appointmentId },
                data: { status: AppointmentStatus.IN_PROGRESS },
            });
            currentStatus = AppointmentStatus.IN_PROGRESS;
        }

        if (!isValidAppointmentTransition(currentStatus, AppointmentStatus.COMPLETED)) {
            throw new BadRequestException(
                `Không thể chuyển lịch hẹn từ '${currentStatus}' sang '${AppointmentStatus.COMPLETED}'`,
            );
        }

        return tx.appointment.update({
            where: { appointmentId },
            data: { status: AppointmentStatus.COMPLETED },
        });
    }

    // Gợi ý ngày tái khám dựa trên:
    // 1. Phác đồ điều trị (treatmentConsultation.followUpIntervalDays)
    // 2. Max durationDays của các thuốc kê trong đơn
    // 3. Mặc định 14 ngày
    private computeSuggestedDate(
        consultation: { followUpIntervalDays?: number | null } | null | undefined,
        items: { durationDays?: number | null }[],
    ): Date {
        let intervalDays = consultation?.followUpIntervalDays;

        if (!intervalDays || intervalDays <= 0) {
            const durations = items
                .map((item) => item.durationDays)
                .filter((d): d is number => typeof d === 'number' && d > 0);
            if (durations.length > 0) {
                intervalDays = Math.max(...durations);
            }
        }

        const daysToAdd = intervalDays && intervalDays > 0 ? intervalDays : 14;
        return new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000);
    }

    // GET /prescriptions/:id/followup/suggestion — bác sĩ xem ngày gợi ý trước khi đặt (có thể chọn ngày khác)
    async getSuggestedDate(prescriptionId: string) {
        const prescription = await this.prisma.prescription.findUnique({
            where: { prescriptionId },
            include: { items: true, encounter: { include: { treatmentConsultation: true } } },
        });
        if (!prescription) {
            throw new NotFoundException('Không tìm thấy đơn thuốc');
        }
        const suggested = this.computeSuggestedDate(prescription.encounter.treatmentConsultation, prescription.items);
        return { suggestedDate: suggested.toISOString().slice(0, 10) };
    }

    // POST /prescriptions/:id/followup — Đặt lịch tái khám (SE06 theo Appointment schema v2)
    async scheduleFollowup(prescriptionId: string, dto: ScheduleFollowupDto, currentUser: RequestUser) {
        const doctor = await this.resolveCurrentDoctor(currentUser);

        const prescription = await this.prisma.prescription.findUnique({
            where: { prescriptionId },
            include: {
                items: true,
                diagnosis: true,
                doctor: true,
                encounter: {
                    include: {
                        patient: true,
                        treatmentConsultation: true,
                    },
                },
            },
        });

        if (!prescription) {
            throw new NotFoundException('Không tìm thấy đơn thuốc');
        }
        if (prescription.doctorId !== doctor.doctorId) {
            throw new ForbiddenException('Bạn chỉ có thể đặt lịch tái khám cho đơn thuốc do chính mình kê');
        }
        if (prescription.status !== 'signed') {
            throw new BadRequestException(
                `Đơn thuốc đang ở trạng thái "${prescription.status}", chỉ có thể đặt lịch tái khám sau khi đơn đã được ký (signed).`,
            );
        }

        const followUpDoctorId = dto.doctorId ?? prescription.doctorId;

        // Kiểm tra xem lượt khám đã có lịch tái khám chưa (sourceEncounterId là unique)
        const existingFollowup = await this.prisma.appointment.findUnique({
            where: { sourceEncounterId: prescription.encounterId },
        });
        if (existingFollowup) {
            throw new ConflictException(
                `Lượt khám này đã có lịch hẹn tái khám (Mã lịch hẹn: ${existingFollowup.appointmentCode}).`,
            );
        }

        // Tính ngày hẹn tái khám
        let targetDate: Date;
        if (dto.appointmentDate) {
            targetDate = new Date(dto.appointmentDate);
            if (isNaN(targetDate.getTime())) {
                throw new BadRequestException('Ngày hẹn tái khám không hợp lệ');
            }
        } else {
            targetDate = this.computeSuggestedDate(prescription.encounter.treatmentConsultation, prescription.items);
        }

        let targetTime: Date | null = null;
        if (dto.appointmentTime) {
            targetTime = new Date(`1970-01-01T${dto.appointmentTime}Z`);
            if (isNaN(targetTime.getTime())) {
                targetTime = null;
            }
        }

        let slotId: string | null = null;
        let selectedSlot: { slotId: string; capacity: number; bookedCount: number } | null = null;
        if (dto.slotId) {
            const slot = await this.prisma.appointmentSlot.findUnique({
                where: { slotId: dto.slotId },
                include: { schedule: true },
            });

            if (!slot || slot.status !== 'free') {
                throw new BadRequestException('Slot không tồn tại hoặc đã hết chỗ');
            }
            if (slot.slotStartTime.getTime() <= getHospitalWallClockNow().getTime()) {
                throw new BadRequestException('Khung giờ khám này đã kết thúc hoặc không còn khả dụng để đặt lịch');
            }
            if (slot.schedule.doctorId !== followUpDoctorId) {
                throw new BadRequestException('Slot không thuộc bác sĩ được chọn cho lịch tái khám');
            }
            if (slot.slotStartTime.toISOString().slice(0, 10) !== targetDate.toISOString().slice(0, 10)) {
                throw new BadRequestException('Ngày của slot phải trùng với appointmentDate');
            }

            slotId = slot.slotId;
            selectedSlot = slot;
            targetDate = slot.slotStartTime;
            targetTime = slot.slotStartTime;
        }

        const appointmentCode = await this.generateAppointmentCode();
        const patient = prescription.encounter.patient;

        const result = await this.prisma.$transaction(async (tx) => {
            if (selectedSlot) {
                const updated = await tx.appointmentSlot.updateMany({
                    where: {
                        slotId: selectedSlot.slotId,
                        status: 'free',
                        bookedCount: { lt: selectedSlot.capacity },
                    },
                    data: { bookedCount: { increment: 1 } },
                });
                if (updated.count === 0) {
                    throw new ConflictException('Slot đã đầy hoặc vừa được đặt, vui lòng chọn slot khác');
                }
                if (selectedSlot.bookedCount + 1 >= selectedSlot.capacity) {
                    await tx.appointmentSlot.update({
                        where: { slotId: selectedSlot.slotId },
                        data: { status: 'full' },
                    });
                }
            }

            const appointment = await tx.appointment.create({
                data: {
                    appointmentCode,
                    patientId: prescription.encounter.patientId,
                    doctorId: followUpDoctorId,
                    slotId,
                    bookedByUserId: currentUser.userId,
                    bookingChannel: 'doctor_follow_up',
                    appointmentType: 'follow_up',
                    sourceEncounterId: prescription.encounterId,
                    appointmentDate: targetDate,
                    appointmentTime: targetTime,
                    status: 'confirmed',
                    reasonForVisit: dto.reasonForVisit ?? `Tái khám: ${prescription.diagnosis.diagnosisName}`,
                    priority: dto.priority ?? 'normal',
                },
                include: {
                    patient: true,
                    doctor: true,
                },
            });

            const shouldClose = dto.closeEncounter ?? true;
            if (
                shouldClose &&
                (prescription.encounter.status === EncounterStatus.AWAITING_REVIEW ||
                    prescription.encounter.status === EncounterStatus.IN_PROGRESS)
            ) {
                await tx.encounter.update({
                    where: { encounterId: prescription.encounterId },
                    data: {
                        status: EncounterStatus.FINISHED,
                        finishedAt: new Date(),
                    },
                });
                await this.completeAppointmentForEncounter(tx, prescription.encounter.appointmentId);
            }

            return appointment;
        });

        // Gửi thông báo nhắc tái khám (follow_up_reminder theo schema SE07)
        const oneDayBefore = new Date(targetDate.getTime() - 24 * 60 * 60 * 1000);
        const scheduledAt = oneDayBefore > new Date() ? oneDayBefore : new Date();

        await this.notificationDispatcher.dispatch({
            recipient: {
                patientId: patient.patientId,
                userId: patient.userId ?? undefined,
                email: patient.email ?? undefined,
            },
            notificationType: 'follow_up_reminder',
            referenceType: 'appointment',
            referenceId: result.appointmentId,
            title: 'Lịch hẹn tái khám chuyên khoa Tim mạch',
            content:
                `Bạn có lịch hẹn tái khám (${result.appointmentCode}) vào ngày ${targetDate.toLocaleDateString('vi-VN')} ` +
                `với BS. ${prescription.doctor.fullName}. Lý do: ${result.reasonForVisit}.`,
            scheduledAt,
        });

        return {
            appointment: result,
            closedEncounter: dto.closeEncounter ?? true,
        };
    }

    // GET /prescriptions/:id/followup — Xem lịch tái khám liên kết với đơn thuốc
    async getFollowup(prescriptionId: string) {
        const prescription = await this.prisma.prescription.findUnique({
            where: { prescriptionId },
            select: { encounterId: true },
        });

        if (!prescription) {
            throw new NotFoundException('Không tìm thấy đơn thuốc');
        }

        const appointment = await this.prisma.appointment.findUnique({
            where: { sourceEncounterId: prescription.encounterId },
            include: {
                patient: true,
                doctor: true,
                slot: true,
            },
        });

        if (!appointment) {
            throw new NotFoundException('Lượt khám này chưa có lịch hẹn tái khám');
        }

        return appointment;
    }

    // POST /prescriptions/encounters/:encounterId/finish — Đóng lượt khám khi hoàn tất kê đơn mà không cần đặt tái khám
    async finishEncounter(encounterId: string, currentUser: RequestUser) {
        const doctor = await this.resolveCurrentDoctor(currentUser);
        const encounter = await this.prisma.encounter.findUnique({ where: { encounterId } });

        if (!encounter) {
            throw new NotFoundException('Không tìm thấy lượt khám');
        }
        if (encounter.doctorId && encounter.doctorId !== doctor.doctorId) {
            throw new ForbiddenException('Bạn chỉ có thể kết thúc lượt khám do chính mình phụ trách');
        }
        if (encounter.status === EncounterStatus.FINISHED) {
            throw new BadRequestException('Lượt khám này đã được kết thúc trước đó');
        }
        if (encounter.status === EncounterStatus.CANCELLED) {
            throw new BadRequestException('Lượt khám này đã bị huỷ');
        }

        return this.prisma.$transaction(async (tx) => {
            const finishedEncounter = await tx.encounter.update({
                where: { encounterId },
                data: {
                    status: EncounterStatus.FINISHED,
                    finishedAt: new Date(),
                },
            });
            await this.completeAppointmentForEncounter(tx, encounter.appointmentId);
            return finishedEncounter;
        });
    }
}
