import { Controller } from '@nestjs/common';
import { CarePlanService } from './care-plan.service';

@Controller('care-plans')
export class CarePlanController {
  constructor(private readonly carePlanService: CarePlanService) {}

  // TODO: khai báo endpoint
}
