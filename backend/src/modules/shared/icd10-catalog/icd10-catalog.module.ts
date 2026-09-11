import { Module } from '@nestjs/common';
import { Icd10CatalogController } from './icd10-catalog.controller';
import { Icd10CatalogService } from './icd10-catalog.service';

/**
 * Module dùng chung, độc lập (không thuộc Module 5 lẫn Module 8) cho danh mục ICD-10.
 * Cả DoctorExaminationModule (Module 5) và PostTestConsultationModule (Module 8) import
 * module này để lấy Icd10CatalogService — tránh việc 1 trong 2 module phải phụ thuộc
 * ngược vào module còn lại chỉ vì cùng cần tra cứu/validate mã ICD-10.
 */
@Module({
    controllers: [Icd10CatalogController],
    providers: [Icd10CatalogService],
    exports: [Icd10CatalogService],
})
export class Icd10CatalogModule {}
