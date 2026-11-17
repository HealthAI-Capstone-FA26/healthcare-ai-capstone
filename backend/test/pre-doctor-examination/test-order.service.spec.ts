import {
    BadRequestException,
    ConflictException,
} from '@nestjs/common';
import { TestOrderService } from '../../src/modules/clinical/pre-doctor-examination/test-order/test-order.service';
import { ORDERABLE_STATUSES } from '../../src/modules/clinical/pre-doctor-examination/common/encounter-status.guard';
import { EncounterStatus } from '../../src/common/utils/encounter-status.util';
import { CreateTestOrderDto } from '../../src/modules/clinical/pre-doctor-examination/test-order/dto/create-test-order.dto';

jest.mock('@nestjs/event-emitter', () => ({
    EventEmitter2: class {},
    OnEvent: () => () => undefined,
}));

describe('TestOrderService - Function 15: create', () => {
    let service: TestOrderService;
    let mockTx: any;
    let mockPrismaService: any;
    let mockActorRoleService: any;
    let mockDoctorService: any;
    let mockAccessService: any;
    let mockEventEmitter: any;

    const encounterId = 'enc-001';
    const currentUserId = 'user-doc-001';
    const diagnosisId = 'diag-init-001';
    const mockDoctor = { doctorId: 'doc-001' };
    const mockEncounter = {
        encounterId,
        patientId: 'pat-001',
        doctorId: 'doc-001',
        status: EncounterStatus.IN_PROGRESS,
    };

    const validInitialDiagnosis = {
        diagnosisId,
        encounterId,
        diagnosisType: 'initial',
        icd10Code: 'I20.0',
    };

    const activeServices = [
        {
            serviceId: 'srv-ecg',
            serviceName: 'Điện tâm đồ 12 chuyển đạo (ECG)',
            price: 150000,
            defaultRoomId: 'room-ecg-01',
            isActive: true,
        },
        {
            serviceId: 'srv-trop',
            serviceName: 'Định lượng Troponin T hs',
            price: 250000,
            defaultRoomId: 'room-lab-01',
            isActive: true,
        },
    ];

    beforeEach(() => {
        mockTx = {
            $executeRaw: jest.fn().mockResolvedValue(1),
            diagnosticOrderItem: {
                findMany: jest.fn(),
                createMany: jest.fn(),
            },
            diagnosticOrder: {
                create: jest.fn(),
            },
            diagnosticTask: {
                createMany: jest.fn(),
            },
            encounter: {
                updateMany: jest.fn(),
            },
        };

        mockPrismaService = {
            diagnosis: {
                findUnique: jest.fn(),
            },
            serviceCatalog: {
                findMany: jest.fn(),
            },
            diagnosticOrder: {
                findUnique: jest.fn(),
            },
            $transaction: jest.fn((callback: (tx: any) => Promise<unknown>) =>
                callback(mockTx),
            ),
        };

        mockActorRoleService = {
            assertActorRole: jest.fn(),
        };

        mockDoctorService = {
            findByUserId: jest.fn(),
        };

        mockAccessService = {
            prepareWrite: jest.fn().mockResolvedValue({
                doctor: mockDoctor,
                encounter: mockEncounter,
            }),
        };

        mockEventEmitter = {
            emit: jest.fn(),
        };

        service = new TestOrderService(
            mockPrismaService as any,
            mockActorRoleService as any,
            mockDoctorService as any,
            mockAccessService as any,
            mockEventEmitter as any,
        );
    });

    // UTCID01: Normal - Tạo phiếu chỉ định cận lâm sàng với 2 dịch vụ hợp lệ (srv-ecg, srv-trop), tạo 2 task payment_pending và chuyển trạng thái awaiting_diagnostics
    it('UTCID01: should create DiagnosticOrder, 2 DiagnosticTasks (payment_pending) and transition Encounter to awaiting_diagnostics', async () => {
        const dto: CreateTestOrderDto = {
            diagnosisId,
            priority: 'routine',
            clinicalIndication: 'Loại trừ hội chứng mạch vành cấp',
            items: [{ serviceId: 'srv-ecg' }, { serviceId: 'srv-trop' }],
        };

        mockPrismaService.diagnosis.findUnique.mockResolvedValue(validInitialDiagnosis);
        mockPrismaService.serviceCatalog.findMany.mockResolvedValue(activeServices);
        // Lần gọi thứ 1 của diagnosticOrder.findUnique là trong generateUniqueCode (trả về null = mã chưa trùng)
        // Lần gọi thứ 2 là trong this.findById(orderId) (trả về full order)
        const fullCreatedOrder = {
            orderId: 'order-001',
            orderCode: 'CD-20261016-001',
            encounterId,
            doctorId: mockDoctor.doctorId,
            diagnosisId,
            status: 'ordered',
            items: [
                {
                    orderItemId: 'item-1',
                    serviceId: 'srv-ecg',
                    task: { status: 'payment_pending' },
                },
                {
                    orderItemId: 'item-2',
                    serviceId: 'srv-trop',
                    task: { status: 'payment_pending' },
                },
            ],
        };
        mockPrismaService.diagnosticOrder.findUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(fullCreatedOrder);

        mockTx.diagnosticOrderItem.findMany.mockResolvedValue([]);
        mockTx.diagnosticOrder.create.mockResolvedValue({ orderId: 'order-001' });
        mockTx.diagnosticOrderItem.createMany.mockResolvedValue({ count: 2 });
        mockTx.diagnosticTask.createMany.mockResolvedValue({ count: 2 });
        mockTx.encounter.updateMany.mockResolvedValue({ count: 1 });

        const result = await service.create(encounterId, dto, currentUserId);

        expect(mockAccessService.prepareWrite).toHaveBeenCalledWith(
            encounterId,
            currentUserId,
            ORDERABLE_STATUSES,
            'chỉ định cận lâm sàng',
        );
        expect(mockTx.diagnosticOrder.create).toHaveBeenCalledTimes(1);
        expect(mockTx.diagnosticOrderItem.createMany).toHaveBeenCalledTimes(1);
        expect(mockTx.diagnosticTask.createMany).toHaveBeenCalledWith({
            data: expect.arrayContaining([
                expect.objectContaining({
                    status: 'payment_pending',
                    paymentVerified: false,
                }),
            ]),
        });
        expect(mockTx.encounter.updateMany).toHaveBeenCalledWith({
            where: {
                encounterId,
                status: {
                    in: [EncounterStatus.IN_PROGRESS, EncounterStatus.AWAITING_REVIEW],
                },
            },
            data: { status: EncounterStatus.AWAITING_DIAGNOSTICS },
        });
        expect(result).toEqual(fullCreatedOrder);
    });

    // UTCID02: Abnormal - Chẩn đoán được tham chiếu không tồn tại hoặc không thuộc lượt khám này -> BadRequestException
    it('UTCID02: should throw BadRequestException when referenced diagnosis does not belong to encounterId or is null', async () => {
        const dto: CreateTestOrderDto = {
            diagnosisId: 'diag-other-enc',
            items: [{ serviceId: 'srv-ecg' }],
        };

        mockPrismaService.diagnosis.findUnique.mockResolvedValue({
            diagnosisId: 'diag-other-enc',
            encounterId: 'enc-999',
            diagnosisType: 'initial',
        });

        await expect(
            service.create(encounterId, dto, currentUserId),
        ).rejects.toThrow(BadRequestException);

        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    // UTCID03: Abnormal - Chẩn đoán được tham chiếu có diagnosisType = "final" (không phải "initial") -> BadRequestException
    it('UTCID03: should throw BadRequestException when referenced diagnosis has diagnosisType !== "initial"', async () => {
        const dto: CreateTestOrderDto = {
            diagnosisId,
            items: [{ serviceId: 'srv-ecg' }],
        };

        mockPrismaService.diagnosis.findUnique.mockResolvedValue({
            diagnosisId,
            encounterId,
            diagnosisType: 'final',
        });

        await expect(
            service.create(encounterId, dto, currentUserId),
        ).rejects.toThrow(BadRequestException);

        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    // UTCID04: Boundary - Danh sách chỉ định gửi lên có 2 dịch vụ trùng nhau ["srv-ecg", "srv-ecg"] -> BadRequestException
    it('UTCID04: should throw BadRequestException when dto.items contains duplicate serviceIds in the request array', async () => {
        const dto: CreateTestOrderDto = {
            diagnosisId,
            items: [{ serviceId: 'srv-ecg' }, { serviceId: 'srv-ecg' }],
        };

        mockPrismaService.diagnosis.findUnique.mockResolvedValue(validInitialDiagnosis);

        await expect(
            service.create(encounterId, dto, currentUserId),
        ).rejects.toThrow(BadRequestException);

        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    // UTCID05: Abnormal - Dịch vụ chỉ định đã ngưng cung cấp (isActive = false) -> BadRequestException
    it('UTCID05: should throw BadRequestException when a requested service has isActive = false', async () => {
        const dto: CreateTestOrderDto = {
            diagnosisId,
            items: [{ serviceId: 'srv-inactive' }],
        };

        mockPrismaService.diagnosis.findUnique.mockResolvedValue(validInitialDiagnosis);
        mockPrismaService.serviceCatalog.findMany.mockResolvedValue([
            {
                serviceId: 'srv-inactive',
                serviceName: 'Xét nghiệm cũ ngưng sử dụng',
                price: 100000,
                isActive: false,
            },
        ]);

        await expect(
            service.create(encounterId, dto, currentUserId),
        ).rejects.toThrow(BadRequestException);

        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    // UTCID06: Abnormal - Dịch vụ "srv-ecg" đã được chỉ định trước đó và task đang ở trạng thái "payment_pending" (chưa hoàn tất) -> ConflictException
    it('UTCID06: should throw ConflictException when service is already ordered and its task is still active (payment_pending)', async () => {
        const dto: CreateTestOrderDto = {
            diagnosisId,
            items: [{ serviceId: 'srv-ecg' }],
        };

        mockPrismaService.diagnosis.findUnique.mockResolvedValue(validInitialDiagnosis);
        mockPrismaService.serviceCatalog.findMany.mockResolvedValue([activeServices[0]]);
        mockPrismaService.diagnosticOrder.findUnique.mockResolvedValueOnce(null);

        mockTx.diagnosticOrderItem.findMany.mockResolvedValue([
            {
                service: { serviceName: 'Điện tâm đồ 12 chuyển đạo (ECG)' },
            },
        ]);

        await expect(
            service.create(encounterId, dto, currentUserId),
        ).rejects.toThrow(ConflictException);

        expect(mockTx.diagnosticOrder.create).not.toHaveBeenCalled();
    });
});

