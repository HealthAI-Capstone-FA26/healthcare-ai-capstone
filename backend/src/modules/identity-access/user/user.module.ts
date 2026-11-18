import { Module } from '@nestjs/common';

import { UserService } from './user.service';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { ActorRoleService } from './actor-role.service';

@Module({
  controllers: [ProfileController],
  providers: [
    UserService,
    ProfileService,
    ActorRoleService,
  ],
  exports: [UserService, ActorRoleService],
})
export class UserModule { }