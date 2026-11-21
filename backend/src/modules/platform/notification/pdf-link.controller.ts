import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { RedisService } from '../../../redis/redis.service';
import { BUCKET_NAME, minioClient } from '../../../common/configs/upload.config';

@ApiExcludeController()
@Controller('zalo-bot')
export class ZaloPdfLinkController {
  constructor(private readonly redis: RedisService) {}

  @Get('pdf/:token')
  async open(@Param('token') token: string, @Res() res: Response) {
    const data = await this.redis.getJson<{ objectName: string }>(`zalo:pdf:${token}`);
    if (!data) throw new NotFoundException('Link không tồn tại hoặc đã hết hạn');
    const url = await minioClient.presignedGetObject(BUCKET_NAME, data.objectName, 120);
    res.redirect(302, url);
  }
}
