import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { RequestUser } from '../../auth/strategies/jwt.strategy';
import { Action, Resource, Scope } from '../../../common/constants/permissions.dictionary';
import { hasPermissionScope } from '../../../common/utils/permission.util';
import { generateUniqueCode } from '../../../common/utils/code-generator.util';
import { isPendingRelationship } from '../../../common/constants/patient-contact.constants';
import { PatientContactService } from '../patientContact/patient-contact.service';
import { PatientStatus } from '../../../common/constants/patient-status.constants';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { SearchPatientDto } from './dto/search-patient.dto';
import { MatchSuggestionQueryDto } from './dto/match-suggestion-query.dto';
import { ConfirmMainPatientDto } from './dto/confirm-main-patient.dto';

const PATIENT_CODE_PREFIX = 'BN';

// PATCH /patients/:id/confirm-main: insuranceNumber là thông tin bổ sung, không bắt buộc khi
// đổi status draft -> main. Các field còn lại phải có đủ sau khi merge dữ liệu request.
const CONFIRM_MAIN_REQUIRED_FIELDS: { field: 'fullName' | 'dateOfBirth' | 'gender' | 'identityNumber' | 'phoneNumber'; label: string }[] = [
  { field: 'fullName', label: 'Họ tên' },
  { field: 'dateOfBirth', label: 'Ngày sinh' },
  { field: 'gender', label: 'Giới tính' },
  { field: 'identityNumber', label: 'CCCD/CMND' },
  { field: 'phoneNumber', label: 'Số điện thoại' },
];

@Injectable()
export class PatientService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientContactService: PatientContactService,
  ) { }

  private generatePatientCode(): Promise<string> {
    return generateUniqueCode(PATIENT_CODE_PREFIX, async (code) => {
      const existing = await this.prisma.patient.findUnique({ where: { patientCode: code } });
      return Boolean(existing);// Trả về true nếu có data (trùng), false nếu null
    });
  }

  //POST /patient
  async create(dto: CreatePatientDto, currentUser: RequestUser) {
    const isStaffCreatingForCounter = hasPermissionScope(
      currentUser.permissions,
      Resource.PATIENT,
      Action.CREATE,
      Scope.GROUP,
    );

    if (isStaffCreatingForCounter) {
      return this.createPatientRecord(dto, null);
    }

    let rel = dto.relationship || 'self';
    if (rel === 'Bản thân') rel = 'self';
    else if (rel === 'Con cái') rel = 'child';
    else if (rel === 'Bố/Mẹ' || rel === 'Cha mẹ') rel = 'parent';
    else if (rel === 'Vợ/Chồng') rel = 'spouse';

    // Validation: Mỗi tài khoản chỉ được có duy nhất 1 hồ sơ "Bản thân"
    if (rel === 'self') {
      const existingSelfContact = await this.prisma.patientContact.findFirst({
        where: {
          userId: currentUser.userId,
          relationship: 'self',
        },
      });
      if (existingSelfContact) {
        throw new ConflictException('Tài khoản của bạn đã có 1 hồ sơ Bản thân, không thể tạo thêm hồ sơ Bản thân mới');
      }
    }

    // Trường hợp tạo hồ sơ cho người thân (Con cái, Bố mẹ, Vợ/chồng...)
    if (rel !== 'self') {
      const newPatient = await this.createPatientRecord(dto, null);

      await this.prisma.patientContact.create({
        data: {
          userId: currentUser.userId,
          patientId: newPatient.patientId,
          relationship: rel,
          isPrimaryContact: false,
        },
      });

      return {
        ...newPatient,
        relationship: rel,
      };
    }

    // Self-service: Tạo hồ sơ cho chính bản thân
    const existingSelf = await this.prisma.patient.findUnique({
      where: { userId: currentUser.userId },
    });
    if (existingSelf) {
      throw new ConflictException('Bạn đã có hồ sơ bệnh nhân bản thân, không thể tạo thêm hồ sơ bản thân');
    }

    const selfPatient = await this.createPatientRecord(dto, currentUser.userId);

    await this.prisma.patientContact.upsert({
      where: {
        userId_patientId: {
          userId: currentUser.userId,
          patientId: selfPatient.patientId,
        },
      },
      update: {
        relationship: 'self',
      },
      create: {
        userId: currentUser.userId,
        patientId: selfPatient.patientId,
        relationship: 'self',
        isPrimaryContact: true,
      },
    });

    return {
      ...selfPatient,
      relationship: 'self',
    };
  }

  private async createPatientRecord(
    dto: CreatePatientDto,
    userId: string | null,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
    status: PatientStatus = PatientStatus.MAIN,
  ) {
    const duplicateConditions: Prisma.PatientWhereInput[] = [
      { identityNumber: dto.identityNumber },
    ];

    if (dto.insuranceNumber) {
      duplicateConditions.push({ insuranceNumber: dto.insuranceNumber });
    }
    if (dto.email) {
      duplicateConditions.push({ email: { equals: dto.email, mode: 'insensitive' } });
    }

    const duplicatePatient = await tx.patient.findFirst({
      where: { OR: duplicateConditions },
      select: {
        identityNumber: true,
        insuranceNumber: true,
        email: true,
      },
    });

    if (duplicatePatient) {
      if (duplicatePatient.identityNumber === dto.identityNumber) {
        throw new ConflictException('Số CCCD/CMND đã được sử dụng');
      }
      if (dto.insuranceNumber && duplicatePatient.insuranceNumber === dto.insuranceNumber) {
        throw new ConflictException('Số bảo hiểm đã được sử dụng');
      }
      throw new ConflictException('Email đã được sử dụng');
    }

    const patientCode = await this.generatePatientCode();

    try {
      return await tx.patient.create({
        data: {
          patientCode,
          userId,
          fullName: dto.fullName,
          dateOfBirth: new Date(dto.dateOfBirth),
          gender: dto.gender,
          identityNumber: dto.identityNumber,
          insuranceNumber: dto.insuranceNumber,
          phoneNumber: dto.phoneNumber,
          email: dto.email,
          address: dto.address,
          ethnicity: dto.ethnicity,
          // Tạo qua các luồng đã xác thực (tự đăng ký tài khoản / lễ tân tạo tại quầy) ->
          // coi là hồ sơ chính thức ngay (status mặc định = MAIN). Chỉ luồng đặt lịch guest (đã
          // xác thực OTP nhưng không đủ field khớp hồ sơ main có sẵn) mới truyền status=DRAFT
          // qua createDraftPatientRecord — xem GuestAppointmentService.
          status,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = Array.isArray(error.meta?.target) ? error.meta.target.join(',') : '';
        if (target.includes('identity_number')) {
          throw new ConflictException('Số CCCD/CMND đã được sử dụng');
        }
        if (target.includes('insurance_number')) {
          throw new ConflictException('Số bảo hiểm đã được sử dụng');
        }
        throw new ConflictException('Thông tin bệnh nhân đã tồn tại');
      }
      throw error;
    }
  }

  // Dùng bởi GuestAppointmentService (Phase 2) khi guest đặt lịch nhưng KHÔNG đủ >=2 field khớp
  // với 1 patient status='main' có sẵn — tạo patient mới với status='draft' (không có userId,
  // không tạo PatientContact). Tái dùng nguyên logic check trùng identityNumber/insuranceNumber/
  // email của createPatientRecord, chỉ khác status; PHẢI truyền `tx` để nằm trong cùng transaction
  // với bước tạo Appointment.
  async createDraftPatientRecord(dto: CreatePatientDto, tx: Prisma.TransactionClient) {
    return this.createPatientRecord(dto, null, tx, PatientStatus.DRAFT);
  }

  async findById(patientId: string) {
    const patient = await this.prisma.patient.findUnique({ where: { patientId } });
    if (!patient) {
      throw new NotFoundException('Không tìm thấy hồ sơ bệnh nhân');
    }
    return patient;
  }

  search(query: SearchPatientDto) {
    const { search } = query;

    return this.prisma.patient.findMany({
      where: search
        ? {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' } },
            { identityNumber: { contains: search, mode: 'insensitive' } },// tìm kiếm k phân biệt chữ hoa chữ thường mode:'sensitive'
            { patientCode: { contains: search, mode: 'insensitive' } },
          ],
        }
        : undefined,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async update(patientId: string, dto: UpdatePatientDto, currentUser?: RequestUser) {
    await this.findById(patientId);

    const { relationship, ...patientData } = dto;

    const updatedPatient = await this.prisma.patient.update({
      where: { patientId },
      data: {
        ...patientData,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
      },
    });

    if (currentUser?.userId && relationship) {
      let rel = relationship;
      if (rel === 'Bản thân') rel = 'self';
      else if (rel === 'Con cái') rel = 'child';
      else if (rel === 'Bố/Mẹ' || rel === 'Cha mẹ') rel = 'parent';
      else if (rel === 'Vợ/Chồng') rel = 'spouse';

      if (rel === 'self') {
        const existingSelfContact = await this.prisma.patientContact.findFirst({
          where: {
            userId: currentUser.userId,
            relationship: 'self',
            patientId: { not: patientId },
          },
        });
        if (existingSelfContact) {
          throw new ConflictException(
            'Tài khoản của bạn đã có 1 hồ sơ Bản thân khác. Mỗi tài khoản chỉ được có duy nhất 1 hồ sơ Bản thân!',
          );
        }
      }

      await this.prisma.patientContact.upsert({
        where: {
          userId_patientId: {
            userId: currentUser.userId,
            patientId: patientId,
          },
        },
        update: {
          relationship: rel,
        },
        create: {
          userId: currentUser.userId,
          patientId: patientId,
          relationship: rel,
          isPrimaryContact: rel === 'self',
        },
      });
    }

    return updatedPatient;
  }

  //GET /patients/match-suggestion: user vừa đăng ký xong, kiểm tra có Patient (userId = null) nào khớp CCCD/BHYT/SĐT không.
  async findMatchSuggestion(currentUser: RequestUser, query: MatchSuggestionQueryDto) {
    let phoneNumber = query.phoneNumber

    if (!phoneNumber) {
      const profile = await this.prisma.userProfile.findUnique({
        where: { userId: currentUser.userId }
      })
      phoneNumber = profile?.phoneNumber ?? undefined
    } console.log(currentUser.userId, currentUser.permissions);

    if (!query.identityNumber && !query.insuranceNumber && !phoneNumber) {
      throw new BadRequestException(
        'Cần ít nhất một trong: Thông tin định danh, số bảo hiểm y tế, hoặc số điện thoại đã đăng ký',
      );
    }
    const orConditions: Prisma.PatientWhereInput[] = [];
    if (query.identityNumber) orConditions.push({ identityNumber: query.identityNumber });
    if (query.insuranceNumber) orConditions.push({ insuranceNumber: query.insuranceNumber });
    if (phoneNumber) orConditions.push({ phoneNumber });

    const candidate = await this.prisma.patient.findFirst({
      where: { userId: null, OR: orConditions },
    });// tìm user_id null

    if (!candidate) {
      return { matched: false };
    }
    return {
      matched: true,
      patient: {
        patientId: candidate.patientId,
        patientCode: candidate.patientCode,
        fullName: candidate.fullName,
        dateOfBirth: candidate.dateOfBirth,
        maskedIdentityNumber: maskTail(candidate.identityNumber),
        maskedPhoneNumber: maskTail(candidate.phoneNumber),
      },
    };
  }

  // GET /patients/:id/full (hoặc mở rộng GET /patients/:id) — quyền xem toàn bộ hồ sơ.
  async getFullProfile(patientId: string, currentUser: RequestUser) {
    const patient = await this.findById(patientId);

    const isStaff =
      hasPermissionScope(currentUser.permissions, Resource.PATIENT, Action.READ, Scope.ALL) ||
      hasPermissionScope(currentUser.permissions, Resource.PATIENT, Action.READ, Scope.GROUP);

    if (!isStaff) {
      const approvedContact = await this.patientContactService.findApprovedContact(
        currentUser.userId,
        patientId,
      );
      if (!approvedContact && patient.userId !== currentUser.userId) {
        throw new ForbiddenException('Bạn không có quyền xem hồ sơ bệnh nhân này');
      }
    }

    return patient;
  }

  // GET /patients/my — danh sách patient mà currentUser có PatientContact đã duyệt (relationship "sạch").
  async listMyPatients(currentUser: RequestUser) {
    const contacts = await this.prisma.patientContact.findMany({
      where: { userId: currentUser.userId },
      include: { patient: true },
      orderBy: { createdAt: 'asc' },
    });

    return contacts
      .filter((contact) => !isPendingRelationship(contact.relationship))
      .map((contact) => ({
        ...contact.patient,
        relationship: contact.relationship,
        isPrimaryContact: contact.isPrimaryContact,
      }));
  }

  async linkUser(patientId: string, currentUser: RequestUser) {
    const patient = await this.findById(patientId);

    if (patient.userId !== null && patient.userId !== currentUser.userId) {
      throw new ConflictException('Hồ sơ bệnh nhân này đã được liên kết với một tài khoản');
    }

    const existingSelfPatient = await this.prisma.patient.findUnique({
      where: { userId: currentUser.userId },
    });
    if (existingSelfPatient && existingSelfPatient.patientId !== patientId) {
      throw new ConflictException('Tài khoản của bạn đã liên kết với một hồ sơ bệnh nhân khác');
    }

    const updated = await this.prisma.patient.update({
      where: { patientId },
      data: { userId: currentUser.userId },
    });

    await this.prisma.patientContact.upsert({
      where: {
        userId_patientId: {
          userId: currentUser.userId,
          patientId: patientId,
        },
      },
      update: {
        relationship: 'self',
      },
      create: {
        userId: currentUser.userId,
        patientId: patientId,
        relationship: 'self',
        isPrimaryContact: true,
      },
    });

    return updated;
  }

  // PATCH /patients/:id/confirm-main — lễ tân xác nhận danh tính bệnh nhân (thường là bệnh nhân
  // guest đặt lịch qua OTP, patient được tạo với status='draft') -> chuyển sang 'main' (hồ sơ
  // chính thức). Từ lúc này patient KHÔNG còn bị CleanupDraftPatientsCron dọn dẹp nữa.
  // Chỉ cho đổi status khi đang ở 'draft' (không cho gọi lại nếu đã 'main' hoặc trạng thái khác),
  // và phải có đủ 5 field bắt buộc: fullName/dateOfBirth/gender/identityNumber/phoneNumber.
  // insuranceNumber chỉ được cập nhật thêm nếu receptionist gửi lên, không bắt buộc phải có.
  async confirmMain(patientId: string, dto: ConfirmMainPatientDto) {
    const patient = await this.findById(patientId);

    if (patient.status !== PatientStatus.DRAFT) {
      throw new BadRequestException(
        `Chỉ có thể xác nhận hồ sơ đang ở trạng thái 'draft', hồ sơ này hiện đang ở trạng thái '${patient.status}'`,
      );
    }

    const mergedPatient = {
      ...patient,
      ...dto,
    };
    const missingLabels = CONFIRM_MAIN_REQUIRED_FIELDS.filter(({ field }) =>
      isBlank(mergedPatient[field]),
    ).map(({ label }) => label);

    if (missingLabels.length > 0) {
      throw new BadRequestException(`Thiếu: ${missingLabels.join(', ')}`);
    }

    const duplicateConditions: Prisma.PatientWhereInput[] = [];
    if (dto.identityNumber && dto.identityNumber !== patient.identityNumber) {
      duplicateConditions.push({ identityNumber: dto.identityNumber });
    }
    if (dto.insuranceNumber && dto.insuranceNumber !== patient.insuranceNumber) {
      duplicateConditions.push({ insuranceNumber: dto.insuranceNumber });
    }

    if (duplicateConditions.length > 0) {
      const duplicatePatient = await this.prisma.patient.findFirst({
        where: {
          patientId: { not: patientId },
          OR: duplicateConditions,
        },
        select: { identityNumber: true, insuranceNumber: true },
      });
      if (duplicatePatient) {
        if (duplicatePatient.identityNumber === dto.identityNumber) {
          throw new ConflictException('Số CCCD/CMND đã được sử dụng');
        }
        throw new ConflictException('Số bảo hiểm đã được sử dụng');
      }
    }

    const updateData: Prisma.PatientUpdateInput = { status: PatientStatus.MAIN };
    if (dto.fullName !== undefined) updateData.fullName = dto.fullName;
    if (dto.dateOfBirth !== undefined) updateData.dateOfBirth = new Date(dto.dateOfBirth);
    if (dto.gender !== undefined) updateData.gender = dto.gender;
    if (dto.identityNumber !== undefined) updateData.identityNumber = dto.identityNumber;
    if (dto.insuranceNumber !== undefined) updateData.insuranceNumber = dto.insuranceNumber;
    if (dto.phoneNumber !== undefined) updateData.phoneNumber = dto.phoneNumber;

    try {
      return await this.prisma.patient.update({
        where: { patientId },
        data: updateData,
      });
    } catch (error) {
      // Khó xảy ra vì patient đã tồn tại từ trước (identityNumber/insuranceNumber không đổi ở
      // bước này) — bắt cho chắc, không cần check trùng thêm vì DB đã có unique constraint.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = Array.isArray(error.meta?.target) ? error.meta.target.join(',') : '';
        if (target.includes('identity_number')) {
          throw new ConflictException('Số CCCD/CMND đã được sử dụng');
        }
        if (target.includes('insurance_number')) {
          throw new ConflictException('Số bảo hiểm đã được sử dụng');
        }
        throw new ConflictException('Thông tin bệnh nhân đã tồn tại');
      }
      throw error;
    }
  }
}

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  return false;
}

function maskTail(value: string | null | undefined, visibleTail = 3): string | null { // che để lộ 3 số cuối
  if (!value) return null;
  if (value.length <= visibleTail) return value;
  return `${'*'.repeat(value.length - visibleTail)}${value.slice(-visibleTail)}`;
}