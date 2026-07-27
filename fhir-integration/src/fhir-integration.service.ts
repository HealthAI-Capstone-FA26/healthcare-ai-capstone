import { Injectable, Logger } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { FhirStrategyRegistry } from './registry/fhir-strategy.registry';

@Injectable()
export class FhirIntegrationService {
    private readonly logger = new Logger(FhirIntegrationService.name);

    constructor(
        private readonly strategyRegistry: FhirStrategyRegistry,
        private readonly amqpConnection: AmqpConnection,
    ) { }

    /**
     * Transform dữ liệu từ một bảng DB và push vào RabbitMQ
     * @param tableName Tên bảng dữ liệu (VD: 'patients', 'observations')
     * @param rows Danh sách dòng dữ liệu đọc từ hospital_db
     */
    async processAndPublish(tableName: string, rows: any[]): Promise<void> {
        const strategy = this.strategyRegistry.getStrategy(tableName);

        if (!strategy) {
            this.logger.error(`Không tìm thấy Strategy cho bảng: ${tableName}`);
            return;
        }

        this.logger.log(`Đang xử lý ${rows.length} dòng cho bảng [${tableName}]...`);

        const resourceType = strategy.resourceType
            ? strategy.resourceType.toLowerCase()
            : tableName.toLowerCase();

        const routingKey = `fhir.${resourceType}`;

        for (const row of rows) {
            try {
                const fhirResource = strategy.transform(row);
                const patientId = strategy.extractPatientId(row);

                // Bắn tin sang RabbitMQ với Routing Key đã được kiểm tra an toàn
                await this.amqpConnection.publish(
                    'fhir_exchange', // Exchange Name (Bắt buộc)
                    routingKey,      // Routing Key (Bắt buộc không được undefined/rỗng)
                    fhirResource,    // Payload
                    {
                        headers: {
                            'x-patient-id': patientId || 'UNKNOWN',
                        },
                    },
                );

                this.logger.debug(
                    `[${strategy.resourceType || tableName}] PatientID: ${patientId} -> Success`,
                );
            } catch (error) {
                this.logger.error(
                    `Lỗi transform/publish dòng dữ liệu bảng ${tableName}:`,
                    error,
                );
            }
        }
    }
}