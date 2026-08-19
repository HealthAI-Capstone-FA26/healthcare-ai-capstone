import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface RequestUser {
  userId: string;
  email: string;
  permissions: string[];
}

// Lấy thông tin user đã xác thực (được JwtStrategy gắn vào request.user)
export const CurrentUser = createParamDecorator(
  (data: keyof RequestUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user: RequestUser }>();
    return data ? request.user?.[data] : request.user;
  },
);
