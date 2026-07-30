# 0002 — Alpha end-to-end, full oklch() grammar, and the stride-4 break

- Status: accepted
- Date: 2026-07-30
- Version: 2.0.0 (breaking)
- Brief: C2 (ROADMAP.md)

## Context

`parseOklch` accepted only `[\d.]+` triples — no percentages, `none`, angle
units, or percentage alpha — and `lerpOklch` / `lerpOklchTo` silently dropped
alpha (they touched only `l`, `c`, `h`). The C2 brief's pivotal question: does
threading alpha grow `bakeGradient`'s packed `Float32Array` from 3 floats per
stop to 4? If yes, that is a breaking layout change and the release is v2.0.0.

## Decisions

### 1. Ship v2.0.0; bakeGradient LUT stride 3 -> 4 (`l, c, h, a`)

Chosen over keeping stride 3 (alpha only in the object/`toRgb*` paths).

Reasons, in order of weight:
- **Zero blast radius.** A grep of the whole suite found **no external consumer**
  of the stride-3 Float32 LUT — only lite-color's own docs and tests. The break
  costs nobody today and only gets more expensive to make later.
- **Consistency / safety.** Carrying alpha through `multiStopGradient`,
  `lerpOklch*` and the `toRgb*` bridges but dropping it in `bakeGradient` would
  be a silent wrong answer in a visual library — the exact failure the family
  forbids.
- **Alignment.** 4 floats/stop aligns each stop to 16 bytes, a minor typed-array
  nicety.

**Explicitly NOT a reason: WebGL uploadability.** The LUT holds OKLCH
(`l, c, h, a`), not RGBA. It is *not* GPU-uploadable as a color regardless of
stride — a shader needs the OKLCH->linear-sRGB matrix in `oklchToRgbInPlace`
first. The 4th float is alpha in OKLCH space, not an RGBA pixel's `a`. Documented
so nobody uploads the LUT as a `vec4` color and ships wrong colors.

Cost accepted: **+33% LUT memory for opaque-only users** (the common game case).
Acceptable — it is setup-time memory, not per-frame, and alignment repays some.

`BAKE_STRIDE = 4` is exported so callers index by the constant, not a literal.

### 2. Missing alpha -> 1.0; interpolate linearly, clamped [0,1]

Per CSS Color 4, an omitted alpha is opaque. `lerpOklch*` default a missing `a`
on either input to 1 before interpolating, so mixing `{l,c,h,a:0.5}` with
`{l,c,h}` treats the latter as `a:1`. This is the only backward-compatible
choice for the many callers who omit alpha today. Alpha interpolates **linearly**
(`lerp`, not the hue path) and is **clamped to [0,1]**.

Recorded tradeoff: this adds ~2 ops (`lerp` + `clamp` + one property write) to
`lerpOklch`'s hot body. The brief's "ops/s unchanged" gate therefore cannot
hold literally once alpha is threaded through the hot path — this is an
intentional feature cost for a major, not a regression.

### 3. `none` channels -> 0 (deliberate simplification)

The parser accepts `none` on any channel and maps it to 0. The full CSS
"powerless component" carry-forward during interpolation is **out of scope** for
a game/render library. Note the interaction with decision 2: an *omitted* alpha
is 1, but an *explicit* `/ none` alpha is 0. Both are honored and distinct.

### 4. Malformed input throws

`parseOklch` throws rather than returning null. The reason is timing, not
null-check cost: a throw surfaces a typo when the color is defined (config
time); a null silently renders a wrong or invisible gradient every frame with no
stack trace. Consistent with the family's fail-closed law.

### 5. Chroma percentage reference is 0.4, not 1.0

In `oklch()`, `C` at `100%` is **0.4** (`0%` -> 0). Mapping C% as 0-1 like L
would make every percentage-chroma color 2.5x oversaturated — a silent
spec violation. So: L% and A% -> 0-1, but **C% -> 0-0.4**. Hue angle units:
`deg`/unitless -> degrees, `rad` -> `*180/PI`, `grad` -> `*0.9`, `turn` -> `*360`.

## Consequences

- `bakeGradient` output layout changed (breaking); `BAKE_STRIDE` added.
- `lerpOklch`, `lerpOklchTo`, `multiStopGradientTo`, `bakeGradient`,
  `bakeCssGradient` now carry alpha. `toCssOklch`/`toRgb*` already did.
- `parseOklch` returns `a` always defined (`Required<OklchColor>`).
- Migration guide in the CHANGELOG; README and llms.txt updated.

## Non-goals

No gamut work (C3). No `bakeRgbaGradient` (a future, separate, GPU-uploadable
LUT). No CSS "powerless component" interpolation semantics.
