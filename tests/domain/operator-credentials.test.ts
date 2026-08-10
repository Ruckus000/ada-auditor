import { describe, expect, it } from 'vitest';
import {
  MIN_PASSWORD_LENGTH,
  WeakPasswordError,
  assertPasswordStrength,
  hashPassword,
  verifyPassword,
} from '../../src/domain/operator-credentials';

const PASSWORD = 'correct-horse-battery-staple';

describe('operator credentials', () => {
  it('round-trips a password', async () => {
    const stored = await hashPassword(PASSWORD);
    expect(await verifyPassword(PASSWORD, stored)).toBe(true);
  });

  it('rejects the wrong password', async () => {
    const stored = await hashPassword(PASSWORD);
    expect(await verifyPassword('correct-horse-battery-stapl', stored)).toBe(false);
  });

  // Two operators with the same password must not share a hash, or one leaked
  // row tells you about every account that chose the same thing.
  it('salts, so the same password hashes differently every time', async () => {
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
  });

  it('records the cost parameters in the stored value', async () => {
    const stored = await hashPassword(PASSWORD);
    expect(stored.startsWith('scrypt$16384$8$1$')).toBe(true);
    expect(stored.split('$')).toHaveLength(6);
  });

  describe('malformed stored values', () => {
    // A corrupt row must read as "this password does not match", never as a
    // 500 — an error there tells an attacker they found something interesting.
    it.each([
      ['empty', ''],
      ['not our scheme', 'bcrypt$16384$8$1$c2FsdA==$aGFzaA=='],
      ['too few fields', 'scrypt$16384$8$1$c2FsdA=='],
      ['non-numeric cost', 'scrypt$abc$8$1$c2FsdA==$aGFzaA=='],
      ['empty hash', 'scrypt$16384$8$1$c2FsdA==$'],
    ])('returns false for a stored value that is %s', async (_label, stored) => {
      await expect(verifyPassword(PASSWORD, stored)).resolves.toBe(false);
    });

    // The parameters come out of the database, and data from the database is
    // still data. A row naming a work factor of 2^30 would hang the process.
    it('refuses an absurd work factor instead of trying to honour it', async () => {
      const started = Date.now();
      await expect(
        verifyPassword(PASSWORD, `scrypt$${2 ** 30}$8$1$c2FsdA==$aGFzaA==`),
      ).resolves.toBe(false);
      expect(Date.now() - started).toBeLessThan(1000);
    });
  });

  describe('strength', () => {
    it('accepts a password at the minimum length', () => {
      expect(() => assertPasswordStrength('a'.repeat(MIN_PASSWORD_LENGTH))).not.toThrow();
    });

    it('refuses one character short', () => {
      expect(() => assertPasswordStrength('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toThrow(
        WeakPasswordError,
      );
    });

    it('refuses to hash a weak password at all', async () => {
      await expect(hashPassword('short')).rejects.toThrow(WeakPasswordError);
    });
  });
});
