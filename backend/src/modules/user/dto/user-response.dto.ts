export class UserResponseDto {
  userId!: string;
  email!: string;
  status!: string;
  emailVerified!: boolean;
  mfaEnabled!: boolean;
  createdAt!: Date;

  constructor(partial: Partial<UserResponseDto>) {
    Object.assign(this, partial);
  }
}
