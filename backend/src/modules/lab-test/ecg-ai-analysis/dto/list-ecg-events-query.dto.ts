import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export const ECG_ALERT_STATUSES = ['active', 'acknowledged', 'resolved', 'auto_dismissed'] as const;

export class ListEcgEventsQueryDto {
    @ApiPropertyOptional({ enum: ECG_ALERT_STATUSES })
    @IsOptional()
    @IsIn(ECG_ALERT_STATUSES)
    alertStatus?: (typeof ECG_ALERT_STATUSES)[number];

    @ApiPropertyOptional({ enum: ['low', 'medium', 'high', 'critical'] })
    @IsOptional()
    @IsIn(['low', 'medium', 'high', 'critical'])
    severity?: 'low' | 'medium' | 'high' | 'critical';

    @ApiPropertyOptional({ enum: ['pending', 'true_positive', 'false_positive', 'uncertain'] })
    @IsOptional()
    @IsIn(['pending', 'true_positive', 'false_positive', 'uncertain'])
    reviewVerdict?: 'pending' | 'true_positive' | 'false_positive' | 'uncertain';
}
