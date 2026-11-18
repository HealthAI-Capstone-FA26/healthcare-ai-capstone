import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { RequestUser } from '../../../identity-access/auth/strategies/jwt.strategy';
import { CreatePatientAllergyDto } from './dto/create-patient-allergy.dto';
import { UpdatePatientAllergyStatusDto } from './dto/update-patient-allergy-status.dto';
import { FindPatientAllergyQueryDto } from './dto/find-patient-allergy-query.dto';

@Injectable()
export class PatientAllergyService {
  constructor(private readonly prisma: PrismaService) { }

  private async assertPatientExists(patientId: string): Promise<void> {
    const patient = await this.prisma.patient.findUnique({ where: { patientId } });
    if (!patient) {
      throw new NotFoundException('Không tìm thấy bệnh nhân');
    }
  }

  // POST /patients/:patientId/allergies — hồ sơ dài hạn, không gắn với 1 lượt khám. Mỗi lần khai báo tạo 1
  // dòng mới chứa TOÀN BỘ danh sách dị ứng tại thời điểm đó (allergyText); dòng mới nhất có status = active
  // là danh sách hiện hành, các dòng cũ giữ lại làm lịch sử.
  async create(patientId: string, dto: CreatePatientAllergyDto, currentUser: RequestUser) {
    await this.assertPatientExists(patientId);

    return this.prisma.patientAllergy.create({
      data: {
        patientId,
        allergyText: dto.allergyText.trim(),
        recordedByUserId: currentUser.userId,
        recordedAt: new Date(),
      },
    });
  }

  async findByPatientId(patientId: string, query: FindPatientAllergyQueryDto) {
    await this.assertPatientExists(patientId);

    return this.prisma.patientAllergy.findMany({
      where: { patientId, status: query.status },
      orderBy: { recordedAt: 'desc' },
    });
  }

  // PATCH /allergies/:id/status — CHỈ cho đổi status (active/resolved/entered_in_error), không
  // cho sửa allergenName/severity/... (đúng nguyên tắc "không có giới hạn ghi đè, chỉ thêm dòng
  // mới hoặc đổi status" trong module3.md mục 5).
  async updateStatus(allergyId: string, dto: UpdatePatientAllergyStatusDto) {
    const allergy = await this.prisma.patientAllergy.findUnique({ where: { allergyId } });
    if (!allergy) {
      throw new NotFoundException('Không tìm thấy dị ứng đã ghi nhận');
    }
    if (allergy.status === dto.status) {
      throw new BadRequestException(`Dị ứng này đã ở trạng thái '${dto.status}'`);
    }

    return this.prisma.patientAllergy.update({
      where: { allergyId },
      data: { status: dto.status },
    });
  }
}
