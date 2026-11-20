import { Module } from '@nestjs/common';
import { DrugCatalogController } from './drug-catalog.controller';
import { DrugCatalogService } from './drug-catalog.service';

@Module({
    controllers: [DrugCatalogController],
    providers: [DrugCatalogService],
    exports: [DrugCatalogService],
})
export class DrugCatalogModule {}
