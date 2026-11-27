import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';


const SRC_DIR = join(__dirname, '..');
const BANNED = /['"`](X-Client-Id|X-User-Id|X-User-ID|X-User-Role|X-User-Type|X-User-Name)['"`]/i;

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(js|jsx)$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });

describe('verified identity only (spec 0034)', () => {
  it('no source file sets an identity header', () => {
    const offenders = walk(SRC_DIR).filter((file) => BANNED.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
