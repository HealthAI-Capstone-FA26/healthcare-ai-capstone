import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// Wrapper mỏng quanh ioredis client, dùng chung cho toàn app (session cache, OTP...).
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;

  constructor(private readonly configService: ConfigService) { }

  onModuleInit() {
    const url = this.configService.get<string>('REDIS_URL') ?? 'redis://localhost:6379';

    this.client = new Redis(url, {
      maxRetriesPerRequest: 3,
    });

    this.client.on('error', (err) => {
      this.logger.error(`Redis connection error: ${err.message}`);
    });

    this.client.on('connect', () => {
      this.logger.log('Đã kết nối Redis');
    });
  }

  async onModuleDestroy() {
    await this.client?.quit();
  }

  getClient(): Redis {
    return this.client;
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), 'EX', Math.max(1, Math.ceil(ttlSeconds)));
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  // Cập nhật JSON đang có, giữ nguyên TTL còn lại (dùng khi tăng attempts, đánh dấu verified...)
  async updateJsonKeepTtl<T>(key: string, updater: (current: T) => T): Promise<T | null> {
    const raw = await this.client.get(key);
    if (!raw) return null;

    const current = JSON.parse(raw) as T;
    const updated = updater(current);

    await this.client.set(key, JSON.stringify(updated), 'KEEPTTL');
    return updated;
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }
}
