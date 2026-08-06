import { PartialType } from '@nestjs/mapped-types';
import { CreatePayerDto } from './create-payer.dto';

export class UpdatePayerDto extends PartialType(CreatePayerDto) {}
