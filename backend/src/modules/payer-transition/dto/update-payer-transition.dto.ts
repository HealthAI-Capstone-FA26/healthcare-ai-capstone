import { PartialType } from '@nestjs/mapped-types';
import { CreatePayerTransitionDto } from './create-payer-transition.dto';

export class UpdatePayerTransitionDto extends PartialType(CreatePayerTransitionDto) {}
