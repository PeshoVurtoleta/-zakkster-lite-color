/**
 * @zakkster/lite-color -- main test suite (node:test).
 *
 * Ported from the original vitest suite in v1.1.1's test consolidation. The
 * former `vi.mock('@zakkster/lite-lerp', ...)` is gone: as of v1.1.1 the three
 * interpolation primitives are vendored into Color.js, so these tests exercise
 * the real production functions rather than a mock that diverged from them.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    lerpOklch,
    lerpOklchTo,
    toCssOklch,
    parseOklch,
    multiStopGradient,
    multiStopGradientTo,
    createGradient,
    reverseGradient,
    randomFromGradient,
    bakeGradient,
    bakeCssGradient,
    toRgbTo,
    toRgbBytesTo,
    BAKE_STRIDE,
} from '../Color.js';

// vitest toBeCloseTo parity: passes when |actual - expected| < 10**-digits / 2.
// Default digits is 2, matching vitest's default.
const closeTo = (actual, expected, digits = 2) =>
    assert.ok(
        Math.abs(actual - expected) < Math.pow(10, -digits) / 2,
        `expected ${actual} to be close to ${expected} (${digits} digits)`
    );

const red = { l: 0.6, c: 0.25, h: 30 };
const blue = { l: 0.5, c: 0.20, h: 260 };
const green = { l: 0.8, c: 0.18, h: 145 };

describe('lite-color', () => {

    describe('lerpOklch()', () => {
        it('returns start color at t=0', () => {
            const result = lerpOklch(red, blue, 0);
            closeTo(result.l, red.l);
            closeTo(result.c, red.c);
            closeTo(result.h, red.h);
        });

        it('returns end color at t=1', () => {
            const result = lerpOklch(red, blue, 1);
            closeTo(result.l, blue.l);
            closeTo(result.c, blue.c);
        });

        it('interpolates at t=0.5', () => {
            const result = lerpOklch(red, blue, 0.5);
            closeTo(result.l, 0.55);
            closeTo(result.c, 0.225);
        });

        it('clamps lightness to [0, 1]', () => {
            const dark = { l: -0.5, c: 0.1, h: 0 };
            const bright = { l: 1.5, c: 0.1, h: 0 };
            assert.equal(lerpOklch(dark, bright, 0).l, 0);
            assert.equal(lerpOklch(dark, bright, 1).l, 1);
        });

        it('prevents negative chroma', () => {
            const a = { l: 0.5, c: 0.01, h: 0 };
            const b = { l: 0.5, c: -0.1, h: 0 };
            assert.equal(lerpOklch(a, b, 1).c, 0);
        });

        it('uses shortest-path hue interpolation', () => {
            const a = { l: 0.5, c: 0.1, h: 350 };
            const b = { l: 0.5, c: 0.1, h: 10 };
            const mid = lerpOklch(a, b, 0.5);
            const normalized = ((mid.h % 360) + 360) % 360;
            closeTo(normalized, 0);
        });
    });

    describe('lerpOklchTo() - Zero GC', () => {
        it('mutates the provided out object and returns it', () => {
            const out = { l: 0, c: 0, h: 0 };
            const result = lerpOklchTo(red, blue, 0.5, out);

            // Prove no new object was allocated (exact reference match)
            assert.equal(result, out);

            // Prove the math is correct
            closeTo(out.l, 0.55);
            closeTo(out.c, 0.225);
        });

        it('clamps lightness to [0, 1]', () => {
            const dark = { l: -0.5, c: 0.1, h: 0 };
            const bright = { l: 1.5, c: 0.1, h: 0 };
            const out = { l: 0, c: 0, h: 0 };

            lerpOklchTo(dark, bright, 0, out);
            assert.equal(out.l, 0);

            lerpOklchTo(dark, bright, 1, out);
            assert.equal(out.l, 1);
        });

        it('prevents negative chroma', () => {
            const a = { l: 0.5, c: 0.01, h: 0 };
            const b = { l: 0.5, c: -0.1, h: 0 };
            const out = { l: 0, c: 0, h: 0 };

            lerpOklchTo(a, b, 1, out);
            assert.equal(out.c, 0);
        });

        it('uses shortest-path hue interpolation', () => {
            const a = { l: 0.5, c: 0.1, h: 350 };
            const b = { l: 0.5, c: 0.1, h: 10 };
            const out = { l: 0, c: 0, h: 0 };

            lerpOklchTo(a, b, 0.5, out);
            const normalized = ((out.h % 360) + 360) % 360;
            closeTo(normalized, 0);
        });
    });

    describe('toCssOklch()', () => {
        it('formats standard color', () => {
            const css = toCssOklch({ l: 0.7, c: 0.15, h: 120 });
            assert.equal(css, 'oklch(0.7000 0.1500 120.00 / 1)');
        });

        it('includes alpha when provided', () => {
            const css = toCssOklch({ l: 0.5, c: 0.1, h: 60, a: 0.5 });
            assert.ok(css.includes('/ 0.5'));
        });

        it('defaults alpha to 1', () => {
            const css = toCssOklch({ l: 0.5, c: 0.1, h: 60 });
            assert.ok(css.includes('/ 1'));
        });

        it('uses fixed precision (no scientific notation)', () => {
            const css = toCssOklch({ l: 0.0001, c: 0.0001, h: 0.01 });
            assert.ok(!css.includes('e'));
        });
    });

    describe('parseOklch()', () => {
        it('parses standard oklch string', () => {
            const result = parseOklch('oklch(0.7 0.15 120)');
            closeTo(result.l, 0.7);
            closeTo(result.c, 0.15);
            closeTo(result.h, 120);
            assert.equal(result.a, 1);
        });

        it('parses oklch with alpha', () => {
            const result = parseOklch('oklch(0.5 0.1 60 / 0.5)');
            closeTo(result.a, 0.5);
        });

        it('round-trips through toCssOklch', () => {
            const original = { l: 0.7123, c: 0.1567, h: 123.45, a: 0.8 };
            const css = toCssOklch(original);
            const parsed = parseOklch(css);
            closeTo(parsed.l, original.l, 3);
            closeTo(parsed.c, original.c, 3);
            closeTo(parsed.h, original.h, 1);
        });

        it('throws on invalid string', () => {
            assert.throws(() => parseOklch('rgb(255, 0, 0)'), /cannot parse/);
        });
    });

    describe('multiStopGradient()', () => {
        const stops = [red, green, blue];

        it('returns first color at t=0', () => {
            const result = multiStopGradient(stops, 0);
            closeTo(result.l, red.l);
        });

        it('returns last color at t=1', () => {
            const result = multiStopGradient(stops, 1);
            closeTo(result.l, blue.l);
        });

        it('interpolates between stops', () => {
            const result = multiStopGradient(stops, 0.5);
            closeTo(result.l, green.l);
        });

        it('returns single color for 1-element array', () => {
            const result = multiStopGradient([red], 0.5);
            assert.equal(result, red);
        });

        it('throws on empty array', () => {
            assert.throws(() => multiStopGradient([], 0.5), /at least 1/);
        });

        it('accepts custom easing', () => {
            const easeIn = (t) => t * t;
            const linear = multiStopGradient(stops, 0.5);
            const eased = multiStopGradient(stops, 0.5, easeIn);
            // easeIn(0.5) = 0.25, so eased should be closer to the first color
            assert.ok(eased.l > linear.l - 0.3);
        });

        it('clamps t to [0, 1]', () => {
            const result = multiStopGradient(stops, 1.5);
            closeTo(result.l, blue.l);
        });
    });

    describe('multiStopGradientTo() - Zero GC', () => {
        const stops = [red, green, blue];

        it('mutates the provided out object and returns it', () => {
            const out = { l: 0, c: 0, h: 0 };
            const result = multiStopGradientTo(stops, 0.5, out);

            // Prove no new object was allocated
            assert.equal(result, out);

            // At t=0.5 with [red, green, blue], it should hit exactly green
            closeTo(out.l, green.l);
            closeTo(out.c, green.c);
            closeTo(out.h, green.h);
        });

        it('writes first color at t=0', () => {
            const out = { l: 0, c: 0, h: 0 };
            multiStopGradientTo(stops, 0, out);
            closeTo(out.l, red.l);
        });

        it('writes last color at t=1', () => {
            const out = { l: 0, c: 0, h: 0 };
            multiStopGradientTo(stops, 1, out);
            closeTo(out.l, blue.l);
        });

        it('writes single color for 1-element array', () => {
            const out = { l: 0, c: 0, h: 0 };
            multiStopGradientTo([red], 0.5, out);
            assert.equal(out.l, red.l);
            assert.equal(out.c, red.c);
            assert.equal(out.h, red.h);
        });

        it('throws on empty array', () => {
            const out = { l: 0, c: 0, h: 0 };
            assert.throws(() => multiStopGradientTo([], 0.5, out), /at least 1/);
        });

        it('accepts custom easing', () => {
            const easeIn = (t) => t * t;
            const outLinear = { l: 0, c: 0, h: 0 };
            const outEased = { l: 0, c: 0, h: 0 };

            multiStopGradientTo(stops, 0.5, outLinear);
            multiStopGradientTo(stops, 0.5, outEased, easeIn);

            // easeIn(0.5) = 0.25, so eased should be closer to the first color (red)
            assert.ok(outEased.l > outLinear.l - 0.3);
        });

        it('clamps t to [0, 1]', () => {
            const out = { l: 0, c: 0, h: 0 };
            multiStopGradientTo(stops, 1.5, out);
            closeTo(out.l, blue.l);
        });
    });

    describe('createGradient()', () => {
        it('returns a sampler function', () => {
            const sampler = createGradient([red, blue]);
            assert.equal(typeof sampler, 'function');
        });

        it('sampler returns interpolated colors', () => {
            const sampler = createGradient([red, blue]);
            const mid = sampler(0.5);
            closeTo(mid.l, 0.55);
        });

        it('throws on empty array', () => {
            assert.throws(() => createGradient([]), /at least 1/);
        });

        it('accepts easing function', () => {
            const easeIn = (t) => t * t;
            const sampler = createGradient([red, blue], easeIn);
            const result = sampler(0.5);
            assert.notEqual(result, undefined);
        });
    });

    describe('reverseGradient()', () => {
        it('returns reversed copy', () => {
            const original = [red, green, blue];
            const reversed = reverseGradient(original);
            assert.equal(reversed[0], blue);
            assert.equal(reversed[2], red);
        });

        it('does not mutate original', () => {
            const original = [red, green, blue];
            reverseGradient(original);
            assert.equal(original[0], red);
        });
    });

    describe('randomFromGradient()', () => {
        it('returns a color from the gradient', () => {
            const rng = { next: () => 0.5 };
            const result = randomFromGradient([red, blue], rng);
            closeTo(result.l, 0.55);
        });

        it('uses rng.next() for sampling', () => {
            const rng = { next: () => 0 };
            const result = randomFromGradient([red, blue], rng);
            closeTo(result.l, red.l);
        });
    });

    // === v1.1.0 -- LUT baking + RGB bridges ===

    describe('toRgbTo()', () => {
        it('converts OKLCH white to normalized sRGB white', () => {
            const out = new Float32Array(4);
            toRgbTo({ l: 1, c: 0, h: 0 }, out);
            closeTo(out[0], 1, 4);
            closeTo(out[1], 1, 4);
            closeTo(out[2], 1, 4);
            assert.equal(out[3], 1);
        });

        it('round-trips the sRGB red primary', () => {
            const out = new Float32Array(4);
            toRgbTo({ l: 0.62796, c: 0.25768, h: 29.234 }, out);
            closeTo(out[0], 1, 2);
            closeTo(out[1], 0, 2);
            closeTo(out[2], 0, 2);
        });

        it('writes at an offset without touching neighbours', () => {
            const out = new Float32Array(12).fill(-1);
            toRgbTo({ l: 0, c: 0, h: 0 }, out, 4);
            assert.equal(out[3], -1);
            assert.equal(out[4], 0);
            assert.equal(out[7], 1);
            assert.equal(out[8], -1);
        });

        it('clips out-of-gamut colors into [0,1] instead of emitting NaN', () => {
            const out = new Float32Array(4);
            toRgbTo({ l: 0.7, c: 0.35, h: 145 }, out);
            for (let i = 0; i < 4; i++) {
                assert.equal(Number.isNaN(out[i]), false);
                assert.ok(out[i] >= 0);
                assert.ok(out[i] <= 1);
            }
        });

        it('reads alpha and clamps it', () => {
            const out = new Float32Array(4);
            toRgbTo({ l: 0.5, c: 0.1, h: 30, a: 0.25 }, out);
            closeTo(out[3], 0.25);
            toRgbTo({ l: 0.5, c: 0.1, h: 30, a: 5 }, out);
            assert.equal(out[3], 1);
        });

        it('returns the same out reference (zero-GC)', () => {
            const out = new Float32Array(4);
            assert.equal(toRgbTo({ l: 0.5, c: 0.1, h: 30 }, out), out);
        });
    });

    describe('toRgbBytesTo()', () => {
        it('converts OKLCH white to 255,255,255,255', () => {
            const out = new Uint8ClampedArray(4);
            toRgbBytesTo({ l: 1, c: 0, h: 0 }, out);
            assert.deepEqual(Array.from(out), [255, 255, 255, 255]);
        });

        it('converts OKLCH black to 0,0,0,255', () => {
            const out = new Uint8ClampedArray(4);
            toRgbBytesTo({ l: 0, c: 0, h: 0 }, out);
            assert.deepEqual(Array.from(out), [0, 0, 0, 255]);
        });

        it('writes ImageData-style at a pixel offset', () => {
            const data = new Uint8ClampedArray(16);
            toRgbBytesTo({ l: 1, c: 0, h: 0 }, data, 2 * 4);
            assert.equal(data[7], 0);
            assert.deepEqual(Array.from(data.slice(8, 12)), [255, 255, 255, 255]);
        });

        it('encodes alpha as a byte', () => {
            const out = new Uint8Array(4);
            toRgbBytesTo({ l: 0.5, c: 0, h: 0, a: 0.5 }, out);
            assert.equal(out[3], 128);
        });

        it('never writes NaN for out-of-gamut colors', () => {
            const out = new Uint8Array(4);
            toRgbBytesTo({ l: 0.7, c: 0.4, h: 145 }, out);
            for (let i = 0; i < 4; i++) assert.equal(Number.isNaN(out[i]), false);
        });
    });

    describe('bakeGradient()', () => {
        // v2.0.0: stride is 4 floats/stop (l, c, h, a), up from 3.
        it('exports BAKE_STRIDE = 4', () => {
            assert.equal(BAKE_STRIDE, 4);
        });

        it('returns a Float32Array of steps * BAKE_STRIDE', () => {
            const lut = bakeGradient([red, blue], 16);
            assert.ok(lut instanceof Float32Array);
            assert.equal(lut.length, 16 * 4);
        });

        it('pins the endpoints to the first and last stop', () => {
            const steps = 32;
            const lut = bakeGradient([red, blue], steps);
            closeTo(lut[0], red.l, 5);
            closeTo(lut[1], red.c, 5);
            const last = (steps - 1) * BAKE_STRIDE;
            closeTo(lut[last], blue.l, 5);
            closeTo(lut[last + 1], blue.c, 5);
        });

        it('matches multiStopGradient at every step, including alpha', () => {
            const colors = [red, green, blue];
            const steps = 17;
            const lut = bakeGradient(colors, steps);
            for (let i = 0; i < steps; i++) {
                const expected = multiStopGradient(colors, i / (steps - 1));
                const base = i * BAKE_STRIDE;
                closeTo(lut[base], expected.l, 5);
                closeTo(lut[base + 1], expected.c, 5);
                closeTo(lut[base + 2], expected.h, 4);
                closeTo(lut[base + 3], expected.a ?? 1, 5);
            }
        });

        it('bakes interpolated alpha into the 4th float of each stop', () => {
            const a0 = { l: 0.5, c: 0.1, h: 30, a: 0 };
            const a1 = { l: 0.5, c: 0.1, h: 30, a: 1 };
            const steps = 5;
            const lut = bakeGradient([a0, a1], steps);
            for (let i = 0; i < steps; i++) {
                closeTo(lut[i * BAKE_STRIDE + 3], i / (steps - 1), 5);
            }
        });

        it('defaults missing alpha to 1 in the LUT', () => {
            const lut = bakeGradient([red, blue], 4); // neither stop has `a`
            for (let i = 0; i < 4; i++) closeTo(lut[i * BAKE_STRIDE + 3], 1, 5);
        });

        it('applies the optional ease, matching createGradient', () => {
            const ease = (x) => x * x;
            const colors = [red, blue];
            const lut = bakeGradient(colors, 8, undefined, ease);
            const sampler = createGradient(colors, ease);
            for (let i = 0; i < 8; i++) {
                closeTo(lut[i * BAKE_STRIDE], sampler(i / 7).l, 5);
            }
        });

        it('writes into a caller-owned out (zero-GC re-bake)', () => {
            const out = new Float32Array(16 * 4);
            const result = bakeGradient([red, blue], 16, out);
            assert.equal(result, out);
            closeTo(out[0], red.l, 5);
        });

        it('accepts an oversized out buffer', () => {
            const out = new Float32Array(16 * 4 * 2);
            assert.doesNotThrow(() => bakeGradient([red, blue], 16, out));
        });

        it('throws when out is too small', () => {
            assert.throws(
                () => bakeGradient([red, blue], 16, new Float32Array(16 * 4 - 1)),
                /length >= 64/
            );
        });

        it('handles a single color', () => {
            const lut = bakeGradient([red], 4);
            assert.equal(lut.length, 4 * 4);
            for (let i = 0; i < 4; i++) closeTo(lut[i * BAKE_STRIDE], red.l, 5);
        });

        it('handles steps = 1 (t = 0)', () => {
            const lut = bakeGradient([red, blue], 1);
            assert.equal(lut.length, 4);
            closeTo(lut[0], red.l, 5);
        });

        it('truncates fractional steps instead of corrupting the LUT', () => {
            const lut = bakeGradient([red, blue], 8.9);
            assert.equal(lut.length, 8 * 4);
        });

        it('throws on invalid steps', () => {
            assert.throws(() => bakeGradient([red, blue], 0), /steps/);
            assert.throws(() => bakeGradient([red, blue], -4), /steps/);
            assert.throws(() => bakeGradient([red, blue], NaN), /steps/);
            assert.throws(() => bakeGradient([red, blue], Infinity), /steps/);
            assert.throws(() => bakeGradient([red, blue], '16'), /steps/);
        });

        it('throws on an empty color array', () => {
            assert.throws(() => bakeGradient([], 8), /at least 1 color/);
        });

        it('is allocation-free when reusing out', () => {
            const out = new Float32Array(100 * BAKE_STRIDE);
            const before = out.buffer;
            for (let i = 0; i < 50; i++) bakeGradient([red, green, blue], 100, out);
            assert.equal(out.buffer, before);
        });
    });

    describe('bakeCssGradient()', () => {
        it('returns `steps` CSS strings', () => {
            const css = bakeCssGradient([red, blue], 5);
            assert.equal(css.length, 5);
            css.forEach((s) => assert.match(s, /^oklch\(/));
        });

        it('matches toCssOklch(multiStopGradient(...)) at every step', () => {
            const colors = [red, green, blue];
            const steps = 9;
            const css = bakeCssGradient(colors, steps);
            for (let i = 0; i < steps; i++) {
                const expected = toCssOklch(multiStopGradient(colors, i / (steps - 1)));
                assert.equal(css[i], expected);
            }
        });

        it('applies the optional ease', () => {
            const ease = (x) => x * x;
            const css = bakeCssGradient([red, blue], 4, ease);
            assert.equal(css[1], toCssOklch(multiStopGradient([red, blue], 1 / 3, ease)));
        });

        it('handles a single color', () => {
            const css = bakeCssGradient([red], 3);
            assert.equal(new Set(css).size, 1);
        });

        it('throws on invalid steps and empty colors', () => {
            assert.throws(() => bakeCssGradient([red], 0), /steps/);
            assert.throws(() => bakeCssGradient([], 4), /at least 1 color/);
        });

        it('carries interpolated alpha through to the CSS output', () => {
            const a0 = { l: 0.5, c: 0.1, h: 30, a: 0 };
            const a1 = { l: 0.5, c: 0.1, h: 30, a: 1 };
            const css = bakeCssGradient([a0, a1], 3);
            assert.match(css[0], /\/ 0\)$/);
            assert.match(css[1], /\/ 0\.5\)$/);
            assert.match(css[2], /\/ 1\)$/);
        });
    });

    // === v2.0.0 -- alpha threading + full CSS Color 4 grammar ===

    describe('alpha interpolation (v2.0.0)', () => {
        it('lerpOklch interpolates alpha linearly', () => {
            const r = lerpOklch({ l: 0.5, c: 0.1, h: 30, a: 0.2 },
                                { l: 0.5, c: 0.1, h: 30, a: 0.8 }, 0.5);
            closeTo(r.a, 0.5);
        });

        it('lerpOklch treats a missing alpha as 1 (opaque)', () => {
            // second color omits `a` -> 1; midpoint of (0.5, 1) is 0.75
            const r = lerpOklch({ l: 0.5, c: 0.1, h: 30, a: 0.5 },
                                { l: 0.5, c: 0.1, h: 30 }, 0.5);
            closeTo(r.a, 0.75);
        });

        it('lerpOklch clamps alpha to [0,1] under extrapolation', () => {
            const lo = lerpOklch({ l: 0.5, c: 0.1, h: 30, a: 0 },
                                 { l: 0.5, c: 0.1, h: 30, a: 1 }, -1);
            assert.equal(lo.a, 0);
            const hi = lerpOklch({ l: 0.5, c: 0.1, h: 30, a: 0 },
                                 { l: 0.5, c: 0.1, h: 30, a: 1 }, 2);
            assert.equal(hi.a, 1);
        });

        it('lerpOklchTo writes alpha into out', () => {
            const out = { l: 0, c: 0, h: 0, a: 0 };
            lerpOklchTo({ l: 0.5, c: 0.1, h: 30, a: 0.2 },
                        { l: 0.5, c: 0.1, h: 30, a: 0.6 }, 0.5, out);
            closeTo(out.a, 0.4);
        });

        it('multiStopGradientTo defaults alpha to 1 when stops omit it', () => {
            const out = { l: 0, c: 0, h: 0, a: 0 };
            multiStopGradientTo([red, blue], 0.5, out);
            assert.equal(out.a, 1);
        });

        it('multiStopGradientTo carries alpha at the endpoints', () => {
            const out = { l: 0, c: 0, h: 0, a: 0 };
            multiStopGradientTo([{ l: 0.5, c: 0.1, h: 30, a: 0.3 },
                                 { l: 0.5, c: 0.1, h: 30, a: 0.9 }], 1, out);
            closeTo(out.a, 0.9);
        });
    });

    describe('parseOklch() - CSS Color 4 grammar (v2.0.0)', () => {
        it('parses L and alpha percentages (0-100% -> 0-1)', () => {
            const r = parseOklch('oklch(50% 0.1 120 / 50%)');
            closeTo(r.l, 0.5);
            closeTo(r.a, 0.5);
        });

        it('maps chroma percentage against 0.4, NOT 1.0', () => {
            // 100% chroma is 0.4 in CSS Color 4; 50% is 0.2.
            closeTo(parseOklch('oklch(0.7 100% 120)').c, 0.4);
            closeTo(parseOklch('oklch(0.7 50% 120)').c, 0.2);
        });

        it('parses `none` channels as 0, with omitted alpha still 1', () => {
            const r = parseOklch('oklch(none none none)');
            assert.equal(r.l, 0);
            assert.equal(r.c, 0);
            assert.equal(r.h, 0);
            assert.equal(r.a, 1); // omitted -> opaque
        });

        it('distinguishes explicit `none` alpha (0) from omitted alpha (1)', () => {
            assert.equal(parseOklch('oklch(0.7 0.1 120 / none)').a, 0);
            assert.equal(parseOklch('oklch(0.7 0.1 120)').a, 1);
        });

        it('parses hue angle units: deg, rad, grad, turn, unitless', () => {
            closeTo(parseOklch('oklch(0.7 0.1 120deg)').h, 120);
            closeTo(parseOklch('oklch(0.7 0.1 120)').h, 120);
            closeTo(parseOklch('oklch(0.7 0.1 0.5turn)').h, 180);
            closeTo(parseOklch('oklch(0.7 0.1 200grad)').h, 180);
            closeTo(parseOklch('oklch(0.7 0.1 3.141592653589793rad)').h, 180, 3);
        });

        it('parses the slash alpha form with both number and percentage', () => {
            closeTo(parseOklch('oklch(0.7 0.1 120 / 0.25)').a, 0.25);
            closeTo(parseOklch('oklch(0.7 0.1 120 / 25%)').a, 0.25);
        });

        it('parses leading-dot numbers', () => {
            const r = parseOklch('oklch(.5 .1 .5)');
            closeTo(r.l, 0.5);
            closeTo(r.c, 0.1);
            closeTo(r.h, 0.5);
        });

        it('tolerates flexible whitespace and no-space slash', () => {
            closeTo(parseOklch('oklch(   0.7    0.1   120   )').l, 0.7);
            closeTo(parseOklch('oklch(0.7 0.1 120/0.5)').a, 0.5);
        });

        it('is case-insensitive on the function name and units', () => {
            closeTo(parseOklch('OKLCH(0.7 0.1 0.5TURN)').h, 180);
        });

        it('throws on malformed input (fail at config time, not render time)', () => {
            assert.throws(() => parseOklch('oklch(0.7 0.1)'), /cannot parse/);
            assert.throws(() => parseOklch('oklch()'), /cannot parse/);
            assert.throws(() => parseOklch('rgb(255, 0, 0)'), /cannot parse/);
            assert.throws(() => parseOklch('not a color'), /cannot parse/);
        });
    });

    describe('parse/format round-trip stability (seeded corpus)', () => {
        // Seeded LCG so the corpus is deterministic and replayable.
        const makeRng = (seed) => () => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            return seed / 0x7fffffff;
        };

        it('parse -> format -> parse is a fixed point across 200 samples', () => {
            const rng = makeRng(0x5eed);
            for (let i = 0; i < 200; i++) {
                const color = {
                    l: rng(),
                    c: rng() * 0.4,
                    h: rng() * 360,
                    a: rng(),
                };
                const css1 = toCssOklch(color);
                const p1 = parseOklch(css1);
                const css2 = toCssOklch(p1);
                // Once formatted, re-parsing and re-formatting must not drift.
                assert.equal(css2, css1, `drift at sample ${i}: ${css1} -> ${css2}`);
                assert.deepEqual(parseOklch(css2), p1);
            }
        });
    });
});
