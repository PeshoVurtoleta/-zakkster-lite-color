# 0001 — Inline the lite-lerp primitives, drop the peer dependency

- Status: accepted
- Date: 2026-07-30
- Version: 1.1.1
- Supersedes: the `peerDependencies` on `@zakkster/lite-lerp`

## Context

`Color.js` opened with a top-level hard import:

```js
import { lerp, lerpAngle, clamp } from '@zakkster/lite-lerp';
```

`@zakkster/lite-lerp` was declared only in `peerDependencies`. npm 7+
auto-installs peers, so this usually resolved; pnpm's default and Yarn Classic
do **not** auto-install peers, and under those a bare
`import '@zakkster/lite-color'` throws `ERR_MODULE_NOT_FOUND` before a single
function runs. Reproduced in a clean install.

Meanwhile the README and the comparison table advertised "Zero dependencies".
The claim and the import disagreed, and the disagreement was a runtime failure
under two popular package managers, not a documentation nit.

## Options considered

- **A. INLINE (chosen).** `lerp`, `lerpAngle`, `clamp` are three short pure
  functions (`lerpAngle` also pulls in `wrap`). Vendor them, drop the peer, and
  the zero-dependency claim becomes true. Cost: four functions duplicated
  across two packages, and a rule that lite-lerp is the source of truth if they
  ever diverge.
- **B. PROMOTE.** Move lite-lerp to `dependencies`, delete the zero-dependency
  claim. Honest, but makes lite-color a two-package install and contradicts the
  "<1KB hot-path interpolation core" pitch.
- **C. KEEP PEER, FIX DOCS.** Document the peer as required, add an install
  line. Cheapest, but leaves a package that still breaks under pnpm/Yarn Classic
  if the user follows the README.

## Decision

Option **A**. lite-color's pitch is a self-contained `<1KB` hot-path core; a
core with an install-order failure mode is not that, and four small functions
is a smaller tax than a peer edge that fails on two package managers.

The four primitives are vendored **byte-identical** to `@zakkster/lite-lerp`
(`Lerp.js`), so:

- the exported hot-path bodies (`lerpOklch`, `lerpOklchTo`,
  `multiStopGradient*`) are textually unchanged — `fn.toString()` hash parity
  holds and `lerpOklch` ops/s are unchanged by construction; and
- **lite-lerp remains the source of truth.** If a primitive is ever fixed
  upstream, re-copy it here; do not fork the semantics.

## Consequences

- `peerDependencies` removed from `package.json`.
- README "Peer dependency" note and install line updated; the
  "Zero dependencies" comparison-table row is now truthful.
- `llms.txt` Dependencies section reads "None".
- A `test/install-shape.test.mjs` (node:test) asserts the source carries no
  bare `@zakkster/*` import and that importing `Color.js` with an empty
  `node_modules` succeeds — pinning the regression this release fixes.
- Downstream `@zakkster/lite-confetti` (which depends on lite-color) inherits
  the fix transitively.

## Non-goals

No parser work (C2), no gamut work (C3), no public API change.
