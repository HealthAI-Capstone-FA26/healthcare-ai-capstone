import { BadGatewayException, BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { BUCKET_NAME, minioClient } from '../../../../common/configs/upload.config';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { RedisService } from '../../../../redis/redis.service';
import { EncounterService } from './encounter.service';
import { ZaloOaSender } from '../../../platform/notification/zalo-oa.sender';
import { NotificationContactResolver } from '../../../platform/notification/notification-contact.resolver';
import { buildEncounterSummaryPdf } from './encounter-pdf.builder';

/** Xuất PDF phiếu kết quả khám bệnh & tư vấn điều trị (EMR Clinical Summary Report). */
@Injectable()
export class EncounterPdfService {
  private readonly logger = new Logger(EncounterPdfService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encounterService: EncounterService,
    private readonly zaloSender: ZaloOaSender,
    private readonly contactResolver: NotificationContactResolver,
    private readonly redis: RedisService,
  ) { }

  /**
   * Gửi PDF lượt khám cho bệnh nhân qua Zalo OA (best-effort: không bao giờ throw để không làm hỏng
   * nghiệp vụ chính). Zalo user id lấy từ NotificationPreference.destination (kênh zalo_oa).
   */
  async sendViaZalo(
    encounterId: string,
    patientId: string,
  ): Promise<{ sent: boolean; reason?: string }> {
    try {
      if (!this.zaloSender.isConfigured()) {
        return { sent: false, reason: 'ZALO_OA_NOT_CONFIGURED' };
      }
      const contact = await this.contactResolver.resolve(
        { patientId },
        'zalo_oa',
        'registration_confirmed',
      );
      if (!contact.allowed || !contact.destination) {
        return { sent: false, reason: contact.reason ?? 'NO_CONTACT' };
      }
      const { buffer, filename } = await this.generate(encounterId);
      await this.deliverPdf(contact.destination, buffer, filename);
      return { sent: true };
    } catch (err) {
      this.logger.error(`Gửi PDF lượt khám ${encounterId} qua Zalo thất bại: ${err}`);
      return { sent: false, reason: err instanceof Error ? err.message : 'UNKNOWN_ERROR' };
    }
  }

  /**
   * Dùng để test: gửi PDF lượt khám qua Zalo OA tới `zaloUserId` truyền vào (hoặc Zalo id của bệnh nhân
   * nếu bỏ trống). Khác sendViaZalo: lỗi được trả ra (throw) để thấy rõ nguyên nhân.
   */
  async sendToZaloForTest(encounterId: string, zaloUserId?: string) {
    if (!this.zaloSender.isConfigured()) {
      throw new BadRequestException('Chưa cấu hình Zalo (ZALO_BOT_TOKEN hoặc ZALO_OA_*)');
    }
    const encounter = await this.encounterService.findById(encounterId);
    let destination = zaloUserId?.trim();
    if (!destination) {
      const contact = await this.contactResolver.resolve(
        { patientId: encounter.patientId },
        'zalo_oa',
        'registration_confirmed',
      );
      if (!contact.allowed || !contact.destination) {
        throw new BadRequestException(
          `Bệnh nhân chưa có Zalo user id (${contact.reason ?? 'NO_CONTACT'}); hãy truyền zaloUserId trong body`,
        );
      }
      destination = contact.destination;
    }
    const { buffer, filename } = await this.generate(encounterId);
    try {
      await this.deliverPdf(destination, buffer, filename);
    } catch (err) {
      throw new BadGatewayException(err instanceof Error ? err.message : 'Gửi Zalo thất bại');
    }
    return { sent: true, encounterId, zaloUserId: destination, filename, sizeBytes: buffer.length };
  }

  /**
   * Chế độ Zalo Bot không gửi được file -> upload PDF lên S3 rồi gửi LINK tải có hạn ngắn (presigned URL) qua tin văn bản.
   * Chế độ OA: gửi file trực tiếp như cũ. Hạn link chỉnh bằng ZALO_PDF_LINK_TTL_SECONDS (mặc định 3600 = 1 giờ).
   */
  private async deliverPdf(destination: string, buffer: Buffer, filename: string): Promise<void> {
    if (!this.zaloSender.isBotMode()) {
      await this.zaloSender.sendFile(destination, buffer, filename);
      return;
    }
    // Tên object ngẫu nhiên (UUID) để không đoán được đường dẫn; dữ liệu y tế nên để link ngắn hạn
    const objectName = `encounter-pdfs/${randomUUID()}.pdf`;
    await minioClient.putObject(BUCKET_NAME, objectName, buffer, buffer.length, { 'Content-Type': 'application/pdf' });
    const ttl = Number(process.env.ZALO_PDF_LINK_TTL_SECONDS ?? 3600);
    const token = randomUUID();
    await this.redis.setJson(`zalo:pdf:${token}`, { objectName }, ttl);
    const base = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
    const url = `${base}/api/v1/zalo-bot/pdf/${token}`;
    await this.zaloSender.sendText(
      destination,
      `Phiếu khám của bạn (${filename}):\n${url}\nLink có hiệu lực khoảng ${Math.round(ttl / 60)} phút.`,
    );
  }

  async generate(encounterId: string): Promise<{ buffer: Buffer; filename: string }> {
    const encounter = await this.prisma.encounter.findUnique({
      where: { encounterId },
      include: {
        patient: {
          include: {
            allergies: { where: { status: 'active' }, orderBy: { recordedAt: 'desc' } },
            medicalHistories: { orderBy: { createdAt: 'desc' } },
          },
        },
        doctor: true,
        vitalSignSessions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { observations: { include: { item: true } } },
        },
        clinicalExamination: true,
        diagnosticOrders: {
          orderBy: { orderedAt: 'asc' },
          include: {
            items: {
              include: {
                service: true,
                task: {
                  include: {
                    result: {
                      include: {
                        values: {
                          include: { parameter: true },
                          orderBy: { parameter: { displayOrder: 'asc' } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        diagnoses: { orderBy: { diagnosedAt: 'desc' } },
        treatmentConsultation: true,
        followUpAppointment: true,
        prescriptions: {
          orderBy: { createdAt: 'desc' },
          include: {
            items: {
              include: { drug: true },
              orderBy: { prescriptionItemId: 'asc' },
            },
          },
        },
      },
    });

    if (!encounter) {
      throw new NotFoundException('Không tìm thấy lượt khám');
    }

    const buffer = await buildEncounterSummaryPdf(encounter);
    return { buffer, filename: `encounter-${encounter.encounterCode}.pdf` };
  }
}
