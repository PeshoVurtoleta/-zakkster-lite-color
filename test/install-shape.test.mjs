/**
 * Install-shape regression for v1.1.1.
 *
 * Before v1.1.1, Color.js did a top-level `import ... from '@zakkster/lite-lerp'`
 * declared only as a peer. Under pnpm's default and Yarn Classic the peer is not
 * installed and `import '@zakkster/lite-color'` throws ERR_MODULE_NOT_FOUND
 * before any function runs.
 *
 * These tests pin the fix: the source carries no bare '@zakkster/*' import, and
 * the module imports and computes correctly with no dependency present.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const colorPath = join(here, '..', 'Color.js');

test('Color.js has no bare @zakkster/* (or any non-node) import', () => {
    const src = readFileSync(colorPath, 'utf8');
    // Match every `from '...'` / `import '...'` specifier.
    const specifiers = [...src.matchAll(/(?:^|\s)(?:from|import)\s+['"]([^'"]+)['"]/g)]
        .map((m) => m[1]);

    const bare = specifiers.filter(
        (s) => !s.startsWith('.') && !s.startsWith('/') && !s.startsWith('node:')
    );

    assert.deepEqual(
        bare,
        [],
        `Color.js must not import any runtime dependency; found: ${bare.join(', ')}`
    );
});

test('the module imports and computes with no dependency installed', async () => {
    // This test file resolves nothing but node:* and a relative path, so it runs
    // green in a directory whose node_modules is empty — exactly the pnpm /
    // Yarn Classic scenario that used to throw ERR_MODULE_NOT_FOUND.
    const mod = await import('../Color.js');

    // Sanity: the vendored primitives feed the exported hot path correctly.
    const a = { l: 0.7, c: 0.25, h: 30 };
    const b = { l: 0.8, c: 0.15, h: 230 };

    const mid = mod.lerpOklch(a, b, 0.5);
    assert.equal(mid.l, 0.75);            // lerp midpoint of L
    assert.equal(mid.c, 0.2);             // lerp midpoint of C

    // lerpAngle takes the shortest path: 30 -> 230 is +200, wrapped to -160,
    // so the half-way hue is 30 + (-160 * 0.5) = -50.
    assert.ok(Math.abs(mid.h - -50) < 1e-9, `hue was ${mid.h}`);

    // Exact endpoints (the lerp t===1 branch is vendored intact).
    const end = mod.lerpOklch(a, b, 1);
    assert.equal(end.l, b.l);
    assert.equal(end.c, b.c);
});
