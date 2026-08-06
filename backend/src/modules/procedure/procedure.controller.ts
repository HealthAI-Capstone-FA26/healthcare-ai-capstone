import { Controller } from '@nestjs/common';
import { ProcedureService } from './procedure.service';

@Controller('procedures')
export class ProcedureController {
  constructor(private readonly procedureService: ProcedureService) {}

  // TODO: khai báo endpoint
}
