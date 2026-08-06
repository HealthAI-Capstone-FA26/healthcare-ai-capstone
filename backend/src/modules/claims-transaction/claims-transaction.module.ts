import { Module } from '@nestjs/common';
import { ClaimsTransactionController } from './claims-transaction.controller';
import { ClaimsTransactionService } from './claims-transaction.service';

@Module({
  controllers: [ClaimsTransactionController],
  providers: [ClaimsTransactionService],
  exports: [ClaimsTransactionService],
})
export class ClaimsTransactionModule {}
