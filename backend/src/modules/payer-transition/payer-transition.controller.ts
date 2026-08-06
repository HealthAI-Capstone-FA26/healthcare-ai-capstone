import { Controller } from '@nestjs/common';
import { PayerTransitionService } from './payer-transition.service';

@Controller('payer-transitions')
export class PayerTransitionController {
  constructor(private readonly payerTransitionService: PayerTransitionService) {}

  // TODO: khai báo endpoint
}
