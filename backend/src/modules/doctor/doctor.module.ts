import { Module } from '@nestjs/common';
import { DoctorController } from './doctor.controller';
import { DoctorService } from './doctor.service';

@Module({
  controllers: [DoctorController],
  providers: [DoctorService],
  exports: [DoctorService],
})
export class DoctorModule {}
