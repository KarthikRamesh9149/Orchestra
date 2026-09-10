import bcrypt from "bcryptjs";

export async function hashPassword(password: string, rounds: number) {
  return bcrypt.hash(password, rounds);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}
