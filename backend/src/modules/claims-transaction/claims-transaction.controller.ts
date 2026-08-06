import { Controller } from '@nestjs/common';
import { ClaimsTransactionService } from './claims-transaction.service';

@Controller('claims-transactions')
export class ClaimsTransactionController {
  constructor(private readonly claimsTransactionService: ClaimsTransactionService) {}

  // TODO: khai báo endpoint
}
