import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

// AES-256-GCM envelope: base64(iv | tag | ciphertext)
@Injectable()
export class CryptoService {
  private readonly key = createHash('sha256')
    .update(process.env.CREDENTIALS_ENCRYPTION_KEY || 'dev-only-insecure-key')
    .digest();

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
  }

  decrypt(envelope: string): string {
    const buf = Buffer.from(envelope, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  }

  encryptJson(value: unknown): string {
    return this.encrypt(JSON.stringify(value));
  }

  decryptJson<T = Record<string, unknown>>(envelope?: string | null): T {
    if (!envelope) return {} as T;
    return JSON.parse(this.decrypt(envelope)) as T;
  }
}
