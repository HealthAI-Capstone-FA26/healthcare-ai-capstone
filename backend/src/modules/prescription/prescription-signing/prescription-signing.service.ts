import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../prisma/prisma.service';
import { RequestUser } from '../../auth/strategies/jwt.strategy';
import { DoctorService } from '../../doctor/doctor.service';
import { UserService } from '../../user/user.service';
import { SignPrescriptionDto } from './dtos/sign-prescription.dto';
import {
    PRESCRIPTION_PDF_GENERATOR_PORT,
    PrescriptionPdfGeneratorPort,
    PrescriptionPdfItemInput,
} from './ports/prescription-pdf-generator.port';
import { PRESCRIPTION_SIGNED_EVENT, PrescriptionSignedEvent } from './events/prescription-signed.event';

const SEVERITY_BLOCKING_SIGN = new Set(['severe', 'contraindicated']);

const PRESCRIPTION_FOR_SIGNING_INCLUDE = {
    items: { include: { drug: true } },
    safetyAlerts: true,
    doctor: true,
    diagnosis: { include: { icd10: true } },
    encounter: { include: { patient: true } },
} satisfies Prisma.PrescriptionInclude;

@Injectable()
export class PrescriptionSigningService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly doctorService: DoctorService,
        private readonly userService: UserService,
        @Inject(PRESCRIPTION_PDF_GENERATOR_PORT)
        private readonly pdfGeneratorPort: PrescriptionPdfGeneratorPort,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    private async findPrescriptionForSigning(prescriptionId: string) {
        const prescription = await this.prisma.prescription.findUnique({
            where: { prescriptionId },
            include: PRESCRIPTION_FOR_SIGNING_INCLUDE,
        });

        if (!prescription) {
            throw new NotFoundException('Không tìm thấy đơn thuốc');
        }
        return prescription;
    }

    private buildPdfItems(
        items: Prisma.PrescriptionGetPayload<{ include: typeof PRESCRIPTION_FOR_SIGNING_INCLUDE }>['items'],
    ): PrescriptionPdfItemInput[] {
        return items.map((item) => ({
            drugName: item.drug.drugName,
            strength: item.drug.strength,
            quantity: Number(item.quantity),
            unit: item.drug.unit,
            dosage: item.dosage,
            routeDisplay: item.routeDisplay,
            frequency: item.frequency,
            durationDays: item.durationDays,
            instruction: item.instruction,
        }));
    }

    // POST /prescriptions/:id/sign
    async sign(prescriptionId: string, dto: SignPrescriptionDto, currentUser: RequestUser) {
        const doctor = await this.doctorService.findByUserId(currentUser.userId);
        const prescription = await this.findPrescriptionForSigning(prescriptionId);

        if (prescription.doctorId !== doctor.doctorId) {
            throw new ForbiddenException('Bạn chỉ có thể ký đơn thuốc do chính mình kê');
        }
        if (prescription.status !== 'draft') {
            throw new ForbiddenException(
                `Đơn thuốc đang ở trạng thái "${prescription.status}", chỉ có thể ký khi còn ở trạng thái nháp (draft)`,
            );
        }
        if (prescription.items.length === 0) {
            throw new BadRequestException('Đơn thuốc chưa có dòng thuốc nào, không thể ký');
        }

        const blockingAlert = prescription.safetyAlerts.find(
            (alert) => alert.status === 'active' && SEVERITY_BLOCKING_SIGN.has(alert.severity),
        );
        if (blockingAlert) {
            throw new ForbiddenException(
                'Đơn thuốc còn cảnh báo an toàn mức độ nặng (severe/contraindicated) chưa được xác nhận — vui lòng xử lý cảnh báo trước khi ký.',
            );
        }

        const user = await this.userService.findById(currentUser.userId);
        if (!user) {
            throw new UnauthorizedException('Người dùng không tồn tại');
        }
        const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
        if (!isPasswordValid) {
            throw new UnauthorizedException('Mật khẩu không chính xác, không thể xác nhận ký số');
        }

        const signedAt = new Date();
        const certificateSerial = randomUUID();

        const { url } = await this.pdfGeneratorPort.generateAndUpload({
            prescriptionId: prescription.prescriptionId,
            prescriptionCode: prescription.prescriptionCode,
            patientName: prescription.encounter.patient.fullName,
            patientDateOfBirth: prescription.encounter.patient.dateOfBirth,
            patientGender: prescription.encounter.patient.gender,
            doctorName: prescription.doctor.fullName,
            diagnosisName: prescription.diagnosis.diagnosisName,
            icd10Code: prescription.diagnosis.icd10Code,
            items: this.buildPdfItems(prescription.items),
            issuedAt: prescription.issuedAt,
            signedAt,
            certificateSerial,
            isSigned: true,
        });

        const signedPrescription = await this.prisma.prescription.update({
            where: { prescriptionId },
            data: {
                status: 'signed',
                signedAt,
                certificateSerial,
                pdfFileUrl: url,
                // "Đồng bộ Dược" (Phase 5 kế hoạch module 9) = đã phát event, coi như đã bàn giao
                // cho phía Dược/Thanh toán xử lý khi các module đó được xây.
                syncedToPharmacyAt: signedAt,
            },
            include: { items: { include: { drug: true } }, safetyAlerts: true },
        });

        this.eventEmitter.emit(
            PRESCRIPTION_SIGNED_EVENT,
            new PrescriptionSignedEvent(
                prescription.prescriptionId,
                prescription.encounterId,
                prescription.encounter.patientId,
            ),
        );

        return signedPrescription;
    }

    // GET /prescriptions/:id/export
    async export(prescriptionId: string) {
        const prescription = await this.findPrescriptionForSigning(prescriptionId);

        if (prescription.status === 'signed' && prescription.pdfFileUrl) {
            return { pdfUrl: prescription.pdfFileUrl, preview: false };
        }

        // Còn draft (hoặc đã signed nhưng thiếu pdfFileUrl vì lý do bất thường) -> sinh bản xem
        // trước, KHÔNG set pdfFileUrl lên Prescription (chỉ ký thật mới chốt file chính thức).
        // Dùng object path riêng (hậu tố "-preview") để không đè lên file PDF đã ký chính thức.
        const { url } = await this.pdfGeneratorPort.generateAndUpload({
            prescriptionId: `${prescription.prescriptionId}-preview`,
            prescriptionCode: prescription.prescriptionCode,
            patientName: prescription.encounter.patient.fullName,
            patientDateOfBirth: prescription.encounter.patient.dateOfBirth,
            patientGender: prescription.encounter.patient.gender,
            doctorName: prescription.doctor.fullName,
            diagnosisName: prescription.diagnosis.diagnosisName,
            icd10Code: prescription.diagnosis.icd10Code,
            items: this.buildPdfItems(prescription.items),
            issuedAt: prescription.issuedAt,
            signedAt: prescription.signedAt ?? new Date(),
            certificateSerial: prescription.certificateSerial ?? '',
            isSigned: false,
        });

        return { pdfUrl: url, preview: true };
    }
}
