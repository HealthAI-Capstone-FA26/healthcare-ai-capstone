import { Module } from '@nestjs/common';
import { PrismaModule } from 'prisma/prisma.module';
import { SecurityConfigController } from './security-config.controller';
import { SecurityConfigService } from './security-config.service';

@Module({
    imports: [PrismaModule],
    controllers: [SecurityConfigController],
    providers: [SecurityConfigService],
    exports: [SecurityConfigService],
})
export class SecurityConfigModule { }
