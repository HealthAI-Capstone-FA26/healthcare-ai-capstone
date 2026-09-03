import { Module } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { VitalSignAlertController } from './vital-anomaly/vital-sign-alert.controller';
import { VitalSignDetectionOrchestrator } from './vital-anomaly/vital-sign-detection.orchestrator';
import { RuleBasedDetector } from './vital-anomaly/rule-based.detector';
import { AiVitalSignDetector } from './vital-anomaly/ai-vital-sign.detector';
import { VitalAlertGateway } from './vital-anomaly/vital-alert.gateway';
import { VitalSignDetectionListener } from './vital-anomaly/vital-sign-detection.listener';

@Module({
    controllers: [
        VitalSignAlertController,
    ],
    providers: [
        PrismaService,
        RuleBasedDetector,
        AiVitalSignDetector,
        VitalSignDetectionOrchestrator,
        VitalAlertGateway,
        VitalSignDetectionListener,
    ],
    exports: [
        VitalSignDetectionOrchestrator,
        VitalAlertGateway,
    ],
})
export class VitalModule { }