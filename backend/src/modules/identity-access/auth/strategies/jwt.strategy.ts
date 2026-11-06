import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UserService } from '../../user/user.service';
import { ACTOR_ROLE, normalizeActorRole } from '../../../../common/constants/actor-role.constant';
import { Scope } from '../../../../common/constants/permissions.dictionary';

interface JwtPayload {
  sub: string;
  email: string;
  iat: number; // thời điểm jwt được tạo
  exp: number; // thời điểm jwt hết hạn
}

/**
 * Shape của req.user sau khi JwtAuthGuard validate JWT thành công.
 * Dùng chung bởi @CurrentUser() decorator và PermissionsGuard.
 */
export interface RequestUser {
  userId: string;
  email: string;
  roleCode?: string;
  permissions: string[]; // danh sách permissionCode dạng "resource:action:scope"
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly userService: UserService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
      ignoreExpiration: false,
    });
  }

  async validate(payload: JwtPayload): Promise<RequestUser> {
    const user = await this.userService.findByIdWithPermissions(payload.sub);

    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('User account is inactive');
    }

    const rawPermissions: string[] = Array.from(
      new Set(
        (user.role?.rolePermissions ?? []).map(
          (rp) => rp.permission.permissionCode,
        ),
      ),
    );

    const actorRole = normalizeActorRole(user.role?.roleCode);
    // Tài khoản Bệnh nhân (PATIENT) chỉ được phép có quyền ở phạm vi cá nhân (:own),
    // không bao giờ có scope :group hoặc :all (tránh bị coi là Staff làm lộ hồ sơ/lịch hẹn của BN khác).
    const permissions =
      actorRole === ACTOR_ROLE.PATIENT
        ? Array.from(
            new Set(
              rawPermissions.map((code) => {
                const [res, act] = code.split(':');
                return `${res}:${act}:${Scope.OWN}`;
              }),
            ),
          )
        : rawPermissions;

    return {
      userId: user.userId,
      email: user.email,
      roleCode: user.role?.roleCode,
      permissions,
    };
  }
}