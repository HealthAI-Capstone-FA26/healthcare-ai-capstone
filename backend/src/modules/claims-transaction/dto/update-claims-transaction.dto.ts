import { PartialType } from '@nestjs/mapped-types';
import { CreateClaimsTransactionDto } from './create-claims-transaction.dto';

export class UpdateClaimsTransactionDto extends PartialType(CreateClaimsTransactionDto) {}
