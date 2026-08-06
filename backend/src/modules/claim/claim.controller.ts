import { Controller } from '@nestjs/common';
import { ClaimService } from './claim.service';

@Controller('claims')
export class ClaimController {
  constructor(private readonly claimService: ClaimService) {}

  // TODO: khai báo endpoint
}
