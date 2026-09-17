import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { StaffDepartmentService } from './staff-department.service';
import { AssignStaffDepartmentDto } from './dto/assign-staff-department.dto';
import { UpdateStaffDepartmentDto } from './dto/update-staff-department.dto';

@ApiTags('Staff Departments')
@ApiBearerAuth()
@Controller()
export class StaffDepartmentController {
  constructor(private readonly staffDepartmentService: StaffDepartmentService) {}

  @Post('users/:id/departments')
  @ApiOperation({ summary: 'Gán điều dưỡng vào khoa để nhận hàng đợi đo sinh hiệu' })
  assign(@Param('id') userId: string, @Body() dto: AssignStaffDepartmentDto) {
    return this.staffDepartmentService.assign(userId, dto);
  }

  @Patch('staff-departments/:id')
  @ApiParam({
    name: 'id',
    description: 'Composite key theo dạng userId_departmentId',
  })
  @ApiOperation({ summary: 'Sửa khoa chính của điều dưỡng' })
  update(@Param('id') id: string, @Body() dto: UpdateStaffDepartmentDto) {
    return this.staffDepartmentService.updatePrimary(id, dto.isPrimary);
  }

  @Delete('staff-departments/:id')
  @ApiParam({
    name: 'id',
    description: 'Composite key theo dạng userId_departmentId',
  })
  @ApiOperation({ summary: 'Gỡ điều dưỡng khỏi khoa' })
  remove(@Param('id') id: string) {
    return this.staffDepartmentService.remove(id);
  }

  @Get('departments/:id/staff')
  @ApiOperation({ summary: 'Liệt kê điều dưỡng được gán vào khoa' })
  findStaffByDepartment(@Param('id') departmentId: string) {
    return this.staffDepartmentService.findStaffByDepartment(departmentId);
  }
}
