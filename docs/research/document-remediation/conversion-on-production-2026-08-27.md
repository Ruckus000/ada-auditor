# Conversion reaches production: six builds, four runtime gaps, one methodology

**Date:** 2026-08-27. Closes the largest open item in
[`production-verification-2026-08-26.md`](production-verification-2026-08-26.md):
"the deployed product reads documents and reports on them; it does not yet
convert them." It does now.

`[V]` The proof, end to end on the deployed function, no human input:

| | |
|---|---|
| request | `POST /api/documents/remediate-url`, a 6-page Word document on the builder CDN |
| answer | **200**, PDF-1.7, 99,107 bytes, **8 seconds** wall |
| re-read via production `Inspect` | **tagged**, `already-titled`, `en-US`, 6 pages, 18 headings, 21 lists, **zero gaps** |

The structural profile is identical to what the laptop produced from the same
class of document in
[`live-conversion-verification.md`](live-conversion-verification.md) — the
deployed function and the development machine now agree.

Same privacy stance as every file here: structure only. No document titles,
no text, no URL paths.

## What shipped

A pinned, checksummed headless LibreOffice 26.2.5 (official TDF build, Writer
only, ~440MB installed) assembled during `vercel-build` by
`scripts/prepare-libreoffice.ts` — the `prepare-jvm.ts` pattern applied a
second time — and traced into exactly the three routes that convert. Vercel's
large-functions ceiling (5GB, up from the 250MB that made this impossible)
is what reopened the question; the 794MB that "did not fit" was the macOS
app bundle, never the real cost.

## Six builds, and what each one taught

1. `fetch failed` in 500ms — TDF's download host 302s to a random third-party
   mirror, unreachable from the build machine. **Fix:** the archive host,
   byte-identical sha256 verified before switching. An artifact pinned by hash
   should not arrive from whoever a redirector picked today.
2. `EXDEV` — `/tmp` and the build workspace are different filesystems, and a
   440MB `rename` cannot cross them. **Fix:** stage on the destination device.
3. Exit 127 with a useless message — the gate's own error handler discarded
   `stderr`, the second time this file hid a diagnosis behind
   `String(error).split('\n')[0]`. **Fix:** surface it; the very next build
   named `libssl3.so`.
4. `libssl3.so` — **LibreOffice links the system's NSS and ships none of its
   own**; neither does the build image. The collector compounded it by
   silently skipping every `ldd` line without a resolved path — "collected 52
   system libraries" over an install missing its crypto. **Fix:** install
   `nss`; abort loudly on any `not found`.
5. First green build. `available: true` on production — and the first real
   conversion failed at exec: `oosplash: libXinerama.so.1`. **The launcher is
   a chain** — `soffice` → `oosplash` → `soffice.bin` — and the collector had
   read one binary's dependencies. Build-image verification structurally
   cannot catch this: the build image has X11 system-wide. **Fix:** walk every
   ELF in the bundle; the widened gate immediately named 13 more unresolved —
   all Qt6/GTK4/GStreamer/JAWT, traced to five optional plugins a headless
   conversion never loads, **pruned rather than satisfied**.
6. Fontconfig — the runtime has no `/etc/fonts` at all. **Fix:** a per-run
   `fonts.conf` naming the bundle's own Liberation fonts, written at
   conversion time because the config needs absolute paths and the build
   machine's differ from the runtime's.

## The gap a deploy loop could never have found efficiently

The export then failed as `0xc10 Error Area:Io Class:Write Code:16` — a
generic write error that is actually **NSS failing to dlopen
`libsoftokn3.so`**. No `DT_NEEDED` names it anywhere, so even the
walk-every-ELF collector was blind to it, and the PDF writer initialises NSS
even on an unsigned export.

Per the roadmap's tripwire (a fourth distinct runtime blocker), diagnosis
moved off the deploy loop and into a **runtime-faithful local container**:
bare `amazonlinux:2023`, the bundle assembled by the script's own steps, no
system packages — *stricter* than Vercel's runtime, so a bundle that runs
there runs anywhere. `[V]` Measured yield:

- the exact production error reproduced in a **30-second** loop instead of a
  ~25-minute deploy;
- **twelve** further `DT_NEEDED` libraries enumerated in two minutes (cairo,
  fontconfig, freetype, libpng, xcb-render, xcb-shm, pixman, harfbuzz,
  brotli ×2, X11-xcb, graphite2) — each of which would otherwise have been
  its own deploy;
- the dlopen cause isolated by bisection — same bundle, system libs vs bundle
  libs — and named by `LD_DEBUG=libs` as the one library searched and never
  found (`strace` lies under QEMU emulation; the loader does not);
- `[V]` the full chain then ran on bare AL2023: the same municipal Word
  document to a **tagged, PDF/UA-flagged PDF**.

`DLOPEN_LIBRARIES` is now an explicit list in the build script, and absence is
a build failure naming the library — a rename in the nss package must not
silently recreate a failure this expensive to diagnose.

## What this run leaves open

1. **Cold start is unmeasured.** The 8s conversion hit a warm-enough path;
   the first request after an idle spell on a ~500MB function has no number
   yet.
2. **One document, one format, one site.** The same n=1 caveat every first
   proof here carries; Milestone 2's second municipality is the widening.
3. **The upload path is platform-bounded at 4.5MB** (`docs/env.md`); the
   URL path — the one exercised here — is not.
