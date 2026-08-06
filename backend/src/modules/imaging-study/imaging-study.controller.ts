import { Controller } from '@nestjs/common';
import { ImagingStudyService } from './imaging-study.service';

@Controller('imaging-studys')
export class ImagingStudyController {
  constructor(private readonly imagingStudyService: ImagingStudyService) {}

  // TODO: khai báo endpoint
}
