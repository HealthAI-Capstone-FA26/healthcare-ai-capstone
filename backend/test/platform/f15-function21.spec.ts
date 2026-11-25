import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueTicketStatus } from '../../src/common/constants/queue-ticket.constants';
import { EncounterStatus } from '../../src/common/utils/encounter-status.util';
import { LabCompletionNotificationService } from '../../src/modules/lab-test/lab-completion/lab-completion-notification.service';
import { NotificationDispatcherService } from '../../src/modules/lab-test/notification/notification-dispatcher.service';
import { AuditLogService } from '../../src/modules/platform/audit-log/audit-log.service';
import {
  AUDIT_ACTION,
  AUDIT_OUTCOME,
} from '../../src/modules/platform/audit-log/audit-log.constants';
import { NotificationContactResolver } from '../../src/modules/platform/notification/notification-contact.resolver';
import { NOTIFICATION_STATUS } from '../../src/modules/platform/notification/notification.constants';
import { NotificationService } from '../../src/modules/platform/notification/notification.service';
import { StageEventCollector } from '../../src/modules/platform/statistics/stage-event.collector';
import { StatisticsService } from '../../src/modules/platform/statistics/statistics.service';

describe('Function21 - F-15 (Notification, Statistics, Audit) across WF01..WF05 (TC-F21-01..12)', () => {
  let prismaMock: any;
  let dispatcherMock: { dispatch: jest.Mock };
  let configMock: { get: jest.Mock };
  let contactResolverMock: { resolve: jest.Mock };

  let labCompletionNotificationService: LabCompletionNotificationService;
  let statisticsService: StatisticsService;
  let stageEventCollector: StageEventCollector;
  let notificationService: NotificationService;
  let auditLogService: AuditLogService;

  beforeEach(() => {
    prismaMock = {
      encounter: {
        findUnique: jest.fn(),
      },
      diagnosticTask: {
        count: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      diagnosticOrder: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      diagnosis: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      stageStatistic: {
        findMany: jest.fn(),
      },
      queueTicket: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      invoice: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      triageQueueEntry: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      doctorQueueEntry: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      notification: {
        create: jest.fn().mockResolvedValue({ notificationId: 'notif-01' }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ auditId: BigInt(1) }),
        groupBy: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
    };

    dispatcherMock = {
      dispatch: jest.fn().mockResolvedValue(undefined),
    };

    configMock = {
      get: jest.fn().mockReturnValue('14'),
    };

    contactResolverMock = {
      resolve: jest.fn().mockResolvedValue({ allowed: true, destination: 'patient@clinic.vn' }),
    };

    const zaloDeliveryMock = {
      sendResultsForEncounter: jest.fn().mockResolvedValue(undefined),
    };

    labCompletionNotificationService = new LabCompletionNotificationService(
      prismaMock as unknown as PrismaService,
      dispatcherMock as unknown as NotificationDispatcherService,
      zaloDeliveryMock as any,
    );

    statisticsService = new StatisticsService(
      prismaMock as unknown as PrismaService,
      configMock as unknown as ConfigService,
    );

    stageEventCollector = new StageEventCollector(prismaMock as unknown as PrismaService);

    notificationService = new NotificationService(
      prismaMock as unknown as PrismaService,
      contactResolverMock as unknown as NotificationContactResolver,
    );

    auditLogService = new AuditLogService(prismaMock as unknown as PrismaService);
  });

  // =========================================================================
  // WF03: TC-F21-01..03 (Paraclinical Lab Testing & ECG Completion Alerts)
  // =========================================================================
  describe('WF03: TC-F21-01..03 — Lab & ECG Diagnostics Completion Notifications', () => {
    it('TC-F21-01 (UTCID01) [N]: notifyEncounterCompleted dispatches diagnostics_completed to Doctor (in_app) and Patient (in_app, email, zalo_oa) when encounter reaches awaiting_review', async () => {
      prismaMock.encounter.findUnique.mockResolvedValue({
        status: EncounterStatus.AWAITING_REVIEW,
        encounterCode: 'LK-2026-001',
        patient: { patientId: 'pat-01', email: 'patient@example.com' },
        doctor: { userId: 'doc-user-01', user: { email: 'doctor@hospital.vn' } },
      });
      prismaMock.diagnosticTask.count.mockResolvedValue(2);

      await labCompletionNotificationService.notifyEncounterCompleted('enc-01');

      expect(dispatcherMock.dispatch).toHaveBeenCalledTimes(2);
      expect(dispatcherMock.dispatch).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          notificationType: 'diagnostics_completed',
          referenceId: 'enc-01',
          recipient: { userId: 'doc-user-01', email: 'doctor@hospital.vn' },
        }),
        ['in_app'],
      );
      expect(dispatcherMock.dispatch).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          notificationType: 'diagnostics_completed',
          referenceId: 'enc-01',
          recipient: { patientId: 'pat-01', email: 'patient@example.com' },
        }),
        ['in_app', 'email', 'zalo_oa'],
      );
    });

    it('TC-F21-02 (UTCID02) [B]: notifyEncounterCompleted dispatches alert to Patient only and logs warning when doctor is unassigned (null)', async () => {
      prismaMock.encounter.findUnique.mockResolvedValue({
        status: EncounterStatus.AWAITING_REVIEW,
        encounterCode: 'LK-2026-002',
        patient: { patientId: 'pat-02', email: 'patient2@example.com' },
        doctor: null,
      });
      prismaMock.diagnosticTask.count.mockResolvedValue(1);

      await labCompletionNotificationService.notifyEncounterCompleted('enc-02');

      expect(dispatcherMock.dispatch).toHaveBeenCalledTimes(1);
      expect(dispatcherMock.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          notificationType: 'diagnostics_completed',
          referenceId: 'enc-02',
          recipient: { patientId: 'pat-02', email: 'patient2@example.com' },
        }),
        ['in_app', 'email', 'zalo_oa'],
      );
    });

    it('TC-F21-03 (UTCID03) [A]: notifyEncounterCompleted skips notification when encounter is still in diagnostics_in_progress', async () => {
      prismaMock.encounter.findUnique.mockResolvedValue({
        status: EncounterStatus.DIAGNOSTICS_IN_PROGRESS,
        encounterCode: 'LK-2026-003',
        patient: { patientId: 'pat-03', email: 'patient3@example.com' },
        doctor: { userId: 'doc-user-01', user: { email: 'doctor@hospital.vn' } },
      });

      await labCompletionNotificationService.notifyEncounterCompleted('enc-03');

      expect(dispatcherMock.dispatch).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // WF01: TC-F21-04..06 (Booking, Reception Queue ETA & Triage/Vitals Stage Logging)
  // =========================================================================
  describe('WF01: TC-F21-04..06 — Reception Queue ETA & Stage Wait-Time Logging', () => {
    it('TC-F21-04 (UTCID04) [N]: estimateForQueueTicket calculates accurate wait time prioritizing Online (Type A) before Walk-in (Type B)', async () => {
      const ticketDate = new Date('2026-11-12T00:00:00.000Z');
      const walkInTicket = {
        ticketId: 't-walkin-B001',
        ticketPrefix: 'B',
        ticketNumber: 1,
        ticketDate,
        status: QueueTicketStatus.WAITING,
        issuedAt: new Date('2026-11-12T01:00:00.000Z'),
        appointment: null,
      };
      const onlineTicket = {
        ticketId: 't-online-A001',
        ticketPrefix: 'A',
        ticketNumber: 1,
        ticketDate,
        status: QueueTicketStatus.WAITING,
        issuedAt: new Date('2026-11-12T01:05:00.000Z'),
        appointment: { priority: 'normal' },
      };

      prismaMock.queueTicket.findUnique.mockResolvedValue(walkInTicket);
      prismaMock.queueTicket.findMany
        .mockResolvedValueOnce([walkInTicket, onlineTicket]) // waiting tickets
        .mockResolvedValueOnce([{ counterNumber: 1 }]); // 1 active counter

      prismaMock.stageStatistic.findMany
        .mockResolvedValueOnce([{ sampleCount: 6, avgProcessSec: 120 }]) // hourly
        .mockResolvedValueOnce([{ sampleCount: 20, avgProcessSec: 150 }]); // daily

      const eta = await statisticsService.estimateForQueueTicket('t-walkin-B001');

      // Online ticket A001 is sorted ahead of Walk-in ticket B001 -> ahead = 1, wait = 120s
      expect(eta).toEqual(
        expect.objectContaining({
          ticketId: 't-walkin-B001',
          ticketLabel: 'B001',
          ahead: 1,
          basis: 'hourly',
          avgServiceSec: 120,
          estimatedWaitSec: 120,
        }),
      );
    });

    it('TC-F21-05 (UTCID05) [A]: estimateForQueueTicket & estimateWait throw NotFoundException / BadRequestException on invalid ticket or stage', async () => {
      prismaMock.queueTicket.findUnique.mockResolvedValue(null);
      await expect(
        statisticsService.estimateForQueueTicket('non-existent-ticket'),
      ).rejects.toThrow(NotFoundException);

      await expect(
        statisticsService.estimateWait('invalid_stage', { ahead: 2, servers: 1 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('TC-F21-06 (UTCID06) [N]: StageEventCollector.collect extracts reception_queue, payment, triage_wait, and vitals stage timestamps from WF01', async () => {
      const issuedAt = new Date('2026-11-12T01:00:00.000Z');
      const calledAt = new Date('2026-11-12T01:05:00.000Z');
      const checkinTime = new Date('2026-11-12T01:08:00.000Z');

      prismaMock.queueTicket.findMany.mockResolvedValueOnce([
        {
          ticketId: 'ticket-A001',
          issuedAt,
          calledAt,
          appointment: {
            encounter: { encounterId: 'enc-wf01' },
            receptionCheckins: [{ checkinTime }],
          },
        },
      ]);
      prismaMock.triageQueueEntry.findMany.mockResolvedValueOnce([
        {
          queueEntryId: 'triage-01',
          encounterId: 'enc-wf01',
          enteredQueueAt: checkinTime,
          calledAt: new Date('2026-11-12T01:10:00.000Z'),
          startedAt: new Date('2026-11-12T01:11:00.000Z'),
          completedAt: new Date('2026-11-12T01:14:00.000Z'),
        },
      ]);

      const samples = await stageEventCollector.collect('2026-11-12');
      const stages = samples.map((s) => s.stage);

      expect(stages).toEqual(
        expect.arrayContaining(['reception_queue', 'reception_checkin', 'triage_wait', 'vitals']),
      );
    });
  });

  // =========================================================================
  // WF02: TC-F21-07..08 (Initial Exam, Test Order Cancellation Audit & Payment Alert)
  // =========================================================================
  describe('WF02: TC-F21-07..08 — Diagnostics Payment Notification & Test Order Cancellation Audit', () => {
    it('TC-F21-07 (UTCID07) [N]: NotificationService.enqueue creates payment_success notification (in_app sent, email/zalo_oa queued, skips non-milestone SMS)', async () => {
      const count = await notificationService.enqueue({
        recipient: { patientId: 'pat-wf02', userId: 'user-pat-wf02' },
        notificationType: 'payment_success',
        referenceType: 'invoice',
        referenceId: 'inv-diag-01',
        title: 'Thanh toán phí cận lâm sàng thành công',
        content: 'Hoá đơn xét nghiệm đã thanh toán, mời bạn tới phòng cận lâm sàng.',
      });

      // 4 channels total minus 'sms' (since payment_success is not in SMS_MILESTONE_TYPES) = 3 notifications
      expect(count).toBe(3);
      expect(prismaMock.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            notificationType: 'payment_success',
            channel: 'in_app',
            status: NOTIFICATION_STATUS.SENT,
          }),
        }),
      );
    });

    it('TC-F21-08 (UTCID08) [N]: AuditLogService.recordHttp logs doctor test-order item cancellation with reason field in WF02 (DS-06)', async () => {
      const encounterUuid = '22222222-2222-3333-4444-555555555555';
      const itemUuid = '33333333-2222-3333-4444-555555555555';
      prismaMock.user.findUnique.mockResolvedValue({ role: { roleCode: 'DOCTOR' } });
      prismaMock.encounter.findUnique.mockResolvedValue({ patientId: 'pat-wf02' });

      const req = {
        method: 'PATCH',
        originalUrl: `/api/v1/encounters/${encounterUuid}/test-orders/items/${itemUuid}/cancel`,
        user: { userId: 'doc-user-01' },
        body: { cancellationReason: 'Recently scanned at external clinic' },
        query: {},
        headers: { 'user-agent': 'Chrome/130.0' },
        ip: '127.0.0.1',
      } as unknown as Request;

      const res = { statusCode: 200 } as unknown as Response;

      await auditLogService.recordHttp(req, res, 'req-wf02-cancel');

      expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: 'doc-user-01',
          actorRole: 'DOCTOR',
          action: AUDIT_ACTION.UPDATE,
          encounterId: encounterUuid,
          patientId: 'pat-wf02',
          outcome: AUDIT_OUTCOME.SUCCESS,
          changes: expect.objectContaining({
            fields: ['cancellationReason'],
          }),
        }),
      });
    });
  });

  // =========================================================================
  // WF04: TC-F21-09..10 (Final Diagnosis, Prescription Ready / Follow-up Reminder & PKI Sign Audit)
  // =========================================================================
  describe('WF04: TC-F21-09..10 — Prescription/Follow-up Notifications & Digital Signature Audit', () => {
    it('TC-F21-09 (UTCID09) [B]: NotificationService.enqueue dispatches prescription_ready across all 4 channels (including SMS milestone) and queues future follow_up_reminder', async () => {
      const immediateCount = await notificationService.enqueue({
        recipient: { patientId: 'pat-wf04', userId: 'user-pat-wf04' },
        notificationType: 'prescription_ready',
        referenceType: 'prescription',
        referenceId: 'presc-01',
        title: 'Đơn thuốc điện tử đã được ký số',
        content: 'Đơn thuốc của bạn đã sẵn sàng trên ứng dụng và Zalo OA.',
      });

      // prescription_ready is in SMS_MILESTONE_TYPES -> all 4 channels (in_app, email, sms, zalo_oa) created
      expect(immediateCount).toBe(4);

      const futureDate = new Date(Date.now() + 14 * 24 * 3600 * 1000);
      await notificationService.enqueue({
        recipient: { patientId: 'pat-wf04', userId: 'user-pat-wf04' },
        notificationType: 'follow_up_reminder',
        referenceType: 'appointment',
        referenceId: 'apt-followup-01',
        title: 'Nhắc lịch tái khám tim mạch',
        content: 'Bạn có lịch tái khám sau 14 ngày.',
        scheduledAt: futureDate,
        channels: ['in_app'],
      });

      // Boundary: future scheduledAt forces even 'in_app' to stay QUEUED until scheduled time
      expect(prismaMock.notification.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            notificationType: 'follow_up_reminder',
            channel: 'in_app',
            status: NOTIFICATION_STATUS.QUEUED,
            scheduledAt: futureDate,
          }),
        }),
      );
    });

    it('TC-F21-10 (UTCID10) [N]: AuditLogService.recordHttp records AUDIT_ACTION.SIGN when doctor digitally signs e-prescription in WF04', async () => {
      const prescriptionUuid = '44444444-2222-3333-4444-555555555555';
      prismaMock.user.findUnique.mockResolvedValue({ role: { roleCode: 'DOCTOR' } });

      const req = {
        method: 'POST',
        originalUrl: `/api/v1/prescriptions/${prescriptionUuid}/sign`,
        user: { userId: 'doc-user-01' },
        body: { pin: '123456', password: 'secret-cert-password' },
        query: {},
        headers: { 'user-agent': 'Chrome/130.0' },
        ip: '127.0.0.1',
      } as unknown as Request;

      const res = { statusCode: 200 } as unknown as Response;

      await auditLogService.recordHttp(req, res, 'req-wf04-sign');

      expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: 'doc-user-01',
          actorRole: 'DOCTOR',
          action: AUDIT_ACTION.SIGN,
          resourceType: 'prescriptions',
          resourceId: prescriptionUuid,
          outcome: AUDIT_OUTCOME.SUCCESS,
        }),
      });
    });
  });

  // =========================================================================
  // WF05: TC-F21-11..12 (Account Registration, Profile Linking & Patient History Access Audit)
  // =========================================================================
  describe('WF05: TC-F21-11..12 — Registration/Profile Masking Audit & Patient History Access Summary', () => {
    it('TC-F21-11 (UTCID11) [A]: AuditLogService.recordHttp logs denied/failed auth & masks sensitive fields during WF05 account/profile update', async () => {
      const patientUuid = '55555555-2222-3333-4444-555555555555';
      prismaMock.user.findUnique.mockResolvedValue({ role: { roleCode: 'PATIENT' } });

      const req = {
        method: 'PATCH',
        originalUrl: `/api/v1/patients/${patientUuid}`,
        user: { userId: 'user-patient-01' },
        body: {
          phone: '0901234567',
          nationalId: '079205001234',
          passwordHash: 'sensitive-hash',
          otpCode: '123456',
        },
        query: {},
        headers: { 'user-agent': 'ExpoMobileApp/1.0' },
        ip: '127.0.0.1',
      } as unknown as Request;

      const res = { statusCode: 403 } as unknown as Response;

      await auditLogService.recordHttp(req, res, 'req-wf05-link');

      expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: 'user-patient-01',
          actorRole: 'PATIENT',
          action: AUDIT_ACTION.UPDATE,
          resourceType: 'patients',
          patientId: patientUuid,
          outcome: AUDIT_OUTCOME.DENIED,
          changes: expect.objectContaining({
            statusCode: 403,
            fields: ['phone', 'nationalId'], // passwordHash and otpCode are stripped
          }),
        }),
      });
    });

    it('TC-F21-12 (UTCID12) [N]: AuditLogService.patientAccessSummary aggregates PHI read/write access history for a patient in WF05', async () => {
      const patientUuid = '55555555-2222-3333-4444-555555555555';
      const lastAccess = new Date('2026-11-12T08:00:00.000Z');
      prismaMock.auditLog.groupBy.mockResolvedValue([
        {
          actorUserId: 'user-patient-01',
          actorRole: 'PATIENT',
          action: AUDIT_ACTION.READ,
          outcome: AUDIT_OUTCOME.SUCCESS,
          _count: { _all: 5 },
          _max: { occurredAt: lastAccess },
        },
      ]);

      const summary = await auditLogService.patientAccessSummary(patientUuid, {});

      expect(summary).toEqual({
        patientId: patientUuid,
        actors: [
          {
            actorUserId: 'user-patient-01',
            actorRole: 'PATIENT',
            action: 'read',
            outcome: 'success',
            count: 5,
            lastAccessAt: lastAccess,
          },
        ],
      });
    });
  });
});
