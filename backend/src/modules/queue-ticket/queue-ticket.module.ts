import { Module } from '@nestjs/common';
import { QueueTicketController } from './queue-ticket.controller';
import { QueueTicketService } from './queue-ticket.service';

@Module({
  controllers: [QueueTicketController],
  providers: [QueueTicketService],
  exports: [QueueTicketService],
})
export class QueueTicketModule {}
