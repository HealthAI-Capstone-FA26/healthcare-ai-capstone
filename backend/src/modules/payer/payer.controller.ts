import { Controller } from '@nestjs/common';
import { PayerService } from './payer.service';

@Controller('payers')
export class PayerController {
  constructor(private readonly payerService: PayerService) {}

  // TODO: khai báo endpoint
}
