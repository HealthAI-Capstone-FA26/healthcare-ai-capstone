import { PartialType } from '@nestjs/mapped-types';
import { CreateCarePlanDto } from './create-care-plan.dto';

export class UpdateCarePlanDto extends PartialType(CreateCarePlanDto) {}
