import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { DoctorDepartmentService } from './doctor-department.service';
import { AssignDoctorDepartmentDto } from './dto/assign-doctor-department.dto';
import { UpdateDoctorDepartmentDto } from './dto/update-doctor-department.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { Action, Resource, Scope } from '../../../common/constants/permissions.dictionary';

// Không đặt @Controller() prefix chung vì route trải trên 2 "tài nguyên" (doctors/*, departments/*)
// theo đúng path spec yêu cầu.
@ApiTags('Doctor Departments')
@ApiBearerAuth()
// @UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class DoctorDepartmentController {
  constructor(private readonly doctorDepartmentService: DoctorDepartmentService) { }

  @Post('doctors/:id/departments')
  // @RequirePermissions(`${Resource.DOCTOR_DEPARTMENT}:${Action.CREATE}:${Scope.ALL}`)
  @ApiOperation({ summary: 'Gán bác sĩ vào khoa, set isPrimary — chỉ admin' })
  assign(@Param('id') doctorId: string, @Body() dto: AssignDoctorDepartmentDto) {
    return this.doctorDepartmentService.assign(doctorId, dto);
  }

  @Patch('doctor-departments/:id')
  // @RequirePermissions(`${Resource.DOCTOR_DEPARTMENT}:${Action.UPDATE}:${Scope.ALL}`)
  @ApiParam({
    name: 'id',
    description: 'Composite key theo dạng doctorId_departmentId',
    example: '7e19bb0b-fec2-4ab7-b7ee-e98919ef2a1e_2d8f7c3a-5b91-4e6a-9c20-123456789abc',
  })
  @ApiOperation({
    summary: 'Sửa isPrimary (đổi khoa chính) — id dạng "doctorId_departmentId", chỉ admin',
  })
  update(@Param('id') id: string, @Body() dto: UpdateDoctorDepartmentDto) {
    return this.doctorDepartmentService.updatePrimary(id, dto.isPrimary);
  }

  @Delete('doctor-departments/:id')
  // @RequirePermissions(`${Resource.DOCTOR_DEPARTMENT}:${Action.DELETE}:${Scope.ALL}`)
    @ApiParam({
    name: 'id',
    description: 'Composite key theo dạng doctorId_departmentId',
    example: '7e19bb0b-fec2-4ab7-b7ee-e98919ef2a1e_2d8f7c3a-5b91-4e6a-9c20-123456789abc',
  })
  @ApiOperation({
    summary: 'Gỡ bác sĩ khỏi 1 khoa — id dạng "doctorId_departmentId", chỉ admin',
  })
  remove(@Param('id') id: string) {
    return this.doctorDepartmentService.remove(id);
  }

  @Get('departments/:id/doctors')
  // @RequirePermissions(`${Resource.DOCTOR_DEPARTMENT}:${Action.READ}:${Scope.OWN}`)
  @ApiOperation({ summary: 'Liệt kê bác sĩ theo khoa (dùng ở bước chọn bác sĩ khi đặt lịch online)' })
  findDoctorsByDepartment(@Param('id') departmentId: string) {
    return this.doctorDepartmentService.findDoctorsByDepartment(departmentId);
  }

  @Get('departments')
  @ApiOperation({ summary: 'Lấy danh sách tất cả các khoa phòng đang hoạt động (Public API)' })
  findAllDepartments() {
    return this.doctorDepartmentService.findAllDepartments();
  }
}
