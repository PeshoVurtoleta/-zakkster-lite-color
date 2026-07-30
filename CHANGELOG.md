# Changelog

All notable changes to `@zakkster/lite-color` are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [1.1.1] - 2026-07-30

### Fixed
- **Install-order failure under pnpm / Yarn Classic.** `Color.js` did a
  top-level `import { lerp, lerpAngle, clamp } from '@zakkster/lite-lerp'` that
  was declared only in `peerDependencies`. Package managers that do not
  auto-install peers left the import unresolved, so `import '@zakkster/lite-color'`
  threw `ERR_MODULE_NOT_FOUND` before any function ran — while the README
  advertised "Zero dependencies".

### Changed
- The three interpolation primitives (`lerp`, `lerpAngle`, `clamp`, plus the
  `wrap` helper `lerpAngle` uses) are now vendored **byte-identical** from
  `@zakkster/lite-lerp` as module-local functions. lite-lerp remains the source
  of truth; the exported hot-path bodies are textually unchanged, so `lerpOklch`
  throughput is unchanged.
- Removed `peerDependencies`. The package now has **zero runtime dependencies**,
  making the comparison-table claim true.
- README and `llms.txt` updated: `@zakkster/lite-lerp` is now documented as an
  optional companion for the easing helpers, not a requirement.

### Notes
- No public API change. `Color.d.ts` is unchanged.
- Rationale recorded in `decisions/0001-inline-lerp-primitives.md`.

## [1.1.0] - 2026-07-15

### Added
- `bakeGradient(colors, steps, out?, ease?)` — bake a multi-stop gradient into a
  packed `Float32Array` LUT of pre-evaluated OKLCH stops (3 floats per stop).
  Pass a reusable `out` to re-bake with zero allocations.
- `bakeCssGradient(colors, steps, ease?)` — bake a gradient into an array of
  pre-formatted CSS `oklch()` strings; format the palette once at setup.
- `toRgbTo(color, out, offset?)` — zero-GC OKLCH -> normalized sRGB RGBA (0-1)
  written into a caller-owned buffer. Bridge to WebGL / lite-gl RGBA fields.
- `toRgbBytesTo(color, out, offset?)` — zero-GC OKLCH -> sRGB bytes (0-255)
  written into a caller-owned buffer. Bridge to canvas `ImageData`.

## [1.0.0] - 2026-07-05

### Added
- Initial release: OKLCH color interpolation for games and gradients.
- `lerpOklch` / `lerpOklchTo` (zero-GC), `toCssOklch`, `parseOklch`.
- `multiStopGradient` / `multiStopGradientTo`, `createGradient`,
  `reverseGradient`, `randomFromGradient`.

[1.1.1]: https://github.com/PeshoVurtoleta/lite-color/releases/tag/v1.1.1
[1.1.0]: https://github.com/PeshoVurtoleta/lite-color/releases/tag/v1.1.0
[1.0.0]: https://github.com/PeshoVurtoleta/lite-color/releases/tag/v1.0.0
