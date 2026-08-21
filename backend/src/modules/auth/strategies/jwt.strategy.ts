import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UserService } from '../../user/user.service';

interface JwtPayload {
  sub: string;
  email: string;
  iat: number; // thời điểm jwt được tạo
  exp: number;// thời điểm jwt hết hạn
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

  async validate(payload: JwtPayload) {
    const user = await this.userService.findByIdWithPermissions(payload.sub);

    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('User account is inactive');
    }

    const permissions = Array.from(
      new Set(
        (user.userRoles ?? []).flatMap((userRole) =>
          (userRole.role?.rolePermissions ?? []).map(
            (rp) => rp.permission.permissionCode,
          ),
        ),
      ),
    );

    return {
      userId: user.userId,
      email: user.email,
      permissions,
    };
  }
}