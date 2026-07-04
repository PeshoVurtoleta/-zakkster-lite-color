export interface OklchColor {
    l: number;
    c: number;
    h: number;
    a?: number;
}

/** Linearly interpolates between two OKLCH colors with safe clamping. */
export declare const lerpOklch: (a: OklchColor, b: OklchColor, t: number) => OklchColor;
/** Linearly interpolates between two OKLCH colors with safe clamping, Zero-GC. */
export declare const lerpOklchTo: (a: OklchColor, b: OklchColor, t: number, out: OklchColor) => OklchColor;
/** Formats an OKLCH object to a CSS string. */
export declare const toCssOklch: (color: OklchColor) => string;
/** Parse an OKLCH CSS string back to an object. */
export declare const parseOklch: (str: string) => OklchColor;
/** Multi-stop gradient evaluation with optional easing. */
export declare const multiStopGradient: (colors: OklchColor[], t: number, ease?: (t: number) => number) => OklchColor;
/** Multi-stop gradient evaluation with optional easing, Zero-GC */
export declare const multiStopGradientTo: (colors: OklchColor[], t: number, out: OklchColor, ease?: (t: number) => number) => OklchColor;
/** Creates a reusable gradient sampler function. */
export declare const createGradient: (colors: OklchColor[], ease?: (t: number) => number) => (t: number) => OklchColor;
/** Reverses a color array without mutation. */
export declare const reverseGradient: (colors: OklchColor[]) => OklchColor[];
/** Picks a random color from a gradient using an RNG with .next(). */
export declare const randomFromGradient: (colors: OklchColor[], rng: { next(): number }) => OklchColor;
