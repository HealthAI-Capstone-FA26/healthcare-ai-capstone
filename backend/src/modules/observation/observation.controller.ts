import { Controller } from '@nestjs/common';
import { ObservationService } from './observation.service';

@Controller('observations')
export class ObservationController {
  constructor(private readonly observationService: ObservationService) {}

  // TODO: khai báo endpoint
}
