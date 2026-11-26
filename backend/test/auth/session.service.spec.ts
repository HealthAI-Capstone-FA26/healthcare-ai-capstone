import * as bcrypt from 'bcrypt';
import { SessionService } from '../../src/modules/identity-access/auth/session/session.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
}));

describe('SessionService (F-01 Session Management)', () => {
  let service: SessionService;
  let prisma: any;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      userSession: {
        upsert: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    service = new SessionService(prisma);
  });

  it('createSession: hash refreshToken và upsert session với expiredAt theo maxSessionHours', async () => {
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-rt');
    prisma.userSession.upsert.mockResolvedValue({ userId: 'u-1', refreshTokenHash: 'hashed-rt' });

    const before = Date.now();
    await service.createSession('u-1', 'raw-rt', 8);
    const after = Date.now();

    expect(bcrypt.hash).toHaveBeenCalledWith('raw-rt', expect.any(Number));
    const call = prisma.userSession.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ userId: 'u-1' });
    expect(call.create.refreshTokenHash).toBe('hashed-rt');
    expect(call.update.revokedAt).toBeNull();

    const expectedMin = before + 8 * 60 * 60_000;
    const expectedMax = after + 8 * 60 * 60_000;
    expect(call.create.expiredAt.getTime()).toBeGreaterThanOrEqual(expectedMin);
    expect(call.create.expiredAt.getTime()).toBeLessThanOrEqual(expectedMax);
  });

  it('findByUserId: truy vấn userSession theo userId', async () => {
    prisma.userSession.findUnique.mockResolvedValue({ userId: 'u-1' });
    const res = await service.findByUserId('u-1');
    expect(prisma.userSession.findUnique).toHaveBeenCalledWith({ where: { userId: 'u-1' } });
    expect(res).toEqual({ userId: 'u-1' });
  });

  it('rotateRefreshToken: chỉ cập nhật refreshTokenHash, giữ nguyên expiredAt', async () => {
    (bcrypt.hash as jest.Mock).mockResolvedValue('new-hashed-rt');
    prisma.userSession.update.mockResolvedValue({ userId: 'u-1', refreshTokenHash: 'new-hashed-rt' });

    await service.rotateRefreshToken('u-1', 'new-raw-rt');

    expect(prisma.userSession.update).toHaveBeenCalledWith({
      where: { userId: 'u-1' },
      data: { refreshTokenHash: 'new-hashed-rt' },
    });
  });

  it('revokeByUserId: đánh dấu revokedAt cho các session chưa thu hồi', async () => {
    prisma.userSession.updateMany.mockResolvedValue({ count: 1 });

    await service.revokeByUserId('u-1');

    const call = prisma.userSession.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ userId: 'u-1', revokedAt: null });
    expect(call.data.revokedAt).toBeInstanceOf(Date);
  });
});
