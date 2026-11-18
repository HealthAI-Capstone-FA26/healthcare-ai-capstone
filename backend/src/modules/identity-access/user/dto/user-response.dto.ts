export class UserResponseDto {
  userId!: string;
  email!: string;
  status!: string;
  emailVerified!: boolean;
  mfaEnabled!: boolean;
  createdAt!: Date;
  fullName?: string;
  actorRole?: string;
  avatarUrl?: string;
  phoneNumber?: string;

  constructor(partial: Partial<UserResponseDto>) {
    Object.assign(this, partial);
  }
}
