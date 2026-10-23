import { Module } from '@nestjs/common';
import { StageEventCollector } from './stage-event.collector';
import { StatisticsController } from './statistics.controller';
import { StatisticsRollupService } from './statistics-rollup.service';
import { StatisticsService } from './statistics.service';
import { UserModule } from '../../identity-access/user/user.module';

/**
 * SE07 — Statistics & Reporting. Chỉ ĐỌC các bảng nghiệp vụ (Prisma) và GHI EncounterStageEvent / StageStatistic,
 * không import module nghiệp vụ nào -> không tạo vòng phụ thuộc, không ảnh hưởng luồng khám hiện có.
 */
@Module({
  imports: [UserModule], // ActorRoleService
  controllers: [StatisticsController],
  providers: [StageEventCollector, StatisticsRollupService, StatisticsService],
  exports: [StatisticsService],
})
export class StatisticsModule { }
