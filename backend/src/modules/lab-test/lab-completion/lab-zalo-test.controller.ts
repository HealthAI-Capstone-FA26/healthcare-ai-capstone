import { Body, Controller, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import { ActorRoleService } from '../../identity-access/user/actor-role.service';
import { LabResultZaloDeliveryService } from './lab-result-zalo-delivery.service';

export class SendLabZaloTestDto {
    @ApiPropertyOptional({
        description: 'chat_id Zalo nhận tài liệu. Bỏ trống = dùng chat_id bệnh nhân đã liên kết với bot (nhắn SĐT cho bot).',
    })
    @IsOptional()
    @IsString()
    @MaxLength(100)
    zaloUserId?: string;
}

/**
 * [TEST] Kích hoạt thủ công việc gửi tài liệu kết quả (PDF máu, PDF ECG, ảnh X-quang/siêu âm) qua Zalo cho 1 encounter,
 * KHÔNG cần chạy lại quy trình hoàn tất chỉ định. Dữ liệu y tế -> mặc định chỉ bật ngoài production;
 * trên production phải đặt ENABLE_ZALO_TEST_ENDPOINTS=true. Nên tắt lại sau khi test xong.
 */
@ApiTags('Lab Zalo (TEST)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('lab-results')
export class LabZaloTestController {
    constructor(
        private readonly delivery: LabResultZaloDeliveryService,
        private readonly actorRoleService: ActorRoleService,
    ) {}

    @Post('encounters/:encounterId/send-zalo-test')
    @ApiOperation({
        summary: '[TEST] Gửi tài liệu kết quả cận lâm sàng của 1 encounter qua Zalo',
        description:
            'Gửi mọi chỉ định đã completed của encounter: PDF xét nghiệm máu, PDF biểu đồ ECG (link tải), ảnh X-quang/siêu âm. ' +
            'Trả báo cáo { chatId, sent, skipped, errors } để biết tài liệu nào đã gửi / bỏ qua / lỗi.',
    })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    async send(
        @Param('encounterId', ParseUUIDPipe) encounterId: string,
        @Body() dto: SendLabZaloTestDto,
        @CurrentUser('userId') userId: string,
    ) {
        // Ẩn hẳn endpoint trên production nếu chưa bật cờ
        if (process.env.NODE_ENV === 'production' && process.env.ENABLE_ZALO_TEST_ENDPOINTS !== 'true') {
            throw new NotFoundException();
        }
        await this.actorRoleService.assertActorRole(userId, [ACTOR_ROLE.ADMIN, ACTOR_ROLE.LAB_STAFF, ACTOR_ROLE.DOCTOR]);
        return this.delivery.sendResultsForEncounter(encounterId, { zaloUserId: dto?.zaloUserId });
    }
}
