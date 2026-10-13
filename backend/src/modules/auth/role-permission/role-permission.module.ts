import { Module } from '@nestjs/common';
import { AdminRbacController } from './role-permission.controller';
import { PrismaModule } from 'prisma/prisma.module';
import { AdminRbacService } from './role-permission.service';

@Module({
    imports: [PrismaModule],
    controllers: [AdminRbacController],
    providers: [AdminRbacService],
    exports: [AdminRbacService],
})
export class RolePermissionModule { }