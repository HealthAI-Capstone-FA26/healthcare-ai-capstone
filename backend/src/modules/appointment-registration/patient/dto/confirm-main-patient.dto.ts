import { PartialType, PickType } from '@nestjs/mapped-types';
import { CreatePatientDto } from './create-patient.dto';

export class ConfirmMainPatientDto extends PartialType(
  PickType(CreatePatientDto, [
    'fullName',
    'dateOfBirth',
    'gender',
    'identityNumber',
    'insuranceNumber',
    'phoneNumber',
  ] as const),
) {}
