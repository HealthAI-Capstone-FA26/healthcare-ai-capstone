import { PartialType } from '@nestjs/mapped-types';
import { CreateImmunizationDto } from './create-immunization.dto';

export class UpdateImmunizationDto extends PartialType(CreateImmunizationDto) {}
