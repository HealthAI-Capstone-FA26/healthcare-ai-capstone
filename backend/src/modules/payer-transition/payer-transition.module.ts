import { Module } from '@nestjs/common';
import { PayerTransitionController } from './payer-transition.controller';
import { PayerTransitionService } from './payer-transition.service';

@Module({
  controllers: [PayerTransitionController],
  providers: [PayerTransitionService],
  exports: [PayerTransitionService],
})
export class PayerTransitionModule {}
