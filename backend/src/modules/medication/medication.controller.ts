import { Controller } from '@nestjs/common';
import { MedicationService } from './medication.service';

@Controller('medications')
export class MedicationController {
  constructor(private readonly medicationService: MedicationService) {}

  // TODO: khai báo endpoint
}
