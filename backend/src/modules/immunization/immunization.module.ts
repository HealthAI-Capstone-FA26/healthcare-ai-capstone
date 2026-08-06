import { Module } from '@nestjs/common';
import { ImmunizationController } from './immunization.controller';
import { ImmunizationService } from './immunization.service';

@Module({
  controllers: [ImmunizationController],
  providers: [ImmunizationService],
  exports: [ImmunizationService],
})
export class ImmunizationModule {}
