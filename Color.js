/**
 * @zakkster/lite-color — OKLCH color interpolation for games and gradients
 *
 * v1.1.0 adds LUT baking (bakeGradient / bakeCssGradient) and zero-GC RGB bridges
 * (toRgbTo / toRgbBytesTo) for WebGL buffers and canvas ImageData.
 *
 * Depends on @zakkster/lite-lerp for interpolation primitives.
 */

import { lerp, lerpAngle, clamp } from '@zakkster/lite-lerp';

/**
 * Linearly interpolates between two OKLCH colors.
 * Safely clamps Lightness (0–1) and prevents negative Chroma.
 * NOTE: Allocates a new object. For hot-path use, prefer lerpOklchTo().
 *
 * @param {{ l: number, c: number, h: number }} a - Start color
 * @param {{ l: number, c: number, h: number }} b - End color
 * @param {number} t - Interpolation factor (0–1)
 * @returns {{ l: number, c: number, h: number }} New object
 */
export const lerpOklch = (a, b, t) => ({
    l: clamp(lerp(a.l, b.l, t), 0, 1),
    c: Math.max(0, lerp(a.c, b.c, t)),
    h: lerpAngle(a.h, b.h, t),
});

/**
 * Zero-GC variant of lerpOklch. Writes directly into a caller-owned output object.
 * Use this in render loops, LUT generation, or any per-frame hot path.
 *
 * @param {{ l: number, c: number, h: number }} a - Start color
 * @param {{ l: number, c: number, h: number }} b - End color
 * @param {number} t - Interpolation factor (0–1)
 * @param {{ l: number, c: number, h: number }} out - Pre-allocated output
 * @returns {{ l: number, c: number, h: number }} Same `out` reference
 */
export const lerpOklchTo = (a, b, t, out) => {
    out.l = clamp(lerp(a.l, b.l, t), 0, 1);
    out.c = Math.max(0, lerp(a.c, b.c, t));
    out.h = lerpAngle(a.h, b.h, t);
    return out;
};

/**
 * Formats an OKLCH object into a browser-safe CSS string.
 * Uses fixed precision to prevent scientific notation bugs.
 *
 * @param {{ l: number, c: number, h: number, a?: number }} color
 */
export const toCssOklch = ({ l, c, h, a = 1 }) =>
    `oklch(${l.toFixed(4)} ${c.toFixed(4)} ${h.toFixed(2)} / ${a})`;

/**
 * Parse an OKLCH CSS string back to an object.
 * Handles: oklch(0.7 0.15 120), oklch(0.7 0.15 120 / 0.5)
 *
 * @param {string} str - CSS oklch() string
 * @returns {{ l: number, c: number, h: number, a: number }}
 */
export const parseOklch = (str) => {
    const match = str.match(
        /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)/
    );
    if (!match) throw new Error(`lite-color: cannot parse "${str}"`);
    return {
        l: parseFloat(match[1]),
        c: parseFloat(match[2]),
        h: parseFloat(match[3]),
        a: match[4] !== undefined ? parseFloat(match[4]) : 1,
    };
};

/**
 * Multi-stop gradient evaluation with optional easing.
 *
 * @param {Array} colors - Array of OKLCH color objects
 * @param {number} t - Progress (0–1)
 * @param {Function} [ease] - Optional easing function
 */
export const multiStopGradient = (colors, t, ease = (x) => x) => {
    if (!Array.isArray(colors) || colors.length === 0) {
        throw new Error("lite-color: colors array must contain at least 1 color");
    }
    if (colors.length === 1) return colors[0];

    const clampedT = clamp(ease(t), 0, 1);
    const scaledT = clampedT * (colors.length - 1);
    const index = Math.floor(scaledT);

    if (index >= colors.length - 1) return colors[colors.length - 1];

    const localT = scaledT - index;
    return lerpOklch(colors[index], colors[index + 1], localT);
};

/**
 * Zero-GC variant of multiStopGradient.
 * Writes directly into a caller-owned output object.
 *
 * @param {Array} colors - Array of OKLCH color objects
 * @param {number} t - Progress (0–1)
 * @param {{ l: number, c: number, h: number }} out - Pre-allocated output
 * @param {Function} [ease] - Optional easing function
 */
export const multiStopGradientTo = (colors, t, out, ease = (x) => x) => {
    if (!Array.isArray(colors) || colors.length === 0) {
        throw new Error("lite-color: colors array must contain at least 1 color");
    }
    if (colors.length === 1) {
        out.l = colors[0].l; out.c = colors[0].c; out.h = colors[0].h;
        return out;
    }

    const clampedT = clamp(ease(t), 0, 1);
    const scaledT = clampedT * (colors.length - 1);
    const index = Math.floor(scaledT);

    if (index >= colors.length - 1) {
        const last = colors[colors.length - 1];
        out.l = last.l; out.c = last.c; out.h = last.h;
        return out;
    }

    const localT = scaledT - index;
    return lerpOklchTo(colors[index], colors[index + 1], localT, out);
};

/**
 * Creates a reusable gradient sampler function.
 *
 * @example
 * const heatmap = createGradient([cold, warm, hot], easeInOut);
 * const color = heatmap(0.5);
 */
export const createGradient = (colors, ease = (x) => x) => {
    if (!Array.isArray(colors) || colors.length === 0) {
        throw new Error("lite-color: colors array must contain at least 1 color");
    }
    return (t) => multiStopGradient(colors, t, ease);
};

/** Reverses a color array without mutating the original. */
export const reverseGradient = (colors) => [...colors].reverse();

/**
 * Picks a random color from anywhere along the gradient.
 * @param {Array} colors - The gradient array
 * @param {{ next: function(): number }} rng - An RNG with .next() returning [0, 1)
 */
export const randomFromGradient = (colors, rng) => {
    return multiStopGradient(colors, rng.next());
};

// === v1.1.0 — LUT baking + RGB byte bridges ===

const DEG2RAD = Math.PI / 180;

/** sRGB electro-optical transfer. Negative inputs take the linear branch (no NaN). */
const srgbTransfer = (x) =>
    x <= 0.0031308 ? 12.92 * x : 1.055 * (x ** (1 / 2.4)) - 0.055;

/**
 * Internal: OKLCH → sRGB, written in place as RGBA at `out[offset]`.
 * Out-of-gamut colors are clipped (the safe, expected behavior for canvas/WebGL).
 */
const oklchToRgbInPlace = (l, c, h, a, out, offset, toBytes) => {
    const hr = h * DEG2RAD;
    const a_ = c * Math.cos(hr);
    const b_ = c * Math.sin(hr);

    let l_ = l + 0.3963377774 * a_ + 0.2158037573 * b_;
    let m_ = l - 0.1055613458 * a_ - 0.0638541728 * b_;
    let s_ = l - 0.0894841775 * a_ - 1.2914855480 * b_;

    l_ = l_ * l_ * l_;
    m_ = m_ * m_ * m_;
    s_ = s_ * s_ * s_;

    const r = srgbTransfer(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_);
    const g = srgbTransfer(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_);
    const b = srgbTransfer(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_);

    if (toBytes) {
        out[offset]     = Math.round(clamp(r, 0, 1) * 255);
        out[offset + 1] = Math.round(clamp(g, 0, 1) * 255);
        out[offset + 2] = Math.round(clamp(b, 0, 1) * 255);
        out[offset + 3] = Math.round(clamp(a, 0, 1) * 255);
    } else {
        out[offset]     = clamp(r, 0, 1);
        out[offset + 1] = clamp(g, 0, 1);
        out[offset + 2] = clamp(b, 0, 1);
        out[offset + 3] = clamp(a, 0, 1);
    }
    return out;
};

/**
 * Zero-GC OKLCH → normalized sRGB RGBA (0–1). Writes into a caller-owned `out` at `offset`.
 * The bridge to lite-gl RGBA instance fields, WebGL attribute buffers, and Float32Array.
 *
 * @param {{ l: number, c: number, h: number, a?: number }} color
 * @param {Float32Array|number[]} out - Caller-owned buffer, >= offset + 4 slots
 * @param {number} [offset=0]
 * @returns {Float32Array|number[]} Same `out` reference
 */
export const toRgbTo = (color, out, offset = 0) =>
    oklchToRgbInPlace(color.l, color.c, color.h, color.a ?? 1, out, offset, false);

/**
 * Zero-GC OKLCH → sRGB bytes (0–255). Writes into a caller-owned `out` at `offset`.
 * The bridge to canvas ImageData (Uint8ClampedArray) and Uint8Array texture uploads.
 *
 * @param {{ l: number, c: number, h: number, a?: number }} color
 * @param {Uint8Array|Uint8ClampedArray|number[]} out - Caller-owned buffer, >= offset + 4 slots
 * @param {number} [offset=0]
 * @returns {Uint8Array|Uint8ClampedArray|number[]} Same `out` reference
 */
export const toRgbBytesTo = (color, out, offset = 0) =>
    oklchToRgbInPlace(color.l, color.c, color.h, color.a ?? 1, out, offset, true);

/** Internal: validate a bake request and return an integer step count. */
const bakeSteps = (colors, steps) => {
    if (!Array.isArray(colors) || colors.length === 0) {
        throw new Error("lite-color: colors array must contain at least 1 color");
    }
    if (typeof steps !== "number" || !Number.isFinite(steps) || steps < 1) {
        throw new Error(`lite-color: steps must be a finite number >= 1, got ${steps}`);
    }
    return steps | 0;
};

/**
 * Bake a multi-stop gradient into a packed Float32Array LUT of pre-evaluated OKLCH stops.
 * Each stop is 3 consecutive floats: [l0, c0, h0, l1, c1, h1, ...].
 *
 * Setup-time by design. Sample it per frame with an index — no lerp, no allocations.
 * Pass a reusable `out` (length >= steps * 3) to re-bake with zero allocations.
 *
 * @param {Array} colors - Array of OKLCH color objects
 * @param {number} steps - LUT resolution (truncated to an integer)
 * @param {Float32Array} [out] - Optional caller-owned buffer
 * @param {Function} [ease] - Optional easing function, applied as in multiStopGradient
 * @returns {Float32Array} `out` if provided, else a new Float32Array(steps * 3)
 */
export const bakeGradient = (colors, steps, out, ease = (x) => x) => {
    const n = bakeSteps(colors, steps);
    const len = n * 3;

    if (out === undefined || out === null) {
        out = new Float32Array(len);
    } else if (out.length < len) {
        throw new Error(`lite-color: out must have length >= ${len}, got ${out.length}`);
    }

    const temp = { l: 0, c: 0, h: 0 };
    const denom = n > 1 ? n - 1 : 1;
    for (let i = 0; i < n; i++) {
        multiStopGradientTo(colors, i / denom, temp, ease);
        const idx = i * 3;
        out[idx] = temp.l;
        out[idx + 1] = temp.c;
        out[idx + 2] = temp.h;
    }
    return out;
};

/**
 * Bake a multi-stop gradient into an array of pre-formatted CSS oklch() strings.
 * Promotes the lite-confetti v1.1.0 lesson to a first-class API: format the palette
 * once at setup, then index it per frame. Never call toCssOklch() in a render loop.
 *
 * @param {Array} colors - Array of OKLCH color objects
 * @param {number} steps - LUT resolution (truncated to an integer)
 * @param {Function} [ease] - Optional easing function, applied as in multiStopGradient
 * @returns {string[]} Array of `steps` CSS oklch() strings
 */
export const bakeCssGradient = (colors, steps, ease = (x) => x) => {
    const n = bakeSteps(colors, steps);
    const result = new Array(n);

    const temp = { l: 0, c: 0, h: 0 };
    const denom = n > 1 ? n - 1 : 1;
    for (let i = 0; i < n; i++) {
        multiStopGradientTo(colors, i / denom, temp, ease);
        result[i] = toCssOklch(temp);
    }
    return result;
};
