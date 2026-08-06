import { Controller } from '@nestjs/common';
import { AllergyService } from './allergy.service';

@Controller('allergys')
export class AllergyController {
  constructor(private readonly allergyService: AllergyService) {}

  // TODO: khai báo endpoint
}
