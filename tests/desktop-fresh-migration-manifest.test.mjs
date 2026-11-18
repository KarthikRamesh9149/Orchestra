import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as verification from '../scripts/desktop/verify-fresh-db.mjs';

test('fresh and replay verification uses exact migration names and source bytes', async () => {
  assert.equal(typeof verification.readMigrationManifest, 'function', 'Expose a read-only source manifest');
  assert.equal(typeof verification.verifyAppliedMigrations, 'function', 'Verify ledger identity, not just count');
  const root = await mkdtemp(join(tmpdir(), 'orchestra-migrations-fixture-'));
  try {
    const migration = async (name, sql) => {
      const dir = join(root, name);
      await mkdir(dir);
      await writeFile(join(dir, 'migration.sql'), sql);
      return { name, checksum: createHash('sha256').update(sql).digest('hex'), applied: true };
    };
    const first = await migration('20260501000000_alpha', 'SELECT 1;\n');
    const next = await migration('20261118000000_beta', 'SELECT 2;\n');
    const approved = verification.readMigrationManifest(root);
    assert.equal(verification.verifyAppliedMigrations(approved, [next, first]), 2);
    assert.throws(() => verification.verifyAppliedMigrations(approved, [first]), /missing/i);
    assert.throws(() => verification.verifyAppliedMigrations(approved, [first, { ...next, checksum: first.checksum }]), /checksum/i);
    assert.throws(() => verification.verifyAppliedMigrations(approved, [first, { ...next, name: 'another' }]), /unexpected/i);
    assert.throws(() => verification.verifyAppliedMigrations(approved, [first, { ...next, applied: false }]), /unfinished/i);
    assert.throws(() => verification.verifyAppliedMigrations(approved, [first, next, first]), /duplicate/i);
  } finally {
    await rm(root, { recursive: true });
  }
});
