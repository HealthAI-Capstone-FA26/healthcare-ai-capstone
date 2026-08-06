import { Controller } from '@nestjs/common';
import { ImmunizationService } from './immunization.service';

@Controller('immunizations')
export class ImmunizationController {
  constructor(private readonly immunizationService: ImmunizationService) {}

  // TODO: khai báo endpoint
}
