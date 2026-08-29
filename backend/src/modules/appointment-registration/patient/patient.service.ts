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
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { SearchPatientDto } from './dto/search-patient.dto';
import { MatchSuggestionQueryDto } from './dto/match-suggestion-query.dto';

const PATIENT_CODE_PREFIX = 'BN';

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
  ) {
    const patientCode = await this.generatePatientCode();

    return tx.patient.create({
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
      },
    });
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
}

function maskTail(value: string | null | undefined, visibleTail = 3): string | null { // che để lộ 3 số cuối
  if (!value) return null;
  if (value.length <= visibleTail) return value;
  return `${'*'.repeat(value.length - visibleTail)}${value.slice(-visibleTail)}`;
}