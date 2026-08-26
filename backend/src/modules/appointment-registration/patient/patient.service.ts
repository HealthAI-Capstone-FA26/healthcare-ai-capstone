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

    // Self-service: user chỉ có quyền own -> patient này là của chính họ.
    const existingSelf = await this.prisma.patient.findUnique({
      where: { userId: currentUser.userId },
    });
    if (existingSelf) {
      throw new ConflictException('Bạn đã có hồ sơ bệnh nhân, không thể tạo thêm');
    }

    return this.createPatientRecord(dto, currentUser.userId);
  }

  private async createPatientRecord(
    dto: CreatePatientDto,
    userId: string | null,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
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

  async update(patientId: string, dto: UpdatePatientDto) {
    await this.findById(patientId);

    return this.prisma.patient.update({
      where: { patientId },
      data: {
        ...dto,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
      },
    });
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
      if (!approvedContact) {
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

    if (patient.userId !== null) {
      throw new ConflictException('Hồ sơ bệnh nhân này đã được liên kết với một tài khoản');
    }

    const existingSelfPatient = await this.prisma.patient.findUnique({
      where: { userId: currentUser.userId },
    });
    if (existingSelfPatient && existingSelfPatient.patientId !== patientId) {
      throw new ConflictException('Tài khoản của bạn đã liên kết với một hồ sơ bệnh nhân khác');
    }

    return this.prisma.patient.update({
      where: { patientId },
      data: { userId: currentUser.userId },
    });
  }


}

function maskTail(value: string | null | undefined, visibleTail = 3): string | null { // che để lộ 3 số cuối
  if (!value) return null;
  if (value.length <= visibleTail) return value;
  return `${'*'.repeat(value.length - visibleTail)}${value.slice(-visibleTail)}`;
}