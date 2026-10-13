import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';

export const SALT_ROUNDS = 10;
export const OTP_LENGTH = 6;
export const MAX_OTP_ATTEMPTS = 5;
export const DEFAULT_ACTOR_ROLE: string = ACTOR_ROLE.PATIENT;
export const RESET_PASSWORD_PURPOSE = 'password_reset';
export const OTP_TTL_BUFFER_SECONDS = 60;
