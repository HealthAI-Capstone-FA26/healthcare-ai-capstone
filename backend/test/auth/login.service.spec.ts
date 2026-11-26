import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { LoginService } from '../../src/modules/identity-access/auth/login/login.service';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

describe('LoginService (F-01 Auth & Session)', () => {
  let service: LoginService;
  let userService: any;
  let sessionService: any;
  let securityConfigService: any;
  let tokenService: any;

  const baseUser = {
    userId: 'user-01',
    email: 'doctor@clinic.vn',
    passwordHash: '$2b$10$hashedpassword',
    status: 'active',
    lockedUntil: null as Date | null,
    role: { roleCode: 'DOCTOR' },
  };

  const defaultConfig = {
    accessTokenTtlMins: 15,
    refreshTokenTtlHours: 8,
    maxSessionHours: 8,
    maxLoginAttempts: 5,
    lockoutDurationMins: 15,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    userService = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      registerFailedLogin: jest.fn(),
      resetFailedAttempts: jest.fn().mockResolvedValue(undefined),
      touchLastLogin: jest.fn().mockResolvedValue(undefined),
      toResponseDto: jest.fn((u: any) => ({ userId: u.userId, email: u.email, actorRole: 'DOCTOR' })),
    };
    sessionService = {
      createSession: jest.fn().mockResolvedValue({}),
      findByUserId: jest.fn(),
      rotateRefreshToken: jest.fn().mockResolvedValue({}),
      revokeByUserId: jest.fn().mockResolvedValue({ count: 1 }),
    };
    securityConfigService = {
      getConfig: jest.fn().mockResolvedValue(defaultConfig),
    };
    tokenService = {
      signAccessToken: jest.fn().mockReturnValue('access-jwt-token'),
      signRefreshToken: jest.fn().mockReturnValue('refresh-jwt-token'),
      verifyRefreshToken: jest.fn(),
    };
    service = new LoginService(userService, sessionService, securityConfigService, tokenService);
  });

  // ------------------------------------------------------------------ login
  describe('login', () => {
    it('đăng nhập thành công khi email/mật khẩu hợp lệ và tài khoản active', async () => {
      userService.findByEmail.mockResolvedValue(baseUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const res = await service.login({ email: 'doctor@clinic.vn', password: 'Password123!' });

      expect(userService.resetFailedAttempts).toHaveBeenCalledWith('user-01');
      expect(userService.touchLastLogin).toHaveBeenCalledWith('user-01');
      expect(tokenService.signAccessToken).toHaveBeenCalledWith(baseUser, 15);
      expect(tokenService.signRefreshToken).toHaveBeenCalledWith('user-01', 8);
      expect(sessionService.createSession).toHaveBeenCalledWith('user-01', 'refresh-jwt-token', 8);
      expect(res).toEqual({
        message: 'Đăng nhập thành công',
        user: { userId: 'user-01', email: 'doctor@clinic.vn', actorRole: 'DOCTOR' },
        accessToken: 'access-jwt-token',
        refreshToken: 'refresh-jwt-token',
      });
    });

    it('ném UnauthorizedException khi email không tồn tại', async () => {
      userService.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'unknown@clinic.vn', password: 'Password123!' }),
      ).rejects.toThrow(new UnauthorizedException('Email hoặc mật khẩu không chính xác'));
    });

    it('ném UnauthorizedException khi tài khoản đang bị tạm khóa (lockedUntil > now)', async () => {
      const lockedUntil = new Date(Date.now() + 10 * 60_000);
      userService.findByEmail.mockResolvedValue({ ...baseUser, lockedUntil });

      await expect(
        service.login({ email: 'doctor@clinic.vn', password: 'Password123!' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('ném UnauthorizedException khi tài khoản chưa kích hoạt hoặc bị vô hiệu hóa', async () => {
      userService.findByEmail.mockResolvedValue({ ...baseUser, status: 'inactive' });

      await expect(
        service.login({ email: 'doctor@clinic.vn', password: 'Password123!' }),
      ).rejects.toThrow(
        new UnauthorizedException('Tài khoản chưa được kích hoạt hoặc đã bị vô hiệu hóa'),
      );
    });

    it('tăng đếm sai và báo sai thông tin khi sai mật khẩu chưa tới ngưỡng khóa', async () => {
      userService.findByEmail.mockResolvedValue(baseUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      userService.registerFailedLogin.mockResolvedValue({ ...baseUser, lockedUntil: null });

      await expect(
        service.login({ email: 'doctor@clinic.vn', password: 'wrong' }),
      ).rejects.toThrow(new UnauthorizedException('Email hoặc mật khẩu không chính xác'));

      expect(userService.registerFailedLogin).toHaveBeenCalledWith('user-01', 5, 15);
    });

    it('khóa tài khoản và thông báo số phút khóa khi sai mật khẩu vượt ngưỡng', async () => {
      userService.findByEmail.mockResolvedValue(baseUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      userService.registerFailedLogin.mockResolvedValue({
        ...baseUser,
        lockedUntil: new Date(Date.now() + 15 * 60_000),
      });

      await expect(
        service.login({ email: 'doctor@clinic.vn', password: 'wrong' }),
      ).rejects.toThrow(
        new UnauthorizedException('Bạn đã nhập sai mật khẩu quá 5 lần. Tài khoản bị khóa trong 15 phút'),
      );
    });
  });

  // ------------------------------------------------------------------ refreshToken
  describe('refreshToken', () => {
    const validSession = {
      userId: 'user-01',
      refreshTokenHash: '$2b$10$hashedrefresh',
      revokedAt: null,
      expiredAt: new Date(Date.now() + 60 * 60_000),
    };

    it('cấp accessToken & refreshToken mới và xoay vòng session khi hợp lệ', async () => {
      tokenService.verifyRefreshToken.mockReturnValue({ sub: 'user-01' });
      sessionService.findByUserId.mockResolvedValue(validSession);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      userService.findById.mockResolvedValue(baseUser);

      const res = await service.refreshToken({ refreshToken: 'old-refresh' });

      expect(sessionService.rotateRefreshToken).toHaveBeenCalledWith('user-01', 'refresh-jwt-token');
      expect(res).toEqual({
        accessToken: 'access-jwt-token',
        refreshToken: 'refresh-jwt-token',
      });
    });

    it('ném UnauthorizedException khi verifyRefreshToken thất bại', async () => {
      tokenService.verifyRefreshToken.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(service.refreshToken({ refreshToken: 'bad-token' })).rejects.toThrow(
        new UnauthorizedException('Refresh token không hợp lệ hoặc đã hết hạn'),
      );
    });

    it('ném UnauthorizedException khi session không tồn tại hoặc đã bị thu hồi', async () => {
      tokenService.verifyRefreshToken.mockReturnValue({ sub: 'user-01' });
      sessionService.findByUserId.mockResolvedValue({ ...validSession, revokedAt: new Date() });

      await expect(service.refreshToken({ refreshToken: 'old-refresh' })).rejects.toThrow(
        new UnauthorizedException('Phiên đăng nhập không tồn tại hoặc đã bị thu hồi'),
      );
    });

    it('ném UnauthorizedException khi phiên vượt quá session limit (expiredAt < now)', async () => {
      tokenService.verifyRefreshToken.mockReturnValue({ sub: 'user-01' });
      sessionService.findByUserId.mockResolvedValue({
        ...validSession,
        expiredAt: new Date(Date.now() - 1000),
      });

      await expect(service.refreshToken({ refreshToken: 'old-refresh' })).rejects.toThrow(
        new UnauthorizedException('Phiên đăng nhập đã hết hạn (session limit), vui lòng đăng nhập lại'),
      );
    });

    it('ném UnauthorizedException khi refresh token không khớp hash trong session', async () => {
      tokenService.verifyRefreshToken.mockReturnValue({ sub: 'user-01' });
      sessionService.findByUserId.mockResolvedValue(validSession);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.refreshToken({ refreshToken: 'tampered' })).rejects.toThrow(
        new UnauthorizedException('Refresh token không hợp lệ hoặc đã hết hạn'),
      );
    });

    it('ném UnauthorizedException khi tài khoản không tồn tại hoặc không active', async () => {
      tokenService.verifyRefreshToken.mockReturnValue({ sub: 'user-01' });
      sessionService.findByUserId.mockResolvedValue(validSession);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      userService.findById.mockResolvedValue({ ...baseUser, status: 'suspended' });

      await expect(service.refreshToken({ refreshToken: 'old-refresh' })).rejects.toThrow(
        new UnauthorizedException('Tài khoản không khả dụng'),
      );
    });
  });

  // ------------------------------------------------------------------ logout
  describe('logout', () => {
    it('thu hồi session của user và trả về thông báo đăng xuất thành công', async () => {
      const res = await service.logout('user-01');

      expect(sessionService.revokeByUserId).toHaveBeenCalledWith('user-01');
      expect(res).toEqual({ message: 'Đăng xuất thành công' });
    });
  });
});
