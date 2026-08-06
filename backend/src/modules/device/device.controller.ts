import { Controller } from '@nestjs/common';
import { DeviceService } from './device.service';

@Controller('devices')
export class DeviceController {
  constructor(private readonly deviceService: DeviceService) {}

  // TODO: khai báo endpoint
}
