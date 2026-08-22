import { Module } from '@nestjs/common';
import { DoctorDepartmentController } from './doctor-department.controller';
import { DoctorDepartmentService } from './doctor-department.service';

@Module({
  controllers: [DoctorDepartmentController],
  providers: [DoctorDepartmentService],
  exports: [DoctorDepartmentService],
})
export class DoctorDepartmentModule {}
