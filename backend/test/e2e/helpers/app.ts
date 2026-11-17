import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../../../src/app.module';

export const API_PREFIX = '/api/v1';

/** Boot nguyên AppModule thật (DB + Redis thật), cấu hình giống src/main.ts. */
export async function createE2EApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

/** Ký access token đúng cấu trúc JwtStrategy cần ({ sub, email }) — đi qua JwtAuthGuard + PermissionsGuard thật. */
export function signToken(app: INestApplication, user: { userId: string; email: string }): string {
  return app.get(JwtService).sign({ sub: user.userId, email: user.email }, { expiresIn: '1h' });
}

export type TestResponse = request.Response;

/** Client mỏng quanh supertest: tự thêm prefix /api/v1 và Bearer token. */
export function client(app: INestApplication, token?: string) {
  const server = app.getHttpServer();
  const withAuth = (req: request.Test) => (token ? req.set('Authorization', `Bearer ${token}`) : req);
  return {
    get: (url: string) => withAuth(request(server).get(API_PREFIX + url)),
    post: (url: string, body: object = {}) => withAuth(request(server).post(API_PREFIX + url)).send(body),
    patch: (url: string, body: object = {}) => withAuth(request(server).patch(API_PREFIX + url)).send(body),
  };
}

/** Khẳng định response 2xx; nếu lỗi thì in cả body để nhìn log CI là biết bước nào hỏng. */
export function expectSuccess(res: TestResponse, label: string): any {
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`[${label}] HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}
