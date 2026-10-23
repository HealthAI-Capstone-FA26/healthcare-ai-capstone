import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { RequestUser } from '../../../identity-access/auth/strategies/jwt.strategy';
import { DoctorService } from '../../../identity-access/doctor/doctor.service';
import { UserService } from '../../../identity-access/user/user.service';
import { SignPrescriptionDto } from './dtos/sign-prescription.dto';
import {
    PRESCRIPTION_PDF_GENERATOR_PORT,
    PrescriptionPdfGeneratorPort,
    PrescriptionPdfItemInput,
} from './ports/prescription-pdf-generator.port';
import { PRESCRIPTION_SIGNED_EVENT, PrescriptionSignedEvent } from './events/prescription-signed.event';
import { NotificationDispatcherService } from '../notification/notification-dispatcher.service';
import { DoctorCertificateService } from '../../pki/doctor-certificate.service';
import { PdfSignatureService } from '../../pki/pdf-signature.service';

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
        private readonly notificationDispatcher: NotificationDispatcherService,
        private readonly doctorCertificates: DoctorCertificateService,
        private readonly pdfSignature: PdfSignatureService,
    ) { }

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

        // PKI: lấy chứng thư số còn hiệu lực của bác sĩ (chưa có thì tự cấp nếu PKI_AUTO_ISSUE bật) rồi ký PAdES.
        const certificate = await this.doctorCertificates.getOrIssueForSigning(doctor);
        const signedAt = new Date();
        const pdfSigner = this.pdfSignature.createSigner(certificate, {
            signerName: prescription.doctor.fullName,
            reason: `Ky don thuoc ${prescription.prescriptionCode}`,
            location: process.env.PKI_ORG_NAME?.trim() || 'HealthAI Cardiology Clinic',
            signingTime: signedAt,
        });

        const { url, hash } = await this.pdfGeneratorPort.generateAndUpload({
            prescriptionId: prescription.prescriptionId,
            prescriptionCode: prescription.prescriptionCode,
            patientName: prescription.encounter.patient.fullName,
            patientDateOfBirth: prescription.encounter.patient.dateOfBirth,
            patientGender: prescription.encounter.patient.gender,
            doctorName: prescription.doctor.fullName,
            diagnosisName: prescription.diagnosis.diagnosisName,
            icd10Code: prescription.diagnosis.icd10Code,
            items: this.buildPdfItems(prescription.items),
            createdAt: prescription.createdAt,
            signedAt,
            certificateSerial: certificate.serialNumber,
            certificateIssuer: certificate.issuerDn,
            certificateFingerprint: certificate.fingerprintSha256,
            isSigned: true,
        }, pdfSigner);

        const signedPrescription = await this.prisma.prescription.update({
            where: { prescriptionId },
            data: {
                status: 'signed',
                signedAt,
                certificateSerial: certificate.serialNumber,
                signatureCertificateId: certificate.certificateId,
                signedDocumentHash: hash,
                pdfFileUrl: url,
            },
            include: PRESCRIPTION_FOR_SIGNING_INCLUDE,
        });

        // Gửi thông báo prescription_ready cho bệnh nhân (theo schema SE07)
        const patient = prescription.encounter.patient;
        await this.notificationDispatcher.dispatch({
            recipient: {
                patientId: patient.patientId,
                userId: patient.userId ?? undefined,
                email: patient.email ?? undefined,
            },
            notificationType: 'prescription_ready',
            referenceType: 'prescription',
            referenceId: prescription.prescriptionId,
            title: 'Đơn thuốc đã được bác sĩ ký',
            content: `Đơn thuốc ${prescription.prescriptionCode} cho lượt khám của bạn đã được BS. ${prescription.doctor.fullName} ký số và hoàn tất. Bạn có thể xem đơn thuốc điện tử trên ứng dụng.`,
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

    // GET /prescriptions/:id/verify-signature
    async verifySignature(prescriptionId: string) {
        const prescription = await this.findPrescriptionForSigning(prescriptionId);
        if (prescription.status !== 'signed' || !prescription.signedAt || !prescription.signedDocumentHash) {
            throw new BadRequestException('Đơn thuốc chưa được ký số — không có chữ ký để xác minh.');
        }

        const pdf = await this.pdfGeneratorPort.fetchSignedPdf(prescription.prescriptionId);
        const verification = await this.pdfSignature.verifyPdf(pdf, { signedAt: prescription.signedAt });

        // Đối chiếu thêm với bản ghi trong DB: hash file + đúng chứng thư đã ghi nhận khi ký.
        const actualHash = createHash('sha256').update(pdf).digest('hex');
        const hashOk = actualHash === prescription.signedDocumentHash;
        verification.checks.push({
            code: 'stored_hash',
            ok: hashOk,
            message: hashOk ? 'File PDF khớp mã băm SHA-256 lưu lúc ký.' : 'File PDF KHÔNG khớp mã băm lưu lúc ký — file đã bị thay đổi.',
        });

        const recorded = prescription.signatureCertificateId
            ? await this.doctorCertificates.findById(prescription.signatureCertificateId)
            : null;
        const sameCert = !!recorded && recorded.fingerprintSha256 === verification.signer?.fingerprintSha256;
        verification.checks.push({
            code: 'signer_matches_record',
            ok: sameCert,
            message: sameCert
                ? 'Chứng thư trong chữ ký trùng với chứng thư đã ghi nhận cho đơn thuốc.'
                : 'Chứng thư trong chữ ký KHÔNG trùng với chứng thư đã ghi nhận cho đơn thuốc.',
        });

        const signerIsPrescriber = !!recorded && recorded.doctorId === prescription.doctorId;
        verification.checks.push({
            code: 'signer_is_prescriber',
            ok: signerIsPrescriber,
            message: signerIsPrescriber ? 'Người ký chính là bác sĩ kê đơn.' : 'Người ký KHÔNG phải bác sĩ kê đơn.',
        });

        verification.valid = verification.checks.every((c) => c.ok);
        return { prescriptionId: prescription.prescriptionId, prescriptionCode: prescription.prescriptionCode, signedAt: prescription.signedAt, ...verification };
    }

    // GET /prescriptions/:id/export
    async export(prescriptionId: string) {
        const prescription = await this.findPrescriptionForSigning(prescriptionId);

        if (prescription.status === 'signed' && prescription.pdfFileUrl) {
            return { pdfUrl: prescription.pdfFileUrl, preview: false };
        }

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
            createdAt: prescription.createdAt,
            signedAt: prescription.signedAt ?? new Date(),
            certificateSerial: prescription.certificateSerial ?? '',
            isSigned: false,
        });

        return { pdfUrl: url, preview: true };
    }
}
