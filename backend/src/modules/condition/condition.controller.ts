import { Controller } from '@nestjs/common';
import { ConditionService } from './condition.service';

@Controller('conditions')
export class ConditionController {
  constructor(private readonly conditionService: ConditionService) {}

  // TODO: khai báo endpoint
}
