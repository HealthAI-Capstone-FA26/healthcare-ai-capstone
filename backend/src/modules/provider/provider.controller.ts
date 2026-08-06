import { Controller } from '@nestjs/common';
import { ProviderService } from './provider.service';

@Controller('providers')
export class ProviderController {
  constructor(private readonly providerService: ProviderService) {}

  // TODO: khai báo endpoint
}
