import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ActorRoleService } from '../../user/actor-role.service';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import { EncounterStatus } from '../../../common/utils/encounter-status.util';
import { generateUniqueCode } from '../../../common/utils/code-generator.util';
import { CreateTestOrderDto } from './dto/create-test-order.dto';
import { CancelTestOrderItemDto } from './dto/cancel-test-order-item.dto';
import { OrderItemCancelledEvent, ORDER_ITEM_CANCELLED_EVENT } from './events/order-item-cancelled.event';

const TEST_ORDER_CODE_PREFIX = 'XN'; // "Xét Nghiệm" — theo cùng quy ước 2 ký tự với BN/LH/BS/LK
const LAB_TASK_INITIAL_STATUS = 'payment_pending';
const TEST_ORDER_ITEM_TERMINAL_STATUSES = ['completed', 'cancelled'];

/**
 * Module 5, mục "Gợi ý chỉ định" (phần bác sĩ chốt chỉ định): tạo TestOrder + TestOrderItem.
 *
 * ĐÂY LÀ "module Order" mà lab-test module (Module 7 — tiếp nhận xét nghiệm) đã tham chiếu qua
 * comment sẵn có: mỗi TestOrderItem được tạo phải kéo theo đúng 1 LabTask ở trạng thái khởi tạo
 * 'payment_pending' để bàn giao sang quy trình xử lý mẫu/thanh toán của lab-test — xem
 * lab-test.module.ts và LabTaskService. Việc huỷ 1 hạng mục cũng phát ra ORDER_ITEM_CANCELLED_EVENT
 * đúng contract mà LabTaskOrderCancellationListener của lab-test đã lắng nghe sẵn, để LabTask
 * tương ứng được cascade huỷ theo — không có module nào phải gọi trực tiếp sang module kia.
 */
@Injectable()
export class TestOrderService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly actorRoleService: ActorRoleService,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    async create(encounterId: string, dto: CreateTestOrderDto, currentUserId: string) {
        await this.actorRoleService.assertActorRole(currentUserId, [ACTOR_ROLE.DOCTOR]);

        const encounter = await this.prisma.encounter.findUnique({ where: { encounterId } });
        if (!encounter) {
            throw new NotFoundException(`Không tìm thấy lượt khám ${encounterId}`);
        }
        if (encounter.status === EncounterStatus.CANCELLED || encounter.status === EncounterStatus.FINISHED) {
            throw new BadRequestException(
                `Lượt khám đang ở trạng thái '${encounter.status}', không thể chỉ định xét nghiệm mới.`,
            );
        }

        if (dto.diagnosisId) {
            const diagnosis = await this.prisma.diagnosis.findUnique({ where: { diagnosisId: dto.diagnosisId } });
            if (!diagnosis || diagnosis.encounterId !== encounterId) {
                throw new BadRequestException('Chẩn đoán được tham chiếu không thuộc lượt khám này.');
            }
        }

        const testTypeIds = [...new Set(dto.items.map((item) => item.testTypeId))];
        const testTypes = await this.prisma.testCatalog.findMany({ where: { testTypeId: { in: testTypeIds } } });
        const testTypeMap = new Map(testTypes.map((t) => [t.testTypeId, t]));

        for (const item of dto.items) {
            const testType = testTypeMap.get(item.testTypeId);
            if (!testType) {
                throw new NotFoundException(`Không tìm thấy danh mục xét nghiệm ${item.testTypeId}`);
            }
            if (!testType.isActive) {
                throw new BadRequestException(`Danh mục xét nghiệm '${testType.testName}' đã ngưng cung cấp`);
            }
        }

        const orderCode = await generateUniqueCode(TEST_ORDER_CODE_PREFIX, async (code) => {
            const existing = await this.prisma.testOrder.findUnique({ where: { orderCode: code } });
            return Boolean(existing);
        });

        const orderId = await this.prisma.$transaction(async (tx) => {
            const order = await tx.testOrder.create({
                data: {
                    orderCode,
                    encounterId,
                    orderedByUserId: currentUserId,
                    diagnosisId: dto.diagnosisId,
                    notes: dto.notes,
                    orderedAt: new Date(),
                },
            });

            for (const item of dto.items) {
                const testType = testTypeMap.get(item.testTypeId)!;

                const orderItem = await tx.testOrderItem.create({
                    data: {
                        orderId: order.orderId,
                        testTypeId: item.testTypeId,
                        wasAiSuggested: item.wasAiSuggested ?? false,
                        unitPrice: testType.price,
                    },
                });

                // Bàn giao sang lab-test (Module 7): 1 TestOrderItem <-> 1 LabTask.
                await tx.labTask.create({
                    data: {
                        orderItemId: orderItem.orderItemId,
                        labRoomId: testType.defaultLabRoomId,
                        status: LAB_TASK_INITIAL_STATUS,
                        paymentVerified: false,
                    },
                });
            }

            return order.orderId;
        });

        return this.findById(orderId);
    }

    async findById(orderId: string) {
        const order = await this.prisma.testOrder.findUnique({
            where: { orderId },
            include: {
                diagnosis: { include: { icd10: true } },
                items: { include: { testType: true, labTask: true } },
            },
        });

        if (!order) {
            throw new NotFoundException(`Không tìm thấy chỉ định xét nghiệm ${orderId}`);
        }
        return order;
    }

    async findByEncounterId(encounterId: string) {
        return this.prisma.testOrder.findMany({
            where: { encounterId },
            orderBy: { orderedAt: 'desc' },
            include: { items: { include: { testType: true, labTask: true } } },
        });
    }

    async cancelItem(orderItemId: string, dto: CancelTestOrderItemDto, currentUserId: string) {
        await this.actorRoleService.assertActorRole(currentUserId, [ACTOR_ROLE.DOCTOR]);

        const item = await this.prisma.testOrderItem.findUnique({ where: { orderItemId } });
        if (!item) {
            throw new NotFoundException(`Không tìm thấy hạng mục xét nghiệm ${orderItemId}`);
        }
        if (TEST_ORDER_ITEM_TERMINAL_STATUSES.includes(item.status)) {
            throw new BadRequestException(`Không thể huỷ hạng mục đang ở trạng thái '${item.status}'.`);
        }

        const updated = await this.prisma.testOrderItem.update({
            where: { orderItemId },
            data: { status: 'cancelled' },
        });

        // Cascade sang LabTask tương ứng thông qua event — không gọi trực tiếp LabTaskService
        // của module lab-test (giữ 2 module tách biệt, chỉ liên lạc qua event contract).
        this.eventEmitter.emit(
            ORDER_ITEM_CANCELLED_EVENT,
            new OrderItemCancelledEvent(orderItemId, currentUserId, dto.reason),
        );

        return updated;
    }
}
