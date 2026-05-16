# Sticker Punch

Userless web app where anyone uploads a notebook photo, auto-detected subjects get punched out as soft-edged "jelly" stickers, downloaded per browser, and aggregated on a public collage homepage at `/`.

No accounts. No uploads to a server during the punch flow — segmentation runs entirely client-side via WebGPU/WASM. Only the final punched sticker PNG is ever transmitted (to the public collage in Step 6+).

| Route   | Purpose                                                    |
| ------- | ---------------------------------------------------------- |
| `/`     | Public scrolling collage of every sticker ever punched.    |
| `/punch`| Sticker-maker workspace (upload → auto-detect → punch).    |

Construction plan of record: [`plans/stickerpunch-build.md`](plans/stickerpunch-build.md) (8 steps).

## Status

| Step                                        | State        |
| ------------------------------------------- | ------------ |
| 1 — Scaffold Next.js + CI                   | Merged       |
| 2 — Upload + Canvas workspace               | Merged       |
| 3 — Auto-Detect Subjects (MODNet + watershed)| Merged      |
| 4a — Jelly mask data structure + brush      | Next         |
| 4b — Animated jelly outline                 | Pending      |
| 5 — Punch + Save sticker                    | Pending      |
| 6a/6b — Storage interface + Vercel Blob     | Pending      |
| 7 — Collage homepage                        | Pending      |
| 8 — Polish + Production deploy              | Pending      |

Production preview deployed via Vercel CLI: <https://stickerpunch.vercel.app>. Automatic PR previews depend on the Vercel GitHub App being installed on `sixwires/stickerpunch` (still pending — see [Deploy](#deploy) below).

## Prerequisites

| Tool   | Version            | Notes                                 |
| ------ | ------------------ | ------------------------------------- |
| Node   | `>=24.0.0`         | Pinned via `engines.node`             |
| pnpm   | `10.9.0`           | Pinned via `packageManager`           |
| Git    | any modern         | Required for hooks + GitHub workflow  |

```bash
nvm install 24
nvm use 24
corepack enable
pnpm install --frozen-lockfile
```

## Scripts

<!-- AUTO-GENERATED:scripts -->
| Command       | Description                                                |
| ------------- | ---------------------------------------------------------- |
| `pnpm dev`    | Start Next.js dev server (Turbopack) at <http://localhost:3000>. |
| `pnpm build`  | Production build via `next build` (Turbopack).             |
| `pnpm start`  | Serve the production build with `next start`.              |
| `pnpm lint`   | Run ESLint against the workspace.                          |
<!-- /AUTO-GENERATED:scripts -->

## Architecture (high level)

| Layer                 | Choice                                       | Why                                           |
| --------------------- | -------------------------------------------- | --------------------------------------------- |
| Framework             | Next.js 16 (App Router) + React 19           | Server Components for `/`, client workspace for `/punch`. |
| Styling               | Tailwind CSS v4                              | No design-system overhead.                    |
| State (workspace)     | Zustand (`lib/workspace/store.ts`)           | Avoids React re-render thrash on paint events.|
| Segmentation          | `@huggingface/transformers` + Comlink worker | `Xenova/modnet` (~25 MB, int8) runs client-side via WebGPU → WASM fallback; weights cached via the browser Cache API. |
| Subject splitting     | Chamfer distance transform + watershed flood | Separates touching subjects beyond naive connected components. |
| Image decode          | `exifr` (orientation) + `heic2any` (HEIC)    | Re-encodes to ImageBitmap, strips EXIF, downscales to 3072 px long edge. |
| Storage (deferred)    | Vercel Blob (public bucket) behind interface | Stub-then-swap pattern; lands in Steps 6a/6b. |
| Hosting               | Vercel (Fluid Compute, Node 24)              | Static-first; per-step deploys.               |

### Key directories

| Path                          | Purpose                                                  |
| ----------------------------- | -------------------------------------------------------- |
| `app/`                        | Next.js App Router routes (`/`, `/punch`, `not-found`).  |
| `components/punch/`           | Workspace shell, Canvas, Dropzone, SubjectOverlay, SplitTool. |
| `lib/workspace/`              | Workspace Zustand store + image decode pipeline.         |
| `lib/segmentation/`           | Connected components, watershed split, worker client.    |
| `workers/segment.worker.ts`   | Module worker hosting the segmentation pipeline.         |
| `fixtures/notebook/`          | Step 3 verification fixtures + manifest schema.          |
| `plans/`                      | Construction plan + step dependency graph.               |
| `.github/workflows/ci.yml`    | PR + push CI (`lint` + `build`) on `main` and `staging`. |

## Privacy guarantees (enforced in code)

- Raw uploaded photos never leave the browser.
- EXIF metadata is stripped on decode (see `lib/workspace/decode.ts`).
- No user accounts, no cookies beyond Vercel Analytics (when enabled in Step 8).
- Public sticker metadata (Steps 6b+): random `nanoid` IDs (not content-hash), salted IP hash for rate limits, no filenames or GPS.

Full cross-cutting invariants live in [`plans/stickerpunch-build.md`](plans/stickerpunch-build.md#cross-cutting-invariants-verify-after-every-step).

## Git workflow

- Default PR base branch: **`staging`** (per global rules and project convention).
- `main` and `staging` are protected: require PR + green CI (`build` check from `.github/workflows/ci.yml`).
- Pre-push gates: `pnpm lint` + `pnpm build` must be green.
- Commit format: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, …).

## Deploy

Vercel project: `sixs-projects-3c178460/stickerpunch` (project ID `prj_K8XSxT7dyWduJajeSJwlgEEEZMSA`). Local clone is linked via `.vercel/project.json` (gitignored).

Current production URL: <https://stickerpunch.vercel.app>.

To enable automatic preview deploys on PRs, install the Vercel GitHub App on `sixwires/stickerpunch` under the BINK team scope, then run:

```bash
vercel git connect --scope sixs-projects-3c178460 --yes
```

Until that is done, deploys must be pushed manually with:

```bash
vercel --scope sixs-projects-3c178460        # preview deploy
vercel --scope sixs-projects-3c178460 --prod # production promote
```

## Step 3 model notes (auto-detect)

- Model: [`Xenova/modnet`](https://huggingface.co/Xenova/modnet) (transformers.js port of MODNet), ~25 MB int8.
- Backend selection: WebGPU preferred (`fp32`), falls back to WASM (`q8`).
- Cache: browser Cache API via `env.useBrowserCache = true`; subsequent loads are network-free.
- Working resolution: source is downscaled to 1536 px on the long edge before inference (memory budget).
- Subject split: chamfer distance transform → seed picking with min-separation → bucket-queue watershed; min-area filter at 0.5 % of working frame.
- Verification suite: see [`fixtures/notebook/README.md`](fixtures/notebook/README.md). The 8 reference photos themselves are not yet committed.
