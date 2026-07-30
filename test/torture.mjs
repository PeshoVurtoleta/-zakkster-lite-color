/**
 * @zakkster/lite-color -- torture gate.
 *
 * The suite DONE-WHEN is a single command:
 *
 *     node --expose-gc test/torture.mjs        -> prints "ok", exit 0
 *
 * lite-color is pure, single-file color math. Every per-frame API is a *-To
 * variant that writes into caller-owned memory: an out object (lerpOklchTo,
 * multiStopGradientTo, clampToSrgb), an offset window of a shared typed-array
 * buffer (toRgbTo, toRgbBytesTo), or a reused LUT buffer (bakeGradient). The
 * two invariants worth gating are therefore the ecosystem Law's two halves:
 *
 *   1. NO ALLOCATION GROWTH on any hot path -- the body writes bytes into the
 *      caller's memory and RETAINS none of its own. Frame-loop code that pins
 *      nothing keeps the heap flat; the module-level `_lin` scratch behind the
 *      v2.1.0 gamut pair is a fixed cost, never a per-call one. (A double boxed
 *      transiently and scavenged the same tick is within the maxMajor:0 budget
 *      below -- what a render loop cannot afford is a MAJOR GC or a leak, not a
 *      young-gen HeapNumber. So the per-call gate reads SURVIVING bytes.)
 *   2. NO HIDDEN RETENTION -- a buffer handed to the library is released the
 *      instant the caller drops it; the module pins nothing it was lent.
 *
 * Three phases, in the lite-arena vocabulary:
 *
 *   Phase A  retention   -- lite-leak. Distinct out objects and typed-array
 *                           buffers are run through the whole *-To surface,
 *                           then dropped; a FinalizationRegistry settle proves
 *                           the tracker's live count returns to 0 -- the library
 *                           kept no reference to any of them. Structural: the
 *                           reused out object keeps exactly its {l,c,h,a} shape
 *                           across 4096 cycles and never accretes a key.
 *   Phase B  GC budget   -- lite-gc-profiler. Each hot path retains 0 B/call
 *                           (GC-bracketed net heap: a full GC before AND after the
 *                           batch, so transient double-boxing is collected and only
 *                           true retention survives to be counted, min over reps);
 *                           bakeGradient with a reused `out` returns that same
 *                           buffer and retains 0 (the LUT is reused, not re-baked);
 *                           and a >= 200k-op mixed window fires no MAJOR GC
 *                           (maxMajor:0). HARD GATE (STRICT_PHASE_B).
 *   Phase C  controls    -- falsifiability. Each Phase B gate is shown a workload
 *                           that MUST trip it: a retaining beat reads > 0 B/call;
 *                           a fresh-out bakeGradient whose LUTs are KEPT retains
 *                           bytes that scale with steps where the reused-out bake
 *                           was flat 0; and a lite-leak sink that never drops its
 *                           buffers keeps the tracker's live count pinned above 0.
 *                           A gate that cannot fail is decoration (checklist item 8).
 *
 *     TORTURE_CONTROL=alloc node --expose-gc test/torture.mjs   -> exit 1
 *       threads a retaining sink through a real 200k soak, proving the red path
 *       end-to-end: the maxMajor:0 window goes red and the run exits non-zero.
 *
 * Phases run STRICTLY SEQUENTIALLY: lite-gc-profiler allows one measurement at a
 * time, and the retention settle needs the heap to itself.
 *
 * lite-gc-profiler and lite-leak are devDependencies, never runtime deps: this
 * package ships zero dependencies. lite-color allocates nothing lite-leak can
 * watch on its own account -- so lite-leak is pointed at the ONE thing it can
 * honestly prove here: that the caller's buffers outlive the library, not the
 * other way round.
 *
 * @license MIT
 */

import { GcProfiler, assertNoGc } from '@zakkster/lite-gc-profiler';
import { createLeakTracker } from '@zakkster/lite-leak';
import {
    lerpOklchTo,
    multiStopGradientTo,
    toRgbTo,
    toRgbBytesTo,
    bakeGradient,
    BAKE_STRIDE,
    isInSrgb,
    clampToSrgb,
} from '../Color.js';

// Phase B is a HARD GATE. Set false only to re-baseline a regression while you bisect it.
const STRICT_PHASE_B = true;

const CONTROL = process.env.TORTURE_CONTROL || '';

// Net retained bytes/call floor. A hot path that pins nothing reads ~0 (a single
// GC-boundary shift over 100k calls is sub-byte); this floor absorbs that noise
// without letting a real per-call object (>= 16 B) through.
const RETAIN_FLOOR_BPC = 2.0;

const HAS_GC = typeof globalThis.gc === 'function';
const maybeGc = () => { if (HAS_GC) globalThis.gc(); };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const fail = (phase, msg) => {
    process.stderr.write('torture: FAIL [' + phase + '] ' + msg + '\n');
    process.exit(1);
};
const log = (msg) => process.stderr.write(msg + '\n');

// ---------------------------------------------------------------------------
// Fixtures. A four-stop OKLCH palette that deliberately mixes in-gamut stops
// with vivid stops that clip sRGB (so isInSrgb / clampToSrgb both do real work),
// plus the reused caller-owned memory the zero-alloc contract depends on.
// ---------------------------------------------------------------------------
const STOPS = [
    { l: 0.20, c: 0.05, h: 30, a: 1 },    // dark, safely in gamut
    { l: 0.65, c: 0.28, h: 150, a: 0.8 }, // vivid green -- clips
    { l: 0.55, c: 0.31, h: 300, a: 1 },   // vivid violet -- clips
    { l: 0.95, c: 0.02, h: 90, a: 0.5 },  // near-white, in gamut
];

// One reused out object and one reused clamp target -- the {l,c,h,a} the
// zero-alloc contract depends on being reused, not re-created per call.
const outColor = { l: 0, c: 0, h: 0, a: 1 };
const clampOut = { l: 0, c: 0, h: 0, a: 1 };

// Shared offset-write buffers: many colors packed into one Float32Array (WebGL
// attributes) and one Uint8Array (canvas ImageData), addressed by lane.
const LANES = 64; // power of two -- lane index is a cheap mask
const rgbaF = new Float32Array(LANES * 4);
const rgbaB = new Uint8Array(LANES * 4);

/**
 * One measured beat over the entire hot surface, every write landing in reused
 * caller memory. `sink`, when non-null, is the control lever: it retains one
 * small object per beat -- exactly the per-call retention every gate must catch.
 * Returns a number so a smart optimizer cannot elide the work.
 */
function beat(i, sink) {
    const t = (i & 255) / 255;
    const stop = STOPS[i & 3];
    const lane = i & (LANES - 1);
    const off = lane * 4;

    lerpOklchTo(STOPS[0], STOPS[1], t, outColor);
    multiStopGradientTo(STOPS, t, outColor);
    toRgbTo(outColor, rgbaF, off);
    toRgbBytesTo(outColor, rgbaB, off);
    const inGamut = isInSrgb(stop);
    clampToSrgb(stop, clampOut);

    if (sink) sink.push({ l: outColor.l, c: clampOut.c }); // control: retain.

    return outColor.l + clampOut.c + rgbaF[off] + rgbaB[off] + (inGamut ? 1 : 0);
}

// Total retained memory: JS heap PLUS external typed-array backing stores. A
// Float32Array's bytes live in `arrayBuffers`, not `heapUsed` -- and buffers are
// exactly what this library writes -- so counting only heapUsed would miss a leaked
// LUT entirely (it would see just the ~200 B view wrapper). Sum both.
const usedBytes = () => {
    const m = process.memoryUsage();
    return m.heapUsed + m.arrayBuffers;
};

/**
 * Net RETAINED bytes/call: warm, full GC, snapshot, run `calls`, full GC AGAIN,
 * snapshot. The trailing GC reclaims every transient (the HeapNumber boxing FP-heavy
 * color math sheds each tick), so only memory the run PINNED survives to be counted.
 * Reliable in both directions -- ~0 for a zero-retention hot path, and the true object
 * (and backing-store) size for one that leaks -- where measureAllocs' allocation
 * sampling can miss a retained buffer entirely (non-monotonic; steps=64 read 0). Min
 * over reps: a zero-retention body's noise is a two-sided GC-boundary jitter and the
 * min run is the honest floor; a retaining body grows every rep, so the min stays
 * positive.
 */
function retainedBytesPerCall(fn, calls, warm = 5000, reps = 3) {
    let min = Infinity;
    for (let r = 0; r < reps; r++) {
        for (let i = 0; i < warm; i++) fn(i);
        maybeGc();
        maybeGc();
        const before = usedBytes();
        for (let i = 0; i < calls; i++) fn(i);
        maybeGc();
        maybeGc();
        const after = usedBytes();
        const v = (after - before) / calls;
        if (v < min) min = v;
    }
    return min;
}

/**
 * Drive a FinalizationRegistry to quiescence: gc + yield, up to maxRounds, until
 * `liveCount()` reaches 0. Returns the final count. This is the settle pattern the
 * lite-leak test suite itself uses (gc(); await delay; repeat).
 */
async function settle(liveCount, maxRounds = 20) {
    for (let r = 0; r < maxRounds; r++) {
        if (liveCount() === 0) return 0;
        maybeGc();
        // eslint-disable-next-line no-await-in-loop
        await delay(5);
    }
    return liveCount();
}

// ---------------------------------------------------------------------------
// Phase A -- retention (lite-leak). The library pins nothing it is lent, and the
// reused out object never accretes a key.
// ---------------------------------------------------------------------------
async function phaseA() {
    if (!HAS_GC) {
        log('  Phase A inconclusive -- run with node --expose-gc');
        return;
    }

    const tracker = createLeakTracker({ name: 'lite-color-retention' });
    let handles = [];
    const BUFFERS = 256;

    // Hand the library BUFFERS distinct out objects and typed-array buffers,
    // run each through the whole *-To surface, then drop every strong reference.
    // If Color.js stashed any of them, the tracker's live count cannot reach 0.
    for (let i = 0; i < BUFFERS; i++) {
        const oc = { l: 0, c: 0, h: 0, a: 1 };
        const co = { l: 0, c: 0, h: 0, a: 1 };
        const bf = new Float32Array(4);
        const bb = new Uint8Array(4);

        handles.push(tracker.track(oc, null, 'outColor'));
        handles.push(tracker.track(co, null, 'clampOut'));
        handles.push(tracker.track(bf, null, 'rgbaF'));
        handles.push(tracker.track(bb, null, 'rgbaB'));

        const t = (i & 255) / 255;
        lerpOklchTo(STOPS[0], STOPS[2], t, oc);
        multiStopGradientTo(STOPS, t, oc);
        toRgbTo(oc, bf, 0);
        toRgbBytesTo(oc, bb, 0);
        isInSrgb(oc);
        clampToSrgb(STOPS[i & 3], co);
    }

    const tracked = tracker.size();
    if (tracked !== BUFFERS * 4) {
        fail('A-retention', 'tracker registered ' + tracked + ' handles, expected ' + (BUFFERS * 4));
    }

    // Untrack our handles (release the tracker's own bookkeeping), drop the
    // handle array, and settle. `size()` counts handles NOT yet released; every
    // object we tracked is now unreferenced, so it must fall to 0.
    for (let i = 0; i < handles.length; i++) tracker.untrack(handles[i]);
    handles = null;
    const remaining = await settle(() => tracker.size());
    if (remaining !== 0) {
        fail('A-retention', 'library retained ' + remaining + ' caller buffer(s) after drop -- '
            + 'a *-To out param or offset buffer is being pinned');
    }

    // Structural: the reused out object carries exactly {l,c,h,a}, no accreted keys.
    const CYCLES = 4096;
    for (let c = 0; c < CYCLES; c++) beat(c, null);
    const keys = Object.keys(outColor);
    if (keys.length !== 4 || keys[0] !== 'l' || keys[1] !== 'c' || keys[2] !== 'h' || keys[3] !== 'a') {
        fail('A-retention', 'reused out object shape drifted: keys=' + JSON.stringify(keys));
    }
    for (const k of keys) {
        if (!Number.isFinite(outColor[k])) fail('A-retention', 'out.' + k + ' is not finite: ' + outColor[k]);
    }

    log('  Phase A ok -- ' + (BUFFERS * 4) + ' lent buffers all released (live=0); '
        + 'reused out kept {l,c,h,a} across ' + CYCLES + ' cycles');
}

// ---------------------------------------------------------------------------
// Phase B -- GC budget (lite-gc-profiler). Every hot path retains 0 B/call, the
// reused-out bake retains nothing, and a long mixed window fires no major GC.
// ---------------------------------------------------------------------------
async function phaseB() {
    if (!HAS_GC) {
        log('  Phase B inconclusive -- run with node --expose-gc');
        return;
    }

    // (1) Retained allocation of each hot path in isolation -- all must be ~0.
    const CALLS = 100000;
    const rpc = {
        lerpOklchTo: retainedBytesPerCall((i) => lerpOklchTo(STOPS[0], STOPS[1], (i & 255) / 255, outColor), CALLS),
        multiStopGradientTo: retainedBytesPerCall((i) => multiStopGradientTo(STOPS, (i & 255) / 255, outColor), CALLS),
        toRgbTo: retainedBytesPerCall((i) => toRgbTo(STOPS[i & 3], rgbaF, (i & (LANES - 1)) * 4), CALLS),
        toRgbBytesTo: retainedBytesPerCall((i) => toRgbBytesTo(STOPS[i & 3], rgbaB, (i & (LANES - 1)) * 4), CALLS),
        isInSrgb: retainedBytesPerCall((i) => isInSrgb(STOPS[i & 3]), CALLS),
        clampToSrgb: retainedBytesPerCall((i) => clampToSrgb(STOPS[i & 3], clampOut), CALLS),
    };
    let over = null;
    for (const k of Object.keys(rpc)) {
        if (rpc[k] > RETAIN_FLOOR_BPC) { over = k; break; }
    }
    const rpcLine = Object.keys(rpc).map((k) => k + '=' + rpc[k].toFixed(2)).join(' ');

    // (2) bakeGradient with a reused `out`: returns the SAME buffer (no per-bake
    // Float32Array) and retains nothing across repeated bakes into it.
    const STEPS = 256;
    const bakeOut = new Float32Array(STEPS * BAKE_STRIDE);
    if (bakeGradient(STOPS, STEPS, bakeOut) !== bakeOut) {
        fail('B', 'bakeGradient(colors, steps, out) did not return the caller-owned buffer');
    }
    const bakeRpc = retainedBytesPerCall(() => bakeGradient(STOPS, STEPS, bakeOut), 20000, 2000);

    // (3) GC-budget window: >= 200k mixed beats under the profiler, gated maxMajor:0.
    for (let i = 0; i < 5000; i++) beat(i, null); // warm the call sites
    maybeGc();
    const gc = new GcProfiler(256).start();
    for (let i = 0; i < 200000; i++) beat(i, null);
    await gc.settle();
    const summary = gc.summary();
    gc.stop();
    let budgetOk = true;
    let budgetMsg = '';
    try {
        assertNoGc(summary, { maxMajor: 0 });
    } catch (e) {
        budgetOk = false;
        budgetMsg = e && e.message ? e.message : String(e);
    }
    const gcLine = 'major=' + summary.gc.major + ' minor=' + summary.gc.minor
        + ' maxMs=' + summary.gc.maxMs.toFixed(2);

    if (STRICT_PHASE_B) {
        if (over) {
            fail('B', over + ' retains ' + rpc[over].toFixed(2) + ' B/call over the '
                + RETAIN_FLOOR_BPC + ' floor [' + rpcLine + ']');
        }
        if (bakeRpc > RETAIN_FLOOR_BPC) {
            fail('B', 'reused-out bakeGradient retains ' + bakeRpc.toFixed(2)
                + ' B/call -- the LUT buffer is being re-allocated');
        }
        if (!budgetOk) {
            fail('B', '200k mixed window fired a major GC (maxMajor:0) [' + gcLine + ']: ' + budgetMsg);
        }
        log('  Phase B ok -- hot paths 0 B/call retained [' + rpcLine + ']; '
            + 'reused-out bake ' + bakeRpc.toFixed(2) + ' B/call; '
            + '200k window no major GC [' + gcLine + ']');
        return;
    }
    log('  Phase B (non-strict) -- [' + rpcLine + ']; bake ' + bakeRpc.toFixed(2)
        + ' B/call; window [' + gcLine + ']. Set STRICT_PHASE_B=true to gate.');
}

// ---------------------------------------------------------------------------
// Phase C -- controls (falsifiability). Every Phase B gate is shown a workload
// that MUST trip it. If any control reads clean, the matching gate is blind.
// ---------------------------------------------------------------------------
async function phaseC() {
    if (!HAS_GC) {
        log('  Phase C inconclusive -- run with node --expose-gc');
        return;
    }

    // C1: a retaining beat must be VISIBLE to the per-call gate. One kept {l,c}
    // per call is exactly the per-call retention Phase B's 0-B/call claim forbids.
    const retained = [];
    const beatRpc = retainedBytesPerCall(() => { retained.push({ l: beat(retained.length, null), c: 0 }); }, 20000, 2000);
    if (!(beatRpc > RETAIN_FLOOR_BPC)) {
        fail('C-control', 'retaining beat read ' + beatRpc.toFixed(3)
            + ' B/call -- the per-call retention gate cannot see retention');
    }

    // C2: a FRESH-out bakeGradient whose LUTs are KEPT retains bytes that scale
    // with steps, where the reused-out bake retained a flat 0. Proof the bake gate
    // can see a re-allocated LUT. A kept Float32Array LUT is >= BAKE_STRIDE*4 B/step.
    const SMALL = 64;
    const BIG = 256;
    const keepSmall = [];
    const keepBig = [];
    const freshSmall = retainedBytesPerCall(() => { keepSmall.push(bakeGradient(STOPS, SMALL)); }, 4000, 500);
    const freshBig = retainedBytesPerCall(() => { keepBig.push(bakeGradient(STOPS, BIG)); }, 4000, 500);
    if (!(freshSmall > RETAIN_FLOOR_BPC)) {
        fail('C-control', 'fresh-out bakeGradient retained only ' + freshSmall.toFixed(1)
            + ' B/call -- the bake gate cannot see a re-allocated LUT');
    }
    // And the retention must SCALE with steps -- a per-bake LUT, not a fixed cost.
    if (!(freshBig > freshSmall + (BIG - SMALL) * BAKE_STRIDE)) {
        fail('C-control', 'fresh-out bakeGradient retention did not scale with steps '
            + '(small=' + freshSmall.toFixed(0) + ' big=' + freshBig.toFixed(0)
            + ' B/call, expected ~' + (BIG - SMALL) * BAKE_STRIDE * 4 + ' B/call gap)');
    }
    if (keepSmall.length === 0 || keepBig.length === 0) fail('C-control', 'kept-LUT sinks drained');

    // C3: a lite-leak sink that never drops its buffers must keep the tracker's
    // live count pinned above 0 -- proof the retention gate can see real retention.
    const tracker = createLeakTracker({ name: 'lite-color-retention-control' });
    const sink = [];
    const PINNED = 32;
    for (let i = 0; i < PINNED; i++) {
        const buf = new Float32Array(4);
        tracker.track(buf, null, 'pinned');
        toRgbTo(STOPS[i & 3], buf, 0);
        sink.push(buf); // never dropped -- the leak.
    }
    const stillLive = await settle(() => tracker.size(), 8);
    if (stillLive < PINNED) {
        fail('C-control', 'retained ' + stillLive + '/' + PINNED
            + ' buffers still live -- the lite-leak retention gate under-counts a real leak');
    }
    if (sink.length !== PINNED) fail('C-control', 'sink length drifted'); // touch, defeat DCE.

    log('  Phase C ok -- retaining beat ' + beatRpc.toFixed(1) + ' B/call (seen); '
        + 'fresh-out bake ' + freshSmall.toFixed(0) + '->' + freshBig.toFixed(0) + ' B/call by steps (seen); '
        + PINNED + ' pinned buffers held live (seen)');

    // C4: end-to-end red path. TORTURE_CONTROL=alloc threads a retaining sink
    // through a real 200k soak; it MUST breach maxMajor:0, and then we exit 1.
    if (CONTROL === 'alloc') {
        const allocSink = [];
        for (let i = 0; i < 5000; i++) beat(i, null);
        maybeGc();
        const gc = new GcProfiler(256).start();
        for (let i = 0; i < 200000; i++) beat(i, allocSink);
        await gc.settle();
        const summary = gc.summary();
        gc.stop();
        let tripped = false;
        try {
            assertNoGc(summary, { maxMajor: 0 });
        } catch {
            tripped = true;
        }
        if (allocSink.length !== 200000) fail('C-control', 'alloc sink drained under the soak');
        if (!tripped) {
            fail('C-control', 'TORTURE_CONTROL=alloc soak did NOT breach maxMajor:0 '
                + '(major=' + summary.gc.major + ') -- the Phase B GC gate is blind');
        }
        fail('C-control', 'TORTURE_CONTROL=alloc -- forcing non-zero exit '
            + '(soak breached maxMajor:0 as required; major=' + summary.gc.major + ')');
    }
}

async function main() {
    const phases = [['A', phaseA], ['B', phaseB], ['C', phaseC]];
    for (const [name, run] of phases) {
        try {
            // eslint-disable-next-line no-await-in-loop
            await run();
        } catch (e) {
            fail(name, e && e.message ? e.message : String(e));
        }
    }
    process.stdout.write('ok\n');
    process.exit(0);
}

main();
