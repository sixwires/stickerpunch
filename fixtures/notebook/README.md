# Notebook Fixture Set

This directory backs the Step 3 verification suite from `plans/stickerpunch-build.md`.

## Required content

8 reference notebook photos (`*.jpg` or `*.png`) at native phone-camera resolution. Pick pages that exercise:

1. Single subject, plenty of whitespace.
2. Two subjects far apart.
3. Three subjects in a row.
4. Two touching subjects (watershed split test).
5. Faint pencil sketch on white page.
6. Dense page (≥6 subjects).
7. Ink-on-graph-paper page.
8. Page with text + a single drawing (text should not be a subject).

## manifest.json

```json
{
  "images": [
    { "file": "01-single.jpg", "expectedSubjects": 1 },
    { "file": "04-touching.jpg", "expectedSubjects": 2, "knownTouchingSubjects": true }
  ],
  "minDetectionRate": 0.8
}
```

`minDetectionRate` is the ≥80% bar from the plan: `Σ found ≥ 0.8 × Σ expected` across the set.

## How the verification runs

The fixture test loads each `images[].file`, runs `getSegmentClient().segment(bitmap)` against it, and asserts `result.subjects.length` matches `expectedSubjects` (or that the aggregate rate clears `minDetectionRate`). The runner is browser-only — the model needs WebGPU/WASM + the Cache API.

This is shipped as a Playwright spec under `/punch/__fixtures__` (see Step 8 polish) or run manually via the dev workspace.

## Privacy

Fixture images are reference test data committed to the repo. Use pages you are comfortable being public. No PII, no kids' notebook pages.
