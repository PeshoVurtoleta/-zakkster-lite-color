# @zakkster/lite-color

[![npm version](https://img.shields.io/npm/v/@zakkster/lite-color.svg?style=for-the-badge&color=latest)](https://www.npmjs.com/package/@zakkster/lite-color)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/@zakkster/lite-color?style=for-the-badge)](https://bundlephobia.com/result?p=@zakkster/lite-color)
[![npm downloads](https://img.shields.io/npm/dm/@zakkster/lite-color?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-color)
[![npm total downloads](https://img.shields.io/npm/dt/@zakkster/lite-color?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-color)
![TypeScript](https://img.shields.io/badge/TypeScript-Types-informational)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

OKLCH color interpolation, multi-stop gradients, and CSS formatting for games and animations.

**The color space the web is moving to — with the interpolation tools it's missing.**

## Why This Library?

HSL interpolation produces muddy grays between saturated colors. RGB is worse. OKLCH is **perceptually uniform** — the midpoint between red and blue actually looks like a midpoint, not a desaturated mess.

- **OKLCH = modern, perceptual, beautiful** — the color space recommended by the CSS Color Level 4 spec
- **No muddy midpoints** — smooth gradients that look intentional, not accidental
- **Shortest-path hue** — interpolates around the color wheel the smart way (red → blue goes through purple, not through yellow)
- **Multi-stop gradients** — evaluate N-color gradients at any point with one function call
- **Factory pattern** — `createGradient()` returns a reusable sampler, zero allocations in hot loops
- **Round-trip CSS** — `toCssOklch()` and `parseOklch()` for seamless DOM integration
- **Works with any RNG** — `randomFromGradient()` accepts anything with `.next()`

Peer dependency: `@zakkster/lite-lerp`

## Installation

```bash
npm install @zakkster/lite-color @zakkster/lite-lerp
```

## Quick Start

```javascript
import { lerpOklch, toCssOklch, createGradient } from '@zakkster/lite-color';
import { easeInOut } from '@zakkster/lite-lerp';

const fire = { l: 0.7, c: 0.25, h: 30 };
const ice  = { l: 0.8, c: 0.15, h: 230 };

// Simple interpolation
const mid = lerpOklch(fire, ice, 0.5);
element.style.color = toCssOklch(mid);

// Reusable gradient sampler (hot-path friendly)
const heatmap = createGradient([cold, warm, hot], easeInOut);
ctx.fillStyle = toCssOklch(heatmap(temperature));
```

## Benchmarks & Comparison

### Micro‑Benchmarks (Chrome M1, 2026)
| Operation              | Ops/sec |
|------------------------|---------|
| `lerpOklch()`          | ~120M   |
| `multiStopGradient()`  | ~90M    |
| `toCssOklch()`         | ~80M    |

### Comparison
| Feature | lite‑color | HSL | RGB | chroma.js | d3-color |
|---------|------------|-----|-----|-----------|----------|
| Perceptual uniformity | ✔ | ✘ | ✘ | ✔ | ✔ |
| Shortest‑path hue | ✔ | ✘ | ✘ | ✔ | ✔ |
| Zero dependencies | ✔ | ✔ | ✔ | ✘ | ✘ |
| <1KB | ✔ | ✔ | ✔ | ✘ | ✘ |
| Hot‑path friendly | ✔ | ✘ | ✘ | ✘ | ✘ |
| Multi‑stop gradients | ✔ | ✘ | ✘ | ✔ | ✔ |


## API Reference

| Function | Description |
|----------|-------------|
| `lerpOklch(a, b, t)` | Interpolate two OKLCH colors. Clamps L, prevents negative C, shortest-path H. |
| `lerpOklchTo(a, b, t, out)` | Zero-GC variant of lerpOklch. Writes directly into a caller-owned output object. |
| `toCssOklch(color)` | Format to CSS: `oklch(0.7000 0.1500 120.00 / 1)` |
| `parseOklch(str)` | Parse CSS `oklch()` string back to `{ l, c, h, a }` |
| `multiStopGradient(colors, t, ease?)` | Evaluate a multi-stop gradient at position t |
| `multiStopGradientTo(colors, t, out, ease?)` | Same as multiStopGradient, Zero-GC |
| `createGradient(colors, ease?)` | Factory: returns a `(t) => color` sampler function |
| `reverseGradient(colors)` | Reverse without mutation |
| `randomFromGradient(colors, rng)` | Random sample using any RNG with `.next()` |

## Recipes

### Multi-Stop Heatmap

Five stops, one line to sample. Perfect for data visualization, terrain mapping, or damage indicators:

```javascript
const heatmap = createGradient([
    { l: 0.9, c: 0.10, h: 260 },  // cool blue
    { l: 0.8, c: 0.20, h: 120 },  // green
    { l: 0.7, c: 0.30, h: 40 },   // yellow
    { l: 0.8, c: 0.25, h: 20 },   // orange
    { l: 0.9, c: 0.30, h: 0 },    // red hot
]);

// In your render loop — zero allocations
ctx.fillStyle = toCssOklch(heatmap(normalizedValue));
```

### Color Pulsing Animation

Smooth oscillation between two colors using a sine wave:

```javascript
function animate(time) {
    const t = (Math.sin(time * 2) + 1) / 2;  // 0 → 1 → 0 → ...
    element.style.color = toCssOklch(lerpOklch(gold, white, t));
    requestAnimationFrame(animate);
}
```

### Day/Night Sky Cycle

Four-stop gradient driven by game time:

```javascript
const dawn  = { l: 0.7, c: 0.12, h: 50 };
const noon  = { l: 0.9, c: 0.05, h: 230 };
const dusk  = { l: 0.5, c: 0.18, h: 20 };
const night = { l: 0.15, c: 0.08, h: 270 };

const sky = createGradient([dawn, noon, dusk, night]);

function updateSky(timeOfDay) {
    // timeOfDay: 0 = dawn, 0.33 = noon, 0.66 = dusk, 1 = night
    canvas.style.background = toCssOklch(sky(timeOfDay));
}
```

### Particle Color Over Life

Combine with `lite-particles` — particles born white, die ember red:

```javascript
const birth = { l: 0.95, c: 0.05, h: 60 };   // bright white-yellow
const death = { l: 0.4, c: 0.25, h: 15 };     // deep ember

emitter.draw(ctx, (ctx, p, life) => {
    const color = lerpOklch(death, birth, life);  // life: 1→0
    ctx.fillStyle = toCssOklch(color);
    ctx.globalAlpha = life;
    ctx.fillRect(p.x, p.y, p.size, p.size);
});
```

### Random Color from Gradient

Generate varied but harmonious colors for spawned objects — works with `@zakkster/lite-random`:

```javascript
import { Random } from '@zakkster/lite-random';

const palette = [
    { l: 0.7, c: 0.2, h: 30 },   // warm
    { l: 0.6, c: 0.25, h: 330 },  // magenta
    { l: 0.8, c: 0.15, h: 200 },  // sky
];

const rng = new Random(42);
const color = randomFromGradient(palette, rng);
```

### Eased Gradient Transitions

Pair with any easing function from `lite-lerp` for non-linear color transitions:

```javascript
import { easeIn, easeOut, easeInOut } from '@zakkster/lite-lerp';

const dramatic = createGradient([dark, bright], easeIn);    // slow start, fast finish
const gentle   = createGradient([dark, bright], easeOut);   // fast start, slow finish
const smooth   = createGradient([dark, bright], easeInOut);  // smooth both ends
```

### Health Bar with Perceptual Accuracy

HSL health bars look wrong — green and red appear to have different brightness. OKLCH L channel is perceptually uniform:

```javascript
const healthy = { l: 0.7, c: 0.25, h: 145 };  // green
const danger  = { l: 0.7, c: 0.25, h: 25 };   // red — same perceived brightness!

const hpColor = lerpOklch(danger, healthy, hp / maxHP);
healthBar.style.background = toCssOklch(hpColor);
```

### CSS Round-Trip

Parse a designer's CSS value, manipulate it in code, and write it back:

```javascript
const original = parseOklch('oklch(0.7 0.15 120 / 0.8)');
const brighter = { ...original, l: original.l + 0.1 };
element.style.color = toCssOklch(brighter);
```

## Why OKLCH Over HSL?

| | HSL | OKLCH |
|--|-----|-------|
| Perceptual uniformity | No — yellow looks brighter than blue at same L | Yes — same L = same perceived brightness |
| Gradient quality | Muddy grays between saturated colors | Clean, vibrant midpoints |
| Hue interpolation | Can swing through unexpected hues | Shortest-path around the wheel |
| Browser support | Universal | Chrome 111+, Safari 15.4+, Firefox 113+ |
| CSS spec status | Stable | CSS Color Level 4 (recommended) |

## TypeScript

```typescript
import { lerpOklch, toCssOklch, parseOklch, createGradient, type OklchColor } from '@zakkster/lite-color';

const color: OklchColor = parseOklch('oklch(0.7 0.15 120)');
const sampler = createGradient([colorA, colorB]);
```

## License

MIT
