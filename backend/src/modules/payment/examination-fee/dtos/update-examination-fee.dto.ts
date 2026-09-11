import { PartialType } from '@nestjs/mapped-types';
import { CreateExaminationFeeDto } from './create-examination-fee.dto';

export class UpdateExaminationFeeDto extends PartialType(CreateExaminationFeeDto) {}
