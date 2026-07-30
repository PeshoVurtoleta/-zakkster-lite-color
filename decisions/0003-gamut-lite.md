# 0003 -- sRGB gamut lite: isInSrgb + clampToSrgb

- Status: accepted
- Date: 2026-07-30
- Version: 2.1.0 (additive)
- Brief: C3 (ROADMAP.md, originally numbered v1.3.0)

## Context

The C3 brief asks for "enough gamut to stop game colours clipping": an
`isInSrgb` predicate and a `clampToSrgb` that pulls a color back into gamut by
binary search on chroma, preserving L and h, with a bounded (not
while-on-a-float) iteration count and a documented boundary against
lite-hueforge.

The brief numbered this v1.3.0. That number is dead: C2 forked to **2.0.0** when
alpha grew the bake LUT stride, so anything after it is >= 2.1.0. Shipped as
**2.1.0** (additive, no API or layout break).

## Decisions

### 1. Version 2.1.0, not 1.3.0

Purely additive -- two new exports, no signature or LUT change -- so a minor
bump. The roadmap's `C3 -> 1.3.0` assumed C2 stayed a minor (1.2.0); once C2
became 2.0.0, the whole downstream lite-color line shifts up a major. ROADMAP.md
updated to reflect shipped reality.

### 2. Gamut test is linear-light membership, not encoded RGB

A color is displayable in sRGB iff its three **linear-light** R/G/B components
lie in `[0,1]`. The sRGB transfer function is monotonic and maps `[0,1]`
bijectively onto `[0,1]`, so testing the linear values is exact and skips the
transfer entirely. The existing `oklchToRgbInPlace` already computed those
linear values before clamping; that matrix was factored into a shared internal
`oklchToLinear(l, c, h, out3)` that now feeds both the `toRgb*` bridges and the
gamut checks. `toRgbTo` / `toRgbBytesTo` output is byte-for-byte unchanged
(covered by their existing tests).

### 3. Boundary is inclusive; tolerance is a linear-space epsilon

Tie-break, pinned: a color sitting **exactly on** the gamut boundary counts as
**in** gamut. `GAMUT_EPS = 1e-7` in linear-light space absorbs float noise from
the OKLab matrix so an edge color does not flicker out on the last ulp. Chosen
in linear (not encoded) space because that is where the test runs; near black
the sRGB transfer's 12.92 slope makes this ~1.3e-6 in encoded terms, negligible
for a "lite" classifier.

### 4. clampToSrgb reduces chroma only -- and clamps L into [0,1] first

Hue and lightness are preserved; only chroma moves, via binary search. But an
out-of-range **lightness** cannot be rescued by any chroma (a gray of `l > 1` is
already out of gamut at `c = 0`), and returning a still-clipping color would
break the function's own contract that its output is displayable. So L is
clamped into `[0,1]` **before** the chroma search. For any well-formed color
this is a no-op -- `lerpOklch` already clamps L, so every color the library
produces satisfies it. This is the fail-closed reading of "preserve L": L is
preserved across its entire valid domain, and the only inputs it moves are
already-broken ones. Recorded here because it is a deliberate divergence from a
literal "only C ever moves" phrasing of the brief.

The search's lower bound is sound: at `c = 0` the color is a neutral gray of
lightness `l`, which is in gamut for every `l` in `[0,1]` -- so `[0, color.c]`
always brackets the boundary. Monotonicity of gamut membership in chroma (in for
`[0, boundary]`, out beyond) is the standard assumption shared with CSS gamut
mapping and lite-hueforge's `toHex`.

### 5. Fixed 18-iteration bisection

`CLAMP_ITERS = 18`, a compile-time constant, no data-dependent loop. Chroma
spans ~`0-0.4`, so 18 halvings resolve the boundary to `0.4 / 2^18 ~= 1.5e-6` --
far below any visible step. Deliberately tighter than lite-hueforge's 10-iter
sRGB reduction in `toHex` (~`4e-4`): lite-color spends a few more **setup-time**
iterations to land essentially on the boundary, consistent with its
predictable-cost pitch. Still bounded and asserted (a test steps `1e-4` past the
found chroma and requires it to fall out of gamut, proving convergence to the
edge rather than an early stop).

### 6. sRGB only; no dependency on lite-hueforge

lite-color owns the `<1KB`, zero-dep, sRGB-only hot-path pair. Tiered
classification (`gamutOf` -> `srgb`/`p3`/`out`), palette-wide `auditGamut`, and
Display-P3 + dithering live in `@zakkster/lite-hueforge` (v1.4.0+). The two
**share the algorithm shape** (hue-preserving chroma bisection) but not code:
depending on hueforge would invert the arrow (a heavy palette lib pulled into a
micro-core) and break the zero-dependency law. The boundary is documented in
both READMEs so the split is explicit rather than folklore.

## Consequences

- New exports `isInSrgb` and `clampToSrgb`; `Color.d.ts` updated.
- Internal `oklchToLinear` + a module-level `_lin` scratch triple; `toRgb*`
  refactored onto it with identical output.
- Zero allocation on `isInSrgb` and on `clampToSrgb(color, out)` -- verified with
  an `--expose-gc` heap-delta probe over 3M calls (negative delta = noise).
- README + llms.txt gain a gamut section and the hueforge boundary paragraph.

## Non-goals

Not the hueforge classifier (no P3, no `out` tier, no palette aggregate). No CSS
gamut-mapping spec compliance (no OKLCH clip-to-CSS-Color-4 MINDE algorithm).
The hueforge-side one-line cross-link to this boundary is a separate
one-package-at-a-time change, not made from this session.
