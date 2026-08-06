import { Module } from '@nestjs/common';
import { EncounterController } from './encounter.controller';
import { EncounterService } from './encounter.service';

@Module({
  controllers: [EncounterController],
  providers: [EncounterService],
  exports: [EncounterService],
})
export class EncounterModule {}
