import { Module } from '@nestjs/common';
import { ImagingStudyController } from './imaging-study.controller';
import { ImagingStudyService } from './imaging-study.service';

@Module({
  controllers: [ImagingStudyController],
  providers: [ImagingStudyService],
  exports: [ImagingStudyService],
})
export class ImagingStudyModule {}
