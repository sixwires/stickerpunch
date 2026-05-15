# Sticker Punch — Construction Plan

> **Objective**: Build a userless web app where anyone uploads a notebook photo, auto-detected subjects are punched out as stickers with soft (jelly-like) selection edges, draggable to desktop, and aggregated on a public collage homepage.

**Routes**: `/` (collage of every sticker ever punched), `/punch` (sticker-maker workspace).
**Constraints**: No auth. No accounts. Drop in, punch, leave. Storage deferred but architected for swap.

---

## Stack Decision

| Concern | Choice | Rationale |
|---|---|---|
| Framework | Next.js 15 App Router + TypeScript | Vercel native, server actions for storage, RSC for collage |
| Runtime | Fluid Compute (Node 24) | Default; supports both function and edge needs |
| Styling | Tailwind CSS v4 | Fast, no design system overhead for greenfield |
| Segmentation | `@huggingface/transformers` (transformers.js) — **MODNet** (int8-quantized, ~25 MB) as default; **BiRefNet-lite** as optional "better quality" toggle | Runs entirely client-side via WebGPU/WASM; sub-50 MB models keep first-visit feasible on cellular |
| Image canvas | Native `<canvas>` with `OffscreenCanvas` workers | Avoid React re-render thrash for paint events |
| Storage (deferred) | Vercel Blob (public bucket) behind an interface | Free tier covers MVP; abstract so stub-then-swap |
| Save sticker | Explicit **Download** button as primary (works everywhere); `DataTransfer.setData('DownloadURL', …)` as Chromium-only progressive enhancement | ~25% of users are on Firefox/Safari where drag-to-desktop is unsupported |
| State | Zustand (sticker workspace state) + RSC for collage | Light, no Redux ceremony |
| Deployment | Vercel | Project already aligned with Vercel plugin |

**Hard rejections**:
- No server-side segmentation (cost + cold start). Client-only.
- No user accounts ever — IP-level rate limiting at storage layer when added.
- No persistent in-progress sticker state on server; everything client-local until punch is committed.

---

## Step Dependency Graph

```
1 (Scaffold + CI)
   ↓
2 (Upload + Canvas)
   ↓
3 (Auto-detect)
   ↓
4a (Jelly mask + stamps) ──→ 4b (Animated outline)
                                 ↓
                              5 (Punch + Save)
                                 ↓
                              6a (Storage interface)
                              ↙              ↘
                       6b (Blob impl)    7 (Collage UI)
                              ↘              ↙
                               8 (Polish + Deploy)
```

After 6a lands the `StorageAdapter` interface and `Sticker` type, 6b and 7 proceed in parallel.

---

## Step 1 — Scaffold Next.js + Vercel Project

**Model tier**: default. **Branch**: `feat/scaffold`.

### Context brief (cold-start)
Greenfield repo at `/Users/six/Dev/stickerpunch`. Empty `main`, no commits. gh authed as `sixwires`. No remote yet. Two pages will exist: `/` (collage) and `/punch` (workspace). All other steps assume this scaffold.

### Tasks
- Scaffold via `pnpm create next-app@latest tmp-app --ts --tailwind --app --no-src-dir --eslint --import-alias "@/*"` then move contents into repo root (preserves `plans/` and `.git`).
- Pin Node 24 in `package.json` engines; set packageManager to pnpm.
- Stub pages: `app/page.tsx` (collage placeholder "No stickers yet"), `app/punch/page.tsx` ("Punch coming soon"), `app/not-found.tsx`, basic `app/icon.png` favicon, `metadata` defaults in `app/layout.tsx`.
- Top nav with logo + Home / Punch links.
- `.github/workflows/ci.yml` — runs `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm build` on PRs to `main` and `staging`.
- `gh repo create sixwires/stickerpunch --public --source=. --remote=origin --push` then `git push -u origin main`.
- Create `staging` branch from main, push.
- Enable branch protection on `main` and `staging` (require PR + green CI).

### Verification
- `pnpm dev` → both routes render; favicon and 404 work.
- `pnpm build` and `pnpm lint` → green locally.
- CI workflow green on first PR.
- Repo visible at github.com/sixwires/stickerpunch with both branches.

### Exit criteria
Repo pushed. Both routes deploy to Vercel preview. PR merged to `main`.

### Rollback
`gh repo delete` if repo creation went sideways; otherwise revert PR.

---

## Step 2 — Upload + Canvas Workspace

**Model tier**: default. **Branch**: `feat/upload-canvas`. **Depends on**: Step 1.

### Context brief
`/punch` needs to accept a notebook image (drag-drop, click-to-pick, paste) and render it on a zoomable/pannable canvas. Image is held in memory only — no upload to server. Subsequent steps (3, 4, 5) operate on this canvas.

### Tasks
- Install: `zustand`, `react-dropzone`, `nanoid`.
- Create `lib/workspace/store.ts` — Zustand store: `{ sourceImage: HTMLImageElement | null, imageBitmap, transform: {scale, tx, ty}, stickers: DraftSticker[] }`.
- Create `components/punch/Dropzone.tsx` — handles file/paste/drag entry. Validates: jpeg/png/webp/heic, **max 12 MB** (iOS Safari has ~384 MB tab budget; HEIC decode + canvas + workers push this fast).
- Strip EXIF immediately on decode (use `exifr` to read for orientation, then write a clean re-encoded ImageBitmap with no metadata). Source photo metadata never reaches storage even if a later step posts the raw bitmap by mistake.
- Downscale on decode to max 3072 px long edge before storing the working bitmap.
- Create `components/punch/Canvas.tsx` — full-viewport canvas, pinch/wheel zoom, drag pan, devicePixelRatio-aware.
- HEIC handling: dynamic import `heic2any` only when needed.
- Empty state: "Drop a notebook page" with paste hint.

### Verification
- Upload jpeg, png, webp, heic — all render.
- Zoom 0.25× to 8× smooth on 5000×5000 image.
- Paste from clipboard works.
- No image data leaves browser (verify Network tab).

### Exit criteria
Image loads, transforms cleanly, store reflects state. No detection yet.

### Rollback
Revert PR. Step 3 depends on store shape stabilizing here.

---

## Step 3 — Auto-Detect Subjects (Hover-to-Highlight)

**Model tier**: **strongest** (architecture-sensitive: ONNX model selection, web worker pipeline, memory budget). **Branch**: `feat/auto-detect`. **Depends on**: Step 2.

### Context brief
Notebook pages contain multiple drawings/doodles/sketches separated by whitespace. On image load, run multi-subject segmentation in a worker. Render each detected mask as a hoverable overlay. Hovering pulses a soft outline; clicking promotes that mask to the active selection in Step 4.

### Approach
- Use **MODNet (int8-quantized, ~25 MB)** via `@huggingface/transformers` for the salient-foreground alpha map. Optional **BiRefNet-lite** toggle for "better quality" downloads on demand.
- Split into discrete subjects with: (a) threshold to soft binary at α=0.5, (b) **distance transform**, (c) **watershed** at local maxima, (d) connected components on watershed regions. This separates touching subjects far better than naive CC.
- A manual **"split here"** affordance (draw a short stroke between two subjects) is first-class, not a fallback — notebook pages often have touching ink.
- Each region → `Subject { id, mask: Uint8ClampedArray, bbox, centroid, score }`.
- Web worker runs model + post-process; main thread paints overlays.
- Cache the model in OPFS via `transformers.js` env config to avoid re-download.

### Tasks
- Install: `@huggingface/transformers`, `comlink`.
- `workers/segment.worker.ts` — initializes MODNet with WebGPU fallback to WASM; OPFS-cached weights.
- `lib/segmentation/watershedSplit.ts` — distance-transform + watershed on the soft foreground mask.
- `lib/segmentation/connectedComponents.ts` — flood-fill on watershed regions, min-area filter (configurable, default 0.5% of image area).
- `lib/segmentation/index.ts` — orchestrates worker via Comlink.
- `components/punch/SubjectOverlay.tsx` — soft outer glow on hover, no hard stroke.
- `components/punch/SplitTool.tsx` — drag a short line across a region to force a split.
- Pre-load progress UI: "Downloading punch model (one-time, ~25 MB)…" with cached-on-reload note.
- Memory cap: downscale source to max 1536 px on long edge before model.
- Commit `fixtures/notebook/*.jpg` — 8 reference notebook photos with `fixtures/notebook/manifest.json` listing expected subject counts.

### Verification
- Fixture suite: ≥80% expected subjects detected across 8 reference photos (assertion in `lib/segmentation/__tests__/fixtures.test.ts`).
- Two touching subjects in a fixture are separated by watershed.
- "Split here" stroke divides a single region into two on user demand.
- Hover highlight ≤16 ms latency.
- Model loads once, cached on reload via OPFS.
- Worker isolated — main thread frame rate stays ≥55 fps during inference.

### Exit criteria
Hovering any subject shows a soft pulse outline. Clicking sets it as the active draft in store (handed off to Step 4).

### Rollback
Hide overlay layer if detection fails; user still can use manual jelly tool from Step 4.

### Risks
- WebGPU unavailable on some browsers → falls back to WASM (5–10× slower but works).
- Notebook with touching subjects fail connected-components split → flagged as known limitation; user can split with jelly tool.

---

## Step 4a — Jelly Mask Data Structure + Brush Stamps

**Model tier**: **strongest** (mask math + memory shape sets the ceiling for the rest of the app). **Branch**: `feat/jelly-mask`. **Depends on**: Step 3.

### Context brief
Foundation for the jelly tool. Define the soft-mask data structure, stamp operations, smoothing, and undo/redo. No animated outline yet — that's 4b. The mask must stay soft-edged (feathered alpha) at every step. Resolution is capped at **1024 px on the long edge** for the working mask; on punch, the final composite is performed at source resolution by upsampling the mask through bilinear blur (preserves softness without ballooning memory).

### Approach
- Mask representation: `Uint8Array` alpha buffer (0..255, 1 byte/px) at the **capped working resolution** (1024 px long edge). 4× memory reduction vs Float32. A 1024×768 mask = 768 KB; 20-deep undo stack = ~15 MB before RLE.
- Stamp ops blur their result by 2–4 px so edges never alias to 0/255.
- Stroke smoothing: Catmull-Rom through raw pointer points, sampled at 1 px spacing, stamped with Gaussian-falloff radial brush.
- Edit-jelly: pointer drag adds/subtracts soft brush stamps to the active mask, clamped 0..255.
- Undo/redo: stack of mask snapshots compressed via run-length on quantized alpha (typically 5–20× compression on a typical sticker mask).

### Tasks
- `lib/mask/JellyMask.ts` — class wrapping `Uint8Array`, ops: `stampAdd`, `stampSubtract`, `blur`, `toImageData`, `upsampleTo(width, height)`.
- `lib/mask/smoothing.ts` — Catmull-Rom resampling.
- `lib/mask/snapshots.ts` — RLE encode/decode for undo stack.
- `components/punch/JellyToolbar.tsx` — Lasso / Add / Subtract / Erase modes, brush size slider, softness slider, Undo/Redo.
- Wire: clicking a Step 3 subject downsamples its mask to working resolution and loads into a new JellyMask. User can refine.
- Touch support: same input pipeline, larger default brush, palm rejection (ignore non-primary pointers during stroke).

### Verification
- Loose drag around a subject → soft mask captures with feathered edge.
- Refining an auto-detected mask add/subtract preserves softness.
- Undo/redo 20 steps without perceptible lag (< 50 ms snapshot apply).
- Edge-pixel sample: 10 random edge pixels each have `0 < α < 255`.
- Working mask memory < 2 MB regardless of source image size (assert in test).

### Exit criteria
User can produce a soft mask either from scratch or by refining an auto-detection. JellyMask is wired into the draft sticker store.

---

## Step 4b — Animated Jelly Outline

**Model tier**: default. **Branch**: `feat/jelly-outline`. **Depends on**: Step 4a.

### Context brief
The visual "jelly" feel: the visible selection outline wobbles via animated simplex-noise displacement. Cheap enough to run continuously while a mask exists. Runs on a downsampled mask, upsamples the path — keeps perf bounded on mid-tier mobile.

### Approach
- Marching squares on the JellyMask at iso=0.5, but **on a 256 px downsample**, not the full mask. Trace polylines, upsample coordinates back to canvas space, render as SVG paths.
- Per-frame, displace each path vertex by `simplex(x*0.01, y*0.01, t*0.5) × A px` where A = 1.5 px desktop, 1 px mobile.
- Refresh rate: 30 Hz desktop, 12 Hz mobile (detect via `matchMedia('(pointer:coarse)')`).
- Render via SVG `<path>` with a soft drop-shadow filter — no per-frame canvas re-render of the underlying image.

### Tasks
- `lib/mask/marching.ts` — marching squares on a downsampled mask, returns polyline rings.
- `lib/mask/noise.ts` — simplex noise with seeded RNG.
- `components/punch/JellyOutline.tsx` — `requestAnimationFrame` loop, SVG path rendering, rate-gated by device class.
- Hook in 3's hover state: hovered subjects also use this outline (lower wobble amplitude when not active).

### Verification
- Visible wobble on active selection: ~30 Hz desktop, ~12 Hz mobile.
- Frame rate stays ≥55 fps on a mid-tier Android (manual smoke or perf trace).
- Disabling outline via toolbar toggle returns CPU usage to baseline.

### Exit criteria
Jelly feel is visually present and performant across devices. Active mask outline animates continuously without canvas thrash.

### Risks
- SVG path with many vertices can still tax mid-tier devices — cap polyline density to ≤256 vertices per ring; simplify with Ramer-Douglas-Peucker.

---

## Step 5 — Punch + Save Sticker

**Model tier**: default. **Branch**: `feat/punch-and-save`. **Depends on**: Step 4b.

### Context brief
"Punch" = composite (source × upsampled mask alpha) into a new image, crop to mask bbox + margin (default 24 px), output as a PNG with transparency. **Primary save path is an explicit Download button** that works on every browser. Drag-to-desktop is a Chromium-only progressive enhancement layered on top — never gate UX on it.

### Tasks
- `lib/sticker/punch.ts` — input `{sourceBitmap, JellyMask, margin}`, output `{blob: Blob, width, height, bbox}`. Uses `OffscreenCanvas` if available. Upsamples mask to source resolution via bilinear blur to preserve softness.
- `components/punch/StickerCard.tsx` — sticker on checker bg; props: blob URL, dimensions. Always renders a **"Download PNG"** button. Adds `draggable` + `onDragStart` with `setData('DownloadURL', 'image/png:sticker.png:<blob URL>')` and `text/uri-list` — silently no-ops on non-Chromium, button still works.
- Browser detection: show a small "Tip: drag me to your desktop" hint **only** when `navigator.userAgent` matches Chromium and the feature passes a feature probe; otherwise show "Click Download to save".
- `components/punch/StickerTray.tsx` — horizontal strip of punched stickers below the canvas; each card has Download button + (Chromium) drag handle.
- "Punch" button on workspace toolbar finalizes active mask into a sticker and adds to tray.
- After punch, mask is cleared; user can punch another subject from same page.
- Soft drop-shadow on punched sticker for collage-style feel.

### Verification
- Punch a sticker, click Download → file saved as PNG with transparent bg on Firefox, Safari, Chrome.
- On Chrome: drag to Finder/Explorer also saves the file.
- Mask edges in saved PNG are smooth (no aliasing).
- Margin around subject is correct (configurable 8–64 px).
- Punch 10 stickers from one page without measurable memory growth (heap snapshot test).

### Exit criteria
Anyone on any browser can land on `/punch`, drop an image, hover-click a subject, punch, and save the sticker to disk. Full local workflow works without any server.

---

## Step 6a — Storage Interface + In-Memory Stub

**Model tier**: default. **Branch**: `feat/storage-interface`. **Depends on**: Step 5. **Blocks**: 6b and 7.

### Context brief
Define the contract that Step 6b (Blob backend) and Step 7 (Collage UI) both depend on. Lands the in-memory stub so 7 can develop against real types while 6b builds the production backend in parallel.

### Tasks
- `lib/storage/types.ts` — `Sticker { id, url, width, height, createdAt, hidden? }`, `StorageAdapter { put(blob, meta): Promise<Sticker>; list(cursor?): Promise<{items, nextCursor}>; hide(id): Promise<void> }`.
- `lib/storage/memory.ts` — in-process, dev-only; behind `STORAGE_DRIVER=memory`.
- `lib/storage/index.ts` — adapter dispatcher; throws clearly when prod-required env is missing.
- Server actions: `submitSticker(formData)`, `listStickers(cursor)`, `hideSticker(id, reason)`.

### Verification
- `STORAGE_DRIVER=memory pnpm dev` — submit, list, hide all round-trip.
- TypeScript build green; `Sticker` and `StorageAdapter` exported as the public contract.

### Exit criteria
Interface and stub merged. Step 6b and Step 7 unblock.

---

## Step 6b — Vercel Blob Backend + Rate Limit + Server-Side Moderation

**Model tier**: default. **Branch**: `feat/storage-blob`. **Depends on**: Step 6a.

### Context brief
Production storage. Userless implies aggressive abuse defense: random IDs (not content hash — content-addressed names enable enumeration griefing), mandatory Upstash rate limit in prod, server-side moderation check before write.

### Tasks
- `lib/storage/blob.ts` — Vercel Blob (`@vercel/blob`) with public access. Key = `stickers/<nanoid(16)>.png` (random, not hash). A **separate** `lib/storage/dedupIndex.ts` keeps a hash → id map for dedup, decoupled from the public URL.
- `lib/ratelimit/ip.ts` — Upstash Redis (`@upstash/ratelimit` + `@upstash/redis`) sliding-window: 30 stickers / hour / IP. **Mandatory in prod** — when `NODE_ENV=production` and `UPSTASH_REDIS_REST_URL` is unset, fail closed (reject all submits with 503 + log).
- `lib/moderation/server.ts` — server-side NSFW gate using a cheap classifier (e.g., `nsfw-detector` Vercel Function or a hosted Perspective-API equivalent). Runs **before** Blob write. Client-side check from Step 8 is a UX courtesy; this is the authoritative check.
- Metadata persisted: `{id, blobUrl, width, height, createdAt, ipHashSalted, hidden, hideReason?}`. Stored alongside the blob (JSON sidecar) or in a small Vercel KV alternative — start with JSON sidecar to avoid another service.
- IP hashing: salted with a `RATELIMIT_SALT` env var, rotated weekly via a cron in Step 8.

### Verification
- `STORAGE_DRIVER=blob` with `BLOB_READ_WRITE_TOKEN` + `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` + `RATELIMIT_SALT` set — full submit/list/hide round-trip.
- 31st submit from same IP in an hour → 429.
- Submit of a known-NSFW test fixture → 422, no Blob write occurred.
- Missing Upstash env in `NODE_ENV=production` → submit fails closed with 503.
- Public sticker URLs are unguessable nanoid-based (assert format).

### Exit criteria
Production storage path is live, rate-limited, moderated, and abuse-resistant. Sticker IDs are not enumerable.

### Risks
- Vercel Blob 5 GB free tier — fine for early traffic; track usage with a daily cron alert in Step 8 and add per-sticker count cap if approaching limit.

---

## Step 7 — Collage Homepage

**Model tier**: default. **Branch**: `feat/collage`. **Depends on**: Step 6a (for Sticker type and stub). **Can parallel**: Step 6b.

### Context brief
`/` is a public, scrolling collage of every sticker ever punched. Looks chaotic-fun like a sticker-covered notebook. RSC-rendered first page; client-side virtualized masonry for scroll. CSS columns + rotated children breaks intersection observers and reflows heavily past ~500 items, so use JS masonry from the start.

### Tasks
- `app/page.tsx` — Server Component fetching first page via `listStickers()` (stub during 7's development; real Blob after 6b).
- `components/collage/Masonry.tsx` — JS-driven virtualized masonry via `masonic` (or equivalent). Each sticker rotated by a per-id seeded angle (-8° to +8°) with hover lift. Virtualization is non-negotiable — works at 200 and at 50k items.
- `components/collage/InfiniteList.tsx` — intersection observer drives next-cursor fetch; integrates with Masonic's row callback.
- Empty state: "Nobody has punched a sticker yet. Be first → /punch".
- Per-sticker click → modal with sticker on transparent bg + **Download PNG** button (drag hint only on Chromium).
- Lazy-load images: `loading="lazy"`, `fetchpriority="low"` past fold, sized via `width`/`height` on `<img>` to avoid CLS.
- Per-sticker **Report** button → calls `hideSticker(id, reason)` server action.
- OG meta + dynamic OG image showing 12 random stickers (via `opengraph-image.tsx`).

### Verification
- 200 stickers → first paint < 1.5 s on simulated 4G.
- Synthetic 10k-item dataset scrolls smoothly (≥50 fps) thanks to virtualization.
- Infinite scroll loads next page without layout shift.
- Click sticker → modal opens; Download button saves the file on every browser.
- Lighthouse: Performance ≥ 90, A11y ≥ 95.

### Exit criteria
Public homepage shows all non-hidden stickers from storage. Anyone visiting sees the global collage without login. Performant at 10k+ items.

---

## Step 8 — Polish + Production Deploy

**Model tier**: default. **Branch**: `feat/polish-deploy`. **Depends on**: Steps 6b and 7.

### Context brief
Final pass: mobile touch parity, error states, content moderation hook, deploy to Vercel production, smoke tests.

### Tasks
- Mobile: touch pinch-zoom, tap-to-select, larger jelly brush default, bottom-sheet toolbar.
- Error UI: model load failure, oversize image, network failure on post.
- Content safety: client-side NSFW screen using `nsfwjs` as a courtesy warning *before* showing the Post button. The authoritative gate is server-side (Step 6b).
- Abuse: report button (already in Step 7) wired to `hideSticker`. Add an admin-only `/admin/queue` (gated by `ADMIN_TOKEN` env header) for manual review of reported items.
- IP-hash salt rotation: weekly Vercel cron rewrites `RATELIMIT_SALT` consumer cache so prior IP buckets fade.
- Blob usage alert: daily cron checks total Blob size, emails if >80% of free tier.
- SEO: sitemap, robots, OG image generator.
- Analytics: Vercel Analytics, Speed Insights.
- Branch protections: require PR + green CI on `main`.
- Promote to production domain. Verify `vercel env` has `BLOB_READ_WRITE_TOKEN` set in production scope.
- Smoke test journey: upload → hover → click → jelly-edit → punch → drag-out → post → see on `/`.

### Verification
- Full mobile run-through on real iPhone Safari + Android Chrome.
- Lighthouse desktop + mobile ≥ 90 perf.
- All routes return 200, OG renders.
- NSFW screen blocks an obviously-NSFW test image.

### Exit criteria
Site is live at production URL. Anyone can punch a sticker without an account. Homepage shows everyone's stickers.

---

## Cross-cutting Invariants (verify after every step)

- [ ] No user accounts, no cookies beyond Vercel Analytics.
- [ ] **No raw uploaded photo is ever transmitted off the device.** Only the punched sticker PNG can leave the browser. EXIF stripped on decode. Originals discarded when tab closes.
- [ ] Persisted metadata includes only `{id, blobUrl, dims, createdAt, ipHashSalted, hidden}`. No filenames, no EXIF, no GPS.
- [ ] All masks remain soft-edged (no aliased binary boundaries) end-to-end.
- [ ] `pnpm build` green.
- [ ] `pnpm lint` green.
- [ ] No new direct DOM mutation outside canvas/worker boundaries — React stays declarative.
- [ ] Punched stickers themselves may contain user-drawn content that constitutes PII (e.g., kids' notebook pages). The Report path (Step 7) + admin hide (Step 8) is the mitigation; document this honestly in `/privacy`.

## Open Questions for Later

- Domain name (stickerpunch.app? .lol?).
- Sticker pack download (zip of N stickers from collage).
- API for external creative tools (Figma/Procreate plugin).
- Content moderation escalation if abuse rate exceeds threshold.

## Plan Mutation Log

| Date | Step | Change | Reason |
|---|---|---|---|
| 2026-05-15 | — | Plan created | Initial draft |
| 2026-05-15 | 3 | RMBG-1.4 → MODNet (25 MB); added watershed split + first-class "split here" tool; added fixture set | Adversarial review: 176 MB model breaks userless promise; CC alone fails on touching subjects |
| 2026-05-15 | 4 | Split into 4a (mask + stamps) and 4b (animated outline); Float32 → Uint8; capped working mask to 1024 px long edge | Memory blow-up at source resolution; one PR doing 5 novel things |
| 2026-05-15 | 5 | Demoted drag-to-desktop to progressive enhancement; Download button is primary | Firefox/Safari (~25% of users) lack `DownloadURL` drag |
| 2026-05-15 | 6 | Split into 6a (interface + stub) and 6b (Blob + Upstash + server moderation); random IDs not content hash; Upstash mandatory in prod | Enables true parallelism with Step 7; closes enumeration/rate-limit/moderation gaps |
| 2026-05-15 | 7 | JS virtualized masonry (Masonic) from day 1, not CSS columns | CSS columns + rotated children breaks past ~500 items |
| 2026-05-15 | 1 | Added CI workflow, favicon, metadata, 404, branch protection; dropped invented `vercel.ts` | Pre-existing scaffold gaps; `vercel.ts` not a real Next.js convention |
| 2026-05-15 | 2 | Upload cap 25 → 12 MB; EXIF strip on decode; downscale to 3072 px | iOS Safari tab budget; PII leakage |
| 2026-05-15 | Cross-cut | "No original photo persisted" rescoped to "never transmitted off device"; honest disclosure that punched stickers themselves may be PII | Original framing was unachievable in absolute terms |
