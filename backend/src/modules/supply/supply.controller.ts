import { Controller } from '@nestjs/common';
import { SupplyService } from './supply.service';

@Controller('supplys')
export class SupplyController {
  constructor(private readonly supplyService: SupplyService) {}

  // TODO: khai báo endpoint
}
