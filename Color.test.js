import { describe, it, expect, vi } from 'vitest';

// Mock the lite-lerp dependency with actual implementations
vi.mock('@zakkster/lite-lerp', () => ({
    clamp: (val, min, max) => Math.max(min, Math.min(max, val)),
    lerp: (a, b, t) => a + (b - a) * t,
    lerpAngle: (a, b, t) => {
        const delta = ((b - a + 540) % 360) - 180;
        return a + delta * t;
    },
}));

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
    toRgbBytesTo
} from './Color.js';

const red   = { l: 0.6, c: 0.25, h: 30 };
const blue  = { l: 0.5, c: 0.20, h: 260 };
const green = { l: 0.8, c: 0.18, h: 145 };

describe('🎨 lite-color', () => {

    describe('lerpOklch()', () => {
        it('returns start color at t=0', () => {
            const result = lerpOklch(red, blue, 0);
            expect(result.l).toBeCloseTo(red.l);
            expect(result.c).toBeCloseTo(red.c);
            expect(result.h).toBeCloseTo(red.h);
        });

        it('returns end color at t=1', () => {
            const result = lerpOklch(red, blue, 1);
            expect(result.l).toBeCloseTo(blue.l);
            expect(result.c).toBeCloseTo(blue.c);
        });

        it('interpolates at t=0.5', () => {
            const result = lerpOklch(red, blue, 0.5);
            expect(result.l).toBeCloseTo(0.55);
            expect(result.c).toBeCloseTo(0.225);
        });

        it('clamps lightness to [0, 1]', () => {
            const dark = { l: -0.5, c: 0.1, h: 0 };
            const bright = { l: 1.5, c: 0.1, h: 0 };
            expect(lerpOklch(dark, bright, 0).l).toBe(0);
            expect(lerpOklch(dark, bright, 1).l).toBe(1);
        });

        it('prevents negative chroma', () => {
            const a = { l: 0.5, c: 0.01, h: 0 };
            const b = { l: 0.5, c: -0.1, h: 0 };
            expect(lerpOklch(a, b, 1).c).toBe(0);
        });

        it('uses shortest-path hue interpolation', () => {
            const a = { l: 0.5, c: 0.1, h: 350 };
            const b = { l: 0.5, c: 0.1, h: 10 };
            const mid = lerpOklch(a, b, 0.5);
            const normalized = ((mid.h % 360) + 360) % 360;
            expect(normalized).toBeCloseTo(0);
        });
    });

    describe('lerpOklchTo() - Zero GC', () => {
        it('mutates the provided out object and returns it', () => {
            const out = { l: 0, c: 0, h: 0 };
            const result = lerpOklchTo(red, blue, 0.5, out);

            // Prove no new object was allocated (exact reference match)
            expect(result).toBe(out);

            // Prove the math is correct
            expect(out.l).toBeCloseTo(0.55);
            expect(out.c).toBeCloseTo(0.225);
        });

        it('clamps lightness to [0, 1]', () => {
            const dark = { l: -0.5, c: 0.1, h: 0 };
            const bright = { l: 1.5, c: 0.1, h: 0 };
            const out = { l: 0, c: 0, h: 0 };

            lerpOklchTo(dark, bright, 0, out);
            expect(out.l).toBe(0);

            lerpOklchTo(dark, bright, 1, out);
            expect(out.l).toBe(1);
        });

        it('prevents negative chroma', () => {
            const a = { l: 0.5, c: 0.01, h: 0 };
            const b = { l: 0.5, c: -0.1, h: 0 };
            const out = { l: 0, c: 0, h: 0 };

            lerpOklchTo(a, b, 1, out);
            expect(out.c).toBe(0);
        });

        it('uses shortest-path hue interpolation', () => {
            const a = { l: 0.5, c: 0.1, h: 350 };
            const b = { l: 0.5, c: 0.1, h: 10 };
            const out = { l: 0, c: 0, h: 0 };

            lerpOklchTo(a, b, 0.5, out);
            const normalized = ((out.h % 360) + 360) % 360;
            expect(normalized).toBeCloseTo(0);
        });
    });

    describe('toCssOklch()', () => {
        it('formats standard color', () => {
            const css = toCssOklch({ l: 0.7, c: 0.15, h: 120 });
            expect(css).toBe('oklch(0.7000 0.1500 120.00 / 1)');
        });

        it('includes alpha when provided', () => {
            const css = toCssOklch({ l: 0.5, c: 0.1, h: 60, a: 0.5 });
            expect(css).toContain('/ 0.5');
        });

        it('defaults alpha to 1', () => {
            const css = toCssOklch({ l: 0.5, c: 0.1, h: 60 });
            expect(css).toContain('/ 1');
        });

        it('uses fixed precision (no scientific notation)', () => {
            const css = toCssOklch({ l: 0.0001, c: 0.0001, h: 0.01 });
            expect(css).not.toContain('e');
        });
    });

    describe('parseOklch()', () => {
        it('parses standard oklch string', () => {
            const result = parseOklch('oklch(0.7 0.15 120)');
            expect(result.l).toBeCloseTo(0.7);
            expect(result.c).toBeCloseTo(0.15);
            expect(result.h).toBeCloseTo(120);
            expect(result.a).toBe(1);
        });

        it('parses oklch with alpha', () => {
            const result = parseOklch('oklch(0.5 0.1 60 / 0.5)');
            expect(result.a).toBeCloseTo(0.5);
        });

        it('round-trips through toCssOklch', () => {
            const original = { l: 0.7123, c: 0.1567, h: 123.45, a: 0.8 };
            const css = toCssOklch(original);
            const parsed = parseOklch(css);
            expect(parsed.l).toBeCloseTo(original.l, 3);
            expect(parsed.c).toBeCloseTo(original.c, 3);
            expect(parsed.h).toBeCloseTo(original.h, 1);
        });

        it('throws on invalid string', () => {
            expect(() => parseOklch('rgb(255, 0, 0)')).toThrow(/cannot parse/);
        });
    });

    describe('multiStopGradient()', () => {
        const stops = [red, green, blue];

        it('returns first color at t=0', () => {
            const result = multiStopGradient(stops, 0);
            expect(result.l).toBeCloseTo(red.l);
        });

        it('returns last color at t=1', () => {
            const result = multiStopGradient(stops, 1);
            expect(result.l).toBeCloseTo(blue.l);
        });

        it('interpolates between stops', () => {
            const result = multiStopGradient(stops, 0.5);
            expect(result.l).toBeCloseTo(green.l);
        });

        it('returns single color for 1-element array', () => {
            const result = multiStopGradient([red], 0.5);
            expect(result).toBe(red);
        });

        it('throws on empty array', () => {
            expect(() => multiStopGradient([], 0.5)).toThrow(/at least 1/);
        });

        it('accepts custom easing', () => {
            const easeIn = (t) => t * t;
            const linear = multiStopGradient(stops, 0.5);
            const eased = multiStopGradient(stops, 0.5, easeIn);
            // easeIn(0.5) = 0.25, so eased should be closer to the first color
            expect(eased.l).toBeGreaterThan(linear.l - 0.3);
        });

        it('clamps t to [0, 1]', () => {
            const result = multiStopGradient(stops, 1.5);
            expect(result.l).toBeCloseTo(blue.l);
        });
    });

    describe('multiStopGradientTo() - Zero GC', () => {
        const stops = [red, green, blue];

        it('mutates the provided out object and returns it', () => {
            const out = { l: 0, c: 0, h: 0 };
            const result = multiStopGradientTo(stops, 0.5, out);

            // Prove no new object was allocated
            expect(result).toBe(out);

            // At t=0.5 with [red, green, blue], it should hit exactly green
            expect(out.l).toBeCloseTo(green.l);
            expect(out.c).toBeCloseTo(green.c);
            expect(out.h).toBeCloseTo(green.h);
        });

        it('writes first color at t=0', () => {
            const out = { l: 0, c: 0, h: 0 };
            multiStopGradientTo(stops, 0, out);
            expect(out.l).toBeCloseTo(red.l);
        });

        it('writes last color at t=1', () => {
            const out = { l: 0, c: 0, h: 0 };
            multiStopGradientTo(stops, 1, out);
            expect(out.l).toBeCloseTo(blue.l);
        });

        it('writes single color for 1-element array', () => {
            const out = { l: 0, c: 0, h: 0 };
            multiStopGradientTo([red], 0.5, out);
            expect(out.l).toBe(red.l);
            expect(out.c).toBe(red.c);
            expect(out.h).toBe(red.h);
        });

        it('throws on empty array', () => {
            const out = { l: 0, c: 0, h: 0 };
            expect(() => multiStopGradientTo([], 0.5, out)).toThrow(/at least 1/);
        });

        it('accepts custom easing', () => {
            const easeIn = (t) => t * t;
            const outLinear = { l: 0, c: 0, h: 0 };
            const outEased = { l: 0, c: 0, h: 0 };

            multiStopGradientTo(stops, 0.5, outLinear);
            multiStopGradientTo(stops, 0.5, outEased, easeIn);

            // easeIn(0.5) = 0.25, so eased should be closer to the first color (red)
            expect(outEased.l).toBeGreaterThan(outLinear.l - 0.3);
        });

        it('clamps t to [0, 1]', () => {
            const out = { l: 0, c: 0, h: 0 };
            multiStopGradientTo(stops, 1.5, out);
            expect(out.l).toBeCloseTo(blue.l);
        });
    });

    describe('createGradient()', () => {
        it('returns a sampler function', () => {
            const sampler = createGradient([red, blue]);
            expect(sampler).toBeTypeOf('function');
        });

        it('sampler returns interpolated colors', () => {
            const sampler = createGradient([red, blue]);
            const mid = sampler(0.5);
            expect(mid.l).toBeCloseTo(0.55);
        });

        it('throws on empty array', () => {
            expect(() => createGradient([])).toThrow(/at least 1/);
        });

        it('accepts easing function', () => {
            const easeIn = (t) => t * t;
            const sampler = createGradient([red, blue], easeIn);
            const result = sampler(0.5);
            expect(result).toBeDefined();
        });
    });

    describe('reverseGradient()', () => {
        it('returns reversed copy', () => {
            const original = [red, green, blue];
            const reversed = reverseGradient(original);
            expect(reversed[0]).toBe(blue);
            expect(reversed[2]).toBe(red);
        });

        it('does not mutate original', () => {
            const original = [red, green, blue];
            reverseGradient(original);
            expect(original[0]).toBe(red);
        });
    });

    describe('randomFromGradient()', () => {
        it('returns a color from the gradient', () => {
            const rng = { next: () => 0.5 };
            const result = randomFromGradient([red, blue], rng);
            expect(result.l).toBeCloseTo(0.55);
        });

        it('uses rng.next() for sampling', () => {
            const rng = { next: () => 0 };
            const result = randomFromGradient([red, blue], rng);
            expect(result.l).toBeCloseTo(red.l);
        });
    });

    // === v1.1.0 — LUT baking + RGB bridges ===

    describe('toRgbTo()', () => {
        it('converts OKLCH white to normalized sRGB white', () => {
            const out = new Float32Array(4);
            toRgbTo({ l: 1, c: 0, h: 0 }, out);
            expect(out[0]).toBeCloseTo(1, 4);
            expect(out[1]).toBeCloseTo(1, 4);
            expect(out[2]).toBeCloseTo(1, 4);
            expect(out[3]).toBe(1);
        });

        it('round-trips the sRGB red primary', () => {
            const out = new Float32Array(4);
            toRgbTo({ l: 0.62796, c: 0.25768, h: 29.234 }, out);
            expect(out[0]).toBeCloseTo(1, 2);
            expect(out[1]).toBeCloseTo(0, 2);
            expect(out[2]).toBeCloseTo(0, 2);
        });

        it('writes at an offset without touching neighbours', () => {
            const out = new Float32Array(12).fill(-1);
            toRgbTo({ l: 0, c: 0, h: 0 }, out, 4);
            expect(out[3]).toBe(-1);
            expect(out[4]).toBe(0);
            expect(out[7]).toBe(1);
            expect(out[8]).toBe(-1);
        });

        it('clips out-of-gamut colors into [0,1] instead of emitting NaN', () => {
            const out = new Float32Array(4);
            toRgbTo({ l: 0.7, c: 0.35, h: 145 }, out);
            for (let i = 0; i < 4; i++) {
                expect(Number.isNaN(out[i])).toBe(false);
                expect(out[i]).toBeGreaterThanOrEqual(0);
                expect(out[i]).toBeLessThanOrEqual(1);
            }
        });

        it('reads alpha and clamps it', () => {
            const out = new Float32Array(4);
            toRgbTo({ l: 0.5, c: 0.1, h: 30, a: 0.25 }, out);
            expect(out[3]).toBeCloseTo(0.25);
            toRgbTo({ l: 0.5, c: 0.1, h: 30, a: 5 }, out);
            expect(out[3]).toBe(1);
        });

        it('returns the same out reference (zero-GC)', () => {
            const out = new Float32Array(4);
            expect(toRgbTo({ l: 0.5, c: 0.1, h: 30 }, out)).toBe(out);
        });
    });

    describe('toRgbBytesTo()', () => {
        it('converts OKLCH white to 255,255,255,255', () => {
            const out = new Uint8ClampedArray(4);
            toRgbBytesTo({ l: 1, c: 0, h: 0 }, out);
            expect(Array.from(out)).toEqual([255, 255, 255, 255]);
        });

        it('converts OKLCH black to 0,0,0,255', () => {
            const out = new Uint8ClampedArray(4);
            toRgbBytesTo({ l: 0, c: 0, h: 0 }, out);
            expect(Array.from(out)).toEqual([0, 0, 0, 255]);
        });

        it('writes ImageData-style at a pixel offset', () => {
            const data = new Uint8ClampedArray(16);
            toRgbBytesTo({ l: 1, c: 0, h: 0 }, data, 2 * 4);
            expect(data[7]).toBe(0);
            expect(Array.from(data.slice(8, 12))).toEqual([255, 255, 255, 255]);
        });

        it('encodes alpha as a byte', () => {
            const out = new Uint8Array(4);
            toRgbBytesTo({ l: 0.5, c: 0, h: 0, a: 0.5 }, out);
            expect(out[3]).toBe(128);
        });

        it('never writes NaN for out-of-gamut colors', () => {
            const out = new Uint8Array(4);
            toRgbBytesTo({ l: 0.7, c: 0.4, h: 145 }, out);
            for (let i = 0; i < 4; i++) expect(Number.isNaN(out[i])).toBe(false);
        });
    });

    describe('bakeGradient()', () => {
        it('returns a Float32Array of steps * 3', () => {
            const lut = bakeGradient([red, blue], 16);
            expect(lut).toBeInstanceOf(Float32Array);
            expect(lut.length).toBe(48);
        });

        it('pins the endpoints to the first and last stop', () => {
            const lut = bakeGradient([red, blue], 32);
            expect(lut[0]).toBeCloseTo(red.l, 5);
            expect(lut[1]).toBeCloseTo(red.c, 5);
            expect(lut[93]).toBeCloseTo(blue.l, 5);
            expect(lut[94]).toBeCloseTo(blue.c, 5);
        });

        it('matches multiStopGradient at every step', () => {
            const colors = [red, green, blue];
            const steps = 17;
            const lut = bakeGradient(colors, steps);
            for (let i = 0; i < steps; i++) {
                const expected = multiStopGradient(colors, i / (steps - 1));
                expect(lut[i * 3]).toBeCloseTo(expected.l, 5);
                expect(lut[i * 3 + 1]).toBeCloseTo(expected.c, 5);
                expect(lut[i * 3 + 2]).toBeCloseTo(expected.h, 4);
            }
        });

        it('applies the optional ease, matching createGradient', () => {
            const ease = (x) => x * x;
            const colors = [red, blue];
            const lut = bakeGradient(colors, 8, undefined, ease);
            const sampler = createGradient(colors, ease);
            for (let i = 0; i < 8; i++) {
                expect(lut[i * 3]).toBeCloseTo(sampler(i / 7).l, 5);
            }
        });

        it('writes into a caller-owned out (zero-GC re-bake)', () => {
            const out = new Float32Array(48);
            const result = bakeGradient([red, blue], 16, out);
            expect(result).toBe(out);
            expect(out[0]).toBeCloseTo(red.l, 5);
        });

        it('accepts an oversized out buffer', () => {
            const out = new Float32Array(96);
            expect(() => bakeGradient([red, blue], 16, out)).not.toThrow();
        });

        it('throws when out is too small', () => {
            expect(() => bakeGradient([red, blue], 16, new Float32Array(47)))
                .toThrow(/length >= 48/);
        });

        it('handles a single color', () => {
            const lut = bakeGradient([red], 4);
            expect(lut.length).toBe(12);
            for (let i = 0; i < 4; i++) expect(lut[i * 3]).toBeCloseTo(red.l, 5);
        });

        it('handles steps = 1 (t = 0)', () => {
            const lut = bakeGradient([red, blue], 1);
            expect(lut.length).toBe(3);
            expect(lut[0]).toBeCloseTo(red.l, 5);
        });

        it('truncates fractional steps instead of corrupting the LUT', () => {
            const lut = bakeGradient([red, blue], 8.9);
            expect(lut.length).toBe(24);
        });

        it('throws on invalid steps', () => {
            expect(() => bakeGradient([red, blue], 0)).toThrow(/steps/);
            expect(() => bakeGradient([red, blue], -4)).toThrow(/steps/);
            expect(() => bakeGradient([red, blue], NaN)).toThrow(/steps/);
            expect(() => bakeGradient([red, blue], Infinity)).toThrow(/steps/);
            expect(() => bakeGradient([red, blue], '16')).toThrow(/steps/);
        });

        it('throws on an empty color array', () => {
            expect(() => bakeGradient([], 8)).toThrow(/at least 1 color/);
        });

        it('is allocation-free when reusing out', () => {
            const out = new Float32Array(300);
            const before = out.buffer;
            for (let i = 0; i < 50; i++) bakeGradient([red, green, blue], 100, out);
            expect(out.buffer).toBe(before);
        });
    });

    describe('bakeCssGradient()', () => {
        it('returns `steps` CSS strings', () => {
            const css = bakeCssGradient([red, blue], 5);
            expect(css).toHaveLength(5);
            css.forEach((s) => expect(s).toMatch(/^oklch\(/));
        });

        it('matches toCssOklch(multiStopGradient(...)) at every step', () => {
            const colors = [red, green, blue];
            const steps = 9;
            const css = bakeCssGradient(colors, steps);
            for (let i = 0; i < steps; i++) {
                const expected = toCssOklch(multiStopGradient(colors, i / (steps - 1)));
                expect(css[i]).toBe(expected);
            }
        });

        it('applies the optional ease', () => {
            const ease = (x) => x * x;
            const css = bakeCssGradient([red, blue], 4, ease);
            expect(css[1]).toBe(toCssOklch(multiStopGradient([red, blue], 1 / 3, ease)));
        });

        it('handles a single color', () => {
            const css = bakeCssGradient([red], 3);
            expect(new Set(css).size).toBe(1);
        });

        it('throws on invalid steps and empty colors', () => {
            expect(() => bakeCssGradient([red], 0)).toThrow(/steps/);
            expect(() => bakeCssGradient([], 4)).toThrow(/at least 1 color/);
        });
    });
});

