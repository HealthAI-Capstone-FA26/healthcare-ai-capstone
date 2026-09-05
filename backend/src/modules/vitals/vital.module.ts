import { Module } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { VitalSignAlertController } from './vital-anomaly/vital-sign-alert.controller';
import { VitalSignDetectionOrchestrator } from './vital-anomaly/vital-sign-detection.orchestrator';
import { RuleBasedDetector } from './vital-anomaly/rule-based.detector';
import { AiVitalSignDetector } from './vital-anomaly/ai-vital-sign.detector';
import { VitalAlertGateway } from './vital-anomaly/vital-alert.gateway';
import { VitalSignDetectionListener } from './vital-anomaly/vital-sign-detection.listener';
import { VitalInputController } from './vital-input/vital-recording/vital-input.controller';
import { VitalInputService } from './vital-input/vital-recording/vital-input.service';
import { VitalSessionQueryService } from './vital-input/vital-session-history/vital-session-query.service';
import { VitalItemController } from './vital-input/vital-item-catalog/vital-item.controller';
import { VitalItemService } from './vital-input/vital-item-catalog/vital-item.service';
import { VitalReferenceRangeController } from './vital-reference-range/vital-reference-range.controller';
import { VitalReferenceRangeService } from './vital-reference-range/vital-reference-range.service';

@Module({
    controllers: [
        VitalInputController,
        VitalItemController,
        VitalReferenceRangeController,
        VitalSignAlertController,
    ],
    providers: [
        PrismaService,
        VitalInputService,
        VitalSessionQueryService,
        VitalItemService,
        VitalReferenceRangeService,
        RuleBasedDetector,
        AiVitalSignDetector,
        VitalSignDetectionOrchestrator,
        VitalAlertGateway,
        VitalSignDetectionListener,
    ],
    exports: [
        VitalInputService,
        VitalSessionQueryService,
        VitalSignDetectionOrchestrator,
        VitalAlertGateway,
    ],
})
export class VitalModule { }