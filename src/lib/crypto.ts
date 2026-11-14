import { createHash, randomBytes, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";

export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function generateVotingCredential(): string {
  // Short enough to type, long enough to be hard to guess: 10 chars base32-ish
  return randomBytes(8).toString("base64url").slice(0, 10).toUpperCase();
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function hashVotingCredential(credential: string): Promise<string> {
  return bcrypt.hash(normalizeCredential(credential), 10);
}

export async function verifyVotingCredential(
  credential: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(normalizeCredential(credential), hash);
}

export function normalizeCredential(credential: string): string {
  return credential.trim().toUpperCase();
}

export function fingerprintToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
