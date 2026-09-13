import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { RequestUser } from '../../auth/strategies/jwt.strategy';
import { DoctorService } from '../../doctor/doctor.service';
import { AppointmentService } from '../../appointment-registration/appointment/appointment.service';
import { AppointmentPriority } from '../../appointment-registration/appointment/dto/create-appointment.dto';
import { NotificationDispatcherService } from '../notification/notification-dispatcher.service';
import { ScheduleFollowupDto } from './dtos/schedule-followup.dto';

@Injectable()
export class PrescriptionFollowupService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly doctorService: DoctorService,
        private readonly appointmentService: AppointmentService,
        private readonly notificationDispatcher: NotificationDispatcherService,
    ) {}

    // POST /prescriptions/:id/followup
    async scheduleFollowup(prescriptionId: string, dto: ScheduleFollowupDto, currentUser: RequestUser) {
        const doctor = await this.doctorService.findByUserId(currentUser.userId);

        const prescription = await this.prisma.prescription.findUnique({
            where: { prescriptionId },
            include: {
                diagnosis: true,
                encounter: { include: { patient: true } },
            },
        });
        if (!prescription) {
            throw new NotFoundException('Không tìm thấy đơn thuốc');
        }
        if (prescription.doctorId !== doctor.doctorId) {
            throw new ForbiddenException('Bạn chỉ có thể đặt lịch tái khám cho đơn thuốc do chính mình kê');
        }
        // Chỉ cho phép đặt tái khám sau khi đơn đã ký — đúng quyết định "Ký số chặn nếu còn
        // alert nặng" + tránh việc tạo lịch tái khám cho 1 đơn còn đang chỉnh sửa (draft).
        if (prescription.status !== 'signed') {
            throw new BadRequestException(
                `Đơn thuốc đang ở trạng thái "${prescription.status}", chỉ có thể đặt lịch tái khám sau khi đã ký (signed).`,
            );
        }

        const departmentId = dto.departmentId ?? prescription.encounter.departmentId;
        const patient = prescription.encounter.patient;

        // Gọi lại AppointmentService.createAtHospital — KHÔNG viết lại logic tạo appointment/
        // phát QueueTicket (xem note quan trọng trong ScheduleFollowupDto về giới hạn "chỉ
        // walk-in hôm nay" của hàm này).
        const { appointment, queueTicket } = await this.appointmentService.createAtHospital(
            {
                patientId: patient.patientId,
                departmentId,
                reasonForVisit: `Tái khám: ${prescription.diagnosis.diagnosisName}`,
                priority: AppointmentPriority.NORMAL,
            },
            currentUser,
        );

        await this.notificationDispatcher.dispatch({
            recipient: {
                patientId: patient.patientId,
                userId: patient.userId ?? undefined,
                email: patient.email ?? undefined,
            },
            notificationType: 'appointment_reminder',
            referenceType: 'appointment',
            referenceId: appointment.appointmentId,
            title: 'Lịch tái khám đã được tạo',
            content:
                `Đơn thuốc ${prescription.prescriptionCode} đã tạo lượt tái khám tại viện, mã lịch hẹn ` +
                `${appointment.appointmentCode}, số thứ tự ${queueTicket.ticketNumber}. Vui lòng đến khoa liên hệ ` +
                `lấy số khi tới tái khám.`,
        });

        return { appointment, queueTicket };
    }
}
