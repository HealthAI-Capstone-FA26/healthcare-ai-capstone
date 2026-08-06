import { Module } from '@nestjs/common';
import { PayerController } from './payer.controller';
import { PayerService } from './payer.service';

@Module({
  controllers: [PayerController],
  providers: [PayerService],
  exports: [PayerService],
})
export class PayerModule {}
