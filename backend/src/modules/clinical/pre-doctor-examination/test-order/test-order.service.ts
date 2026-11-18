import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { ActorRoleService } from '../../../identity-access/user/actor-role.service';
import { DoctorService } from '../../../identity-access/doctor/doctor.service';
import { ACTOR_ROLE } from '../../../../common/constants/actor-role.constant';
import { EncounterStatus } from '../../../../common/utils/encounter-status.util';
import { generateUniqueCode } from '../../../../common/utils/code-generator.util';
import { ORDERABLE_STATUSES, assertEncounterStatusIn } from '../common/encounter-status.guard';
import { DoctorEncounterAccessService } from '../common/doctor-encounter-access.service';
import { CreateTestOrderDto } from './dto/create-test-order.dto';
import { CancelTestOrderItemDto } from './dto/cancel-test-order-item.dto';
import { OrderItemCancelledEvent, ORDER_ITEM_CANCELLED_EVENT } from './events/order-item-cancelled.event';

const DIAGNOSTIC_ORDER_CODE_PREFIX = 'CD'; // "Chỉ Định" — gồm cả xét nghiệm máu, ECG, X-quang, siêu âm tim
const TASK_INITIAL_STATUS = 'payment_pending';
const DIAGNOSIS_TYPE_INITIAL = 'initial';
/** Task còn có thể huỷ chỉ định. 'in_progress'/'completed' đã thực hiện -> dùng luồng đính chính kết quả. */
const TASK_CANCELLABLE_STATUSES = ['payment_pending', 'ready', 'on_hold'];
/** Task đã xong/huỷ -> dịch vụ đó có thể chỉ định lại. Còn lại = đang "sống", chặn chỉ định trùng. */
const TASK_FINISHED_STATUSES = ['cancelled', 'completed'];

/**
 * SE02 — Bác sĩ chốt chỉ định cận lâm sàng: DiagnosticOrder + DiagnosticOrderItem (+ DiagnosticTask).
 *
 * Bàn giao sang lab-test (SE04): mỗi DiagnosticOrderItem tạo kèm đúng 1 DiagnosticTask 'payment_pending'
 * TRONG CÙNG transaction (coupling có chủ đích, đảm bảo atomic). Huỷ hạng mục: item + task được huỷ nguyên tử
 * trong 1 transaction (task đã thực hiện thì từ chối), sau đó phát ORDER_ITEM_CANCELLED_EVENT để lab-test
 * tính lại trạng thái Order/Encounter (DiagnosticProgressService) — hai module không gọi trực tiếp nhau.
 *
 * Encounter: tạo chỉ định chuyển in_progress | awaiting_review -> awaiting_diagnostics. Các chuyển trạng thái
 * sau đó (diagnostics_in_progress, awaiting_review) thuộc lab-test.
 */
@Injectable()
export class TestOrderService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly actorRoleService: ActorRoleService,
        private readonly doctorService: DoctorService,
        private readonly access: DoctorEncounterAccessService,
        private readonly eventEmitter: EventEmitter2,
    ) { }

    async create(encounterId: string, dto: CreateTestOrderDto, currentUserId: string) {
        const { doctor } = await this.access.prepareWrite(
            encounterId,
            currentUserId,
            ORDERABLE_STATUSES,
            'chỉ định cận lâm sàng',
        );

        const diagnosis = await this.prisma.diagnosis.findUnique({ where: { diagnosisId: dto.diagnosisId } });
        if (!diagnosis || diagnosis.encounterId !== encounterId) {
            throw new BadRequestException('Chẩn đoán được tham chiếu không thuộc lượt khám này.');
        }
        if (diagnosis.diagnosisType !== DIAGNOSIS_TYPE_INITIAL) {
            throw new BadRequestException(
                `Chỉ định phải dựa trên chẩn đoán ban đầu (initial), chẩn đoán được chọn là '${diagnosis.diagnosisType}'.`,
            );
        }

        const serviceIds = dto.items.map((item) => item.serviceId);
        if (new Set(serviceIds).size !== serviceIds.length) {
            throw new BadRequestException('Danh sách chỉ định có dịch vụ bị trùng.');
        }

        const services = await this.prisma.serviceCatalog.findMany({ where: { serviceId: { in: serviceIds } } });
        const serviceMap = new Map(services.map((s) => [s.serviceId, s]));
        for (const serviceId of serviceIds) {
            const service = serviceMap.get(serviceId);
            if (!service) {
                throw new NotFoundException(`Không tìm thấy dịch vụ cận lâm sàng ${serviceId}`);
            }
            if (!service.isActive) {
                throw new BadRequestException(`Dịch vụ '${service.serviceName}' đã ngưng cung cấp`);
            }
        }

        const priority = dto.priority ?? 'routine';
        const orderCode = await generateUniqueCode(DIAGNOSTIC_ORDER_CODE_PREFIX, async (code) => {
            const existing = await this.prisma.diagnosticOrder.findUnique({ where: { orderCode: code } });
            return Boolean(existing);
        });

        const orderId = await this.prisma.$transaction(async (tx) => {
            // Serialize theo lượt khám: double-click / 2 tab cùng chỉ định không được tạo trùng dịch vụ.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`test-order:${encounterId}`}))`;

            const alreadyActive = await tx.diagnosticOrderItem.findMany({
                where: {
                    serviceId: { in: serviceIds },
                    status: 'ordered',
                    order: { encounterId },
                    OR: [{ task: { is: null } }, { task: { is: { status: { notIn: TASK_FINISHED_STATUSES } } } }],
                },
                select: { service: { select: { serviceName: true } } },
            });
            if (alreadyActive.length > 0) {
                throw new ConflictException(
                    `Dịch vụ đã được chỉ định và chưa hoàn tất trong lượt khám này: ${alreadyActive
                        .map((i) => i.service.serviceName)
                        .join(', ')}.`,
                );
            }

            const order = await tx.diagnosticOrder.create({
                data: {
                    orderCode,
                    encounterId,
                    doctorId: doctor.doctorId,
                    diagnosisId: dto.diagnosisId,
                    priority,
                    clinicalIndication: dto.clinicalIndication,
                    notes: dto.notes,
                    status: 'ordered',
                    orderedAt: new Date(),
                },
            });

            // 3 câu lệnh cố định (order + createMany items + createMany tasks) thay vì 2N câu lệnh tuần tự.
            const rows = serviceIds.map((serviceId) => ({ orderItemId: randomUUID(), service: serviceMap.get(serviceId)! }));
            await tx.diagnosticOrderItem.createMany({
                data: rows.map(({ orderItemId, service }) => ({
                    orderItemId,
                    orderId: order.orderId,
                    serviceId: service.serviceId,
                    unitPrice: service.price, // snapshot giá tại thời điểm chỉ định
                })),
            });
            await tx.diagnosticTask.createMany({
                data: rows.map(({ orderItemId, service }) => ({
                    orderItemId,
                    diagnosticRoomId: service.defaultRoomId,
                    priority,
                    status: TASK_INITIAL_STATUS,
                    paymentVerified: false,
                })),
            });

            // updateMany + điều kiện status: an toàn khi có 2 request đồng thời, không ghi đè trạng thái đã đi xa hơn.
            await tx.encounter.updateMany({
                where: {
                    encounterId,
                    status: { in: [EncounterStatus.IN_PROGRESS, EncounterStatus.AWAITING_REVIEW] },
                },
                data: { status: EncounterStatus.AWAITING_DIAGNOSTICS },
            });

            return order.orderId;
        });

        return this.findById(orderId);
    }

    async findById(orderId: string) {
        const order = await this.prisma.diagnosticOrder.findUnique({
            where: { orderId },
            include: {
                diagnosis: { include: { icd10: true } },
                items: { include: { service: true, task: true } },
            },
        });

        if (!order) {
            throw new NotFoundException(`Không tìm thấy chỉ định cận lâm sàng ${orderId}`);
        }
        return order;
    }

    async findByEncounterId(encounterId: string) {
        return this.prisma.diagnosticOrder.findMany({
            where: { encounterId },
            orderBy: { orderedAt: 'desc' },
            include: { items: { include: { service: true, task: true } } },
        });
    }

    async cancelItem(orderItemId: string, dto: CancelTestOrderItemDto, currentUserId: string) {
        await this.actorRoleService.assertActorRole(currentUserId, [ACTOR_ROLE.DOCTOR]);
        const doctor = await this.doctorService.findByUserId(currentUserId);

        const item = await this.prisma.diagnosticOrderItem.findUnique({
            where: { orderItemId },
            include: {
                task: true,
                order: { select: { orderId: true, encounterId: true, encounter: { select: { encounterId: true, status: true, doctorId: true } } } },
            },
        });
        if (!item) {
            throw new NotFoundException(`Không tìm thấy hạng mục chỉ định ${orderItemId}`);
        }
        const { encounter } = item.order;
        this.access.assertOwnedBy(encounter, doctor.doctorId);
        assertEncounterStatusIn(encounter.status, ORDERABLE_STATUSES, 'huỷ chỉ định');

        if (item.status !== 'ordered') {
            throw new BadRequestException(`Không thể huỷ hạng mục đang ở trạng thái '${item.status}'.`);
        }

        const updated = await this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`test-order:${encounter.encounterId}`}))`;

            // "Giành quyền huỷ" nguyên tử: chỉ huỷ khi item còn 'ordered' VÀ task chưa được phòng thực hiện bắt đầu.
            // Kiểm tra rồi mới ghi (check-then-act) sẽ hở: phòng Lab nhận task đúng lúc bác sĩ bấm huỷ.
            const claimed = await tx.diagnosticOrderItem.updateMany({
                where: { orderItemId, status: 'ordered' },
                data: { status: 'cancelled' },
            });
            if (claimed.count === 0) {
                throw new BadRequestException('Hạng mục đã được huỷ trước đó.');
            }

            if (item.task) {
                const taskCancelled = await tx.diagnosticTask.updateMany({
                    where: { orderItemId, status: { in: TASK_CANCELLABLE_STATUSES } },
                    data: { status: 'cancelled' },
                });
                if (taskCancelled.count === 0) {
                    // Ném lỗi trong transaction -> rollback luôn việc huỷ item ở trên.
                    throw new ConflictException(
                        'Hạng mục đã/đang được thực hiện, không thể huỷ chỉ định. Nếu kết quả sai, dùng luồng đính chính kết quả.',
                    );
                }
            }

            const remaining = await tx.diagnosticOrderItem.count({
                where: { orderId: item.orderId, status: 'ordered' },
            });
            if (remaining === 0) {
                await tx.diagnosticOrder.update({ where: { orderId: item.orderId }, data: { status: 'cancelled' } });
            }

            return tx.diagnosticOrderItem.findUniqueOrThrow({ where: { orderItemId }, include: { task: true } });
        });

        // Phát SAU khi commit. Lab-test nhận event để tính lại trạng thái Order/Encounter (idempotent) — không gọi trực tiếp.
        this.eventEmitter.emit(
            ORDER_ITEM_CANCELLED_EVENT,
            new OrderItemCancelledEvent(orderItemId, currentUserId, dto.reason),
        );

        return updated;
    }
}
