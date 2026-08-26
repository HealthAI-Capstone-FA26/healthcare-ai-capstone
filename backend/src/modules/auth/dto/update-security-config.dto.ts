import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Dùng cho: PATCH /admin/security-settings
 *
 * Cho phép admin cập nhật từng phần (partial update) các thông số bảo mật.
 * Field nào không truyền lên thì giữ nguyên giá trị hiện tại.
 */
export class UpdateSecurityConfigDto {
    @ApiPropertyOptional({
        description: 'Thời gian sống của access token (phút)',
        example: 15,
        minimum: 1,
        maximum: 60,
    })
    @IsOptional()
    @IsInt({ message: 'accessTokenTtlMins phải là số nguyên' })
    @Min(1, { message: 'accessTokenTtlMins phải >= 1' })
    @Max(60, { message: 'accessTokenTtlMins phải <= 60 (60 phút)' })
    accessTokenTtlMins?: number;

    @ApiPropertyOptional({
        description: 'Thời gian sống của refresh token (giờ)',
        example: 8,
        minimum: 1,
        maximum: 24,
    })
    @IsOptional()
    @IsInt({ message: 'refreshTokenTtlHours phải là số nguyên' })
    @Min(1, { message: 'refreshTokenTtlHours phải >= 1' })
    @Max(24, { message: 'refreshTokenTtlHours phải <= 24 (1 ngày)' })
    refreshTokenTtlHours?: number;

    @ApiPropertyOptional({
        description: 'Thời gian tồn tại tối đa của 1 phiên đăng nhập (giờ)',
        example: 8,
        minimum: 1,
        maximum: 72,
    })
    @IsOptional()
    @IsInt({ message: 'maxSessionHours phải là số nguyên' })
    @Min(1, { message: 'maxSessionHours phải >= 1' })
    @Max(72, { message: 'maxSessionHours phải <= 72 (3 ngày)' })
    maxSessionHours?: number;

    @ApiPropertyOptional({
        description: 'Số lần đăng nhập sai tối đa trước khi bị khoá tài khoản',
        example: 5,
        minimum: 1,
        maximum: 20,
    })
    @IsOptional()
    @IsInt({ message: 'maxLoginAttempts phải là số nguyên' })
    @Min(1, { message: 'maxLoginAttempts phải >= 1' })
    @Max(20, { message: 'maxLoginAttempts phải <= 20' })
    maxLoginAttempts?: number;

    @ApiPropertyOptional({
        description: 'Thời gian khoá tài khoản sau khi đăng nhập sai quá số lần cho phép (phút)',
        example: 15,
        minimum: 0,
        maximum: 1440,
    })
    @IsOptional()
    @IsInt({ message: 'lockoutDurationMins phải là số nguyên' })
    @Min(0, { message: 'lockoutDurationMins phải >= 0' })
    @Max(1440, { message: 'lockoutDurationMins phải <= 1440 (24 giờ)' })
    lockoutDurationMins?: number;

    @ApiPropertyOptional({
        description: 'Bắt buộc xác thực đa yếu tố (MFA) khi đăng nhập',
        example: true,
    })
    @IsOptional()
    @IsBoolean({ message: 'mfaRequired phải là boolean' })
    mfaRequired?: boolean;
}
