import { INestApplication } from '@nestjs/common';
import { client, expectSuccess } from './app';
import { Fixtures, newPatientPayload } from './fixtures';

/**
 * Các bước của workflow "Appointment registration" tại bệnh viện (at-hospital), mỗi bước = 1 hoặc vài API thật.
 * Spec appointment-registration gọi TỪNG bước để assert chi tiết; spec vitals gọi runRegistrationFlow()
 * để đưa 1 encounter tới trạng thái 'registered' (đang chờ ở hàng đợi triage) rồi test tiếp phần sinh hiệu.
 */
export interface FlowContext {
  app: INestApplication;
  fixtures: Fixtures;
}

export const MANDATORY_POLICY_TYPES = ['data_processing', 'treatment_consent'];

export const flow = {
  /** Bước 1: bệnh nhân bốc số tại bệnh viện (không cần đăng nhập). */
  async takeTicket(ctx: FlowContext) {
    return expectSuccess(await client(ctx.app).post('/queue-tickets/at-hospital'), 'take ticket');
  },

  /** Bước 2: lễ tân gọi số. */
  async callTicket(ctx: FlowContext, ticketId: string) {
    const res = await client(ctx.app, ctx.fixtures.receptionist.token).patch(`/queue-tickets/${ticketId}/call`, {
      counterNumber: 'Quầy 1',
    });
    return expectSuccess(res, 'call ticket');
  },

  /** Bước 3: lễ tân nhập thông tin BN mới + chọn bác sĩ -> tạo patient + appointment + invoice phí khám (pending). */
  async serveTicket(ctx: FlowContext, ticketId: string, patient = newPatientPayload()) {
    const res = await client(ctx.app, ctx.fixtures.receptionist.token).patch(`/queue-tickets/${ticketId}/done`, {
      doctorId: ctx.fixtures.doctor.doctorId,
      patient,
      reasonForVisit: 'Đau ngực nhẹ khi gắng sức',
    });
    return expectSuccess(res, 'serve ticket');
  },

  /** Bước 4: thu tiền mặt đủ số tiền invoice (tạo payment pending -> lễ tân xác nhận đã nhận tiền). */
  async payInvoiceByCash(ctx: FlowContext, invoice: { invoiceId: string; totalAmount: string | number }) {
    const http = client(ctx.app, ctx.fixtures.receptionist.token);
    const payment = expectSuccess(
      await http.post('/payments/cash', { invoiceId: invoice.invoiceId, amount: Number(invoice.totalAmount) }),
      'create cash payment',
    );
    const confirmed = expectSuccess(await http.post(`/payments/cash/${payment.paymentId}/confirm`, {}), 'confirm cash payment');
    return { payment, confirmed };
  },

  /** Bước 5: sau khi trả phí khám -> tạo Encounter (appointment confirmed -> checked_in). */
  async createEncounter(ctx: FlowContext, appointmentId: string) {
    const res = await client(ctx.app, ctx.fixtures.receptionist.token).post(`/encounters/from-paid-appointment/${appointmentId}`);
    return expectSuccess(res, 'create encounter');
  },

  /** Bước 6a: khai báo lý do khám. */
  async addChiefComplaint(ctx: FlowContext, encounterId: string) {
    const res = await client(ctx.app, ctx.fixtures.receptionist.token).post(`/encounters/${encounterId}/chief-complaint`, {
      reasonForVisit: 'Đau ngực nhẹ khi gắng sức',
      symptoms: 'Hồi hộp, khó thở khi leo cầu thang',
      painLevel: 3,
      inputChannel: 'receptionist_assisted',
    });
    return expectSuccess(res, 'chief complaint');
  },

  /** Bước 6b: xác minh danh tính. */
  async verifyIdentity(ctx: FlowContext, encounterId: string) {
    const res = await client(ctx.app, ctx.fixtures.receptionist.token).post(`/encounters/${encounterId}/identity-verifications`, {
      verificationMethod: 'national_id_card',
      verificationStatus: 'verified',
    });
    return expectSuccess(res, 'identity verification');
  },

  /** Bước 6c: ký các consent bắt buộc (data_processing, treatment_consent). */
  async signMandatoryConsents(ctx: FlowContext, encounterId: string, patientId: string) {
    const http = client(ctx.app, ctx.fixtures.receptionist.token);
    const consents: any[] = [];
    for (const policyType of MANDATORY_POLICY_TYPES) {
      const policies = expectSuccess(await http.get(`/consent-policies?policyType=${policyType}`), `get policy ${policyType}`);
      if (!Array.isArray(policies) || policies.length === 0) {
        throw new Error(`Không có consent policy '${policyType}' đang hiệu lực — cần chạy "npx prisma db seed".`);
      }
      consents.push(
        expectSuccess(
          await http.post('/consents', {
            patientId,
            encounterId,
            policyId: policies[0].policyId,
            signatureType: 'checkbox_click',
            witnessedAtCounter: true,
          }),
          `sign consent ${policyType}`,
        ),
      );
    }
    return consents;
  },

  /** Bước 7: hoàn tất tiếp đón -> encounter 'registered' + vào hàng đợi triage cho y tá. */
  async completeRegistration(ctx: FlowContext, encounterId: string) {
    const res = await client(ctx.app, ctx.fixtures.receptionist.token).post(`/encounters/${encounterId}/complete-registration`);
    return expectSuccess(res, 'complete registration');
  },
};

/** Chạy trọn workflow appointment-registration, trả về các id cần cho workflow kế tiếp (vitals). */
export async function runRegistrationFlow(ctx: FlowContext) {
  const ticket = await flow.takeTicket(ctx);
  await flow.callTicket(ctx, ticket.ticketId);
  const served = await flow.serveTicket(ctx, ticket.ticketId);
  await flow.payInvoiceByCash(ctx, served.invoice);
  const encounter = await flow.createEncounter(ctx, served.appointment.appointmentId);
  await flow.addChiefComplaint(ctx, encounter.encounterId);
  await flow.verifyIdentity(ctx, encounter.encounterId);
  await flow.signMandatoryConsents(ctx, encounter.encounterId, encounter.patientId);
  const registered = await flow.completeRegistration(ctx, encounter.encounterId);

  return {
    ticketId: ticket.ticketId as string,
    appointmentId: served.appointment.appointmentId as string,
    patientId: encounter.patientId as string,
    encounterId: encounter.encounterId as string,
    triageQueueEntryId: registered.triageQueueEntry.queueEntryId as string,
  };
}
