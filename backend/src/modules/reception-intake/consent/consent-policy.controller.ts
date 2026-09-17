import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { ConsentPolicyService } from './consent-policy.service';
import { FindConsentPoliciesQueryDto } from './dto/find-consent-policy-query.dto';

@ApiTags('Consent Policy')
@ApiBearerAuth()
// @UseGuards(JwtAuthGuard)
@Controller('consent-policies')
export class ConsentPolicyController {
  constructor(private readonly consentPolicyService: ConsentPolicyService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách policy đang hiệu lực (lọc theo policyType nếu có)' })
  findEffective(@Query() query: FindConsentPoliciesQueryDto) {
    return this.consentPolicyService.findEffective(query);
  }
}