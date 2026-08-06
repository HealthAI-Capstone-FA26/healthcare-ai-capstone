import { Controller } from '@nestjs/common';
import { EncounterService } from './encounter.service';

@Controller('encounters')
export class EncounterController {
  constructor(private readonly encounterService: EncounterService) {}

  // TODO: khai báo endpoint
}
