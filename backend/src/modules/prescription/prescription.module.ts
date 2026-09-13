import { Module } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { DoctorModule } from '../doctor/doctor.module';
import { UserModule } from '../user/user.module';
import { AppointmentRegistrationModule } from '../appointment-registration/appointment-registration.module';
import { DrugCatalogController } from './drug-catalog/drug-catalog.controller';
import { DrugCatalogService } from './drug-catalog/drug-catalog.service';
import { PrescriptionController } from './prescription/prescription.controller';
import { PrescriptionService } from './prescription/prescription.service';
import { DrugInteractionDetector } from './prescription-safety/detectors/drug-interaction.detector';
import { DuplicateTherapeuticClassDetector } from './prescription-safety/detectors/duplicate-therapeutic-class.detector';
import { AllergyContraindicationDetector } from './prescription-safety/detectors/allergy-contraindication.detector';
import { PrescriptionSafetyCheckOrchestrator } from './prescription-safety/orchestrators/prescription-safety-check.orchestrator';
import { PrescriptionSafetyController } from './prescription-safety/prescription-safety.controller';
import { PrescriptionSafetyService } from './prescription-safety/prescription-safety.service';
import { PrescriptionSigningController } from './prescription-signing/prescription-signing.controller';
import { PrescriptionSigningService } from './prescription-signing/prescription-signing.service';
import { PdfLibPrescriptionPdfGeneratorAdapter, PRESCRIPTION_PDF_GENERATOR_PORT } from './prescription-signing/ports/prescription-pdf-generator.port';
import { PrescriptionInvoiceItemsAdapter, PRESCRIPTION_INVOICE_ITEMS_PORT } from './prescription-signing/ports/prescription-invoice-items.port';
import { PrescriptionFollowupController } from './prescription-followup/prescription-followup.controller';
import { PrescriptionFollowupService } from './prescription-followup/prescription-followup.service';
import { NotificationDispatcherService } from './notification/notification-dispatcher.service';
import { EmailNotificationStrategy } from './notification/strategies/email-notification.strategy';
import { DefaultEmailSenderAdapter, EMAIL_SENDER_PORT } from './notification/ports/email-sender.port';

@Module({
    imports: [DoctorModule, UserModule, AppointmentRegistrationModule],
    controllers: [
        DrugCatalogController,
        PrescriptionController,
        PrescriptionSafetyController,
        PrescriptionSigningController,
        PrescriptionFollowupController,
    ],
    providers: [
        PrismaService,
        DrugCatalogService,
        PrescriptionService,
        DrugInteractionDetector,
        DuplicateTherapeuticClassDetector,
        AllergyContraindicationDetector,
        PrescriptionSafetyCheckOrchestrator,
        PrescriptionSafetyService,
        PrescriptionSigningService,
        PrescriptionFollowupService,
        NotificationDispatcherService,
        EmailNotificationStrategy,
        { provide: PRESCRIPTION_PDF_GENERATOR_PORT, useClass: PdfLibPrescriptionPdfGeneratorAdapter },
        { provide: PRESCRIPTION_INVOICE_ITEMS_PORT, useClass: PrescriptionInvoiceItemsAdapter },
        { provide: EMAIL_SENDER_PORT, useClass: DefaultEmailSenderAdapter },
    ],
    // PRESCRIPTION_INVOICE_ITEMS_PORT export sẵn để module Thanh toán (Module 6) inject khi
    // invoice.service.ts được xây (Phase 5 kế hoạch module 9) — không cần sửa lại module này.
    exports: [PrescriptionService, PRESCRIPTION_INVOICE_ITEMS_PORT],
})
export class PrescriptionModule {}
