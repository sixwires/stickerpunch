import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Sticker Punch keeps and what it never sees.",
};

export default function PrivacyPage() {
  return (
    <article className="prose prose-neutral mx-auto max-w-2xl px-6 py-10">
      <h1>Privacy</h1>
      <p>
        Sticker Punch has no accounts and no cookies beyond Vercel
        Analytics. We try to keep as little as possible.
      </p>
      <h2>What never leaves your device</h2>
      <ul>
        <li>The original notebook photo you upload.</li>
        <li>EXIF data: stripped on decode, before anything else.</li>
        <li>
          Working mask data, undo/redo snapshots, brush strokes — all
          held in browser memory; gone when the tab closes.
        </li>
      </ul>
      <h2>What we store when you post a sticker</h2>
      <p>
        Hitting <strong>Punch</strong> creates a PNG of the sticker only —
        not the source photo. If you also choose to <em>post</em> it to
        the public collage we keep:
      </p>
      <ul>
        <li>The sticker PNG, served from Vercel Blob.</li>
        <li>Width, height, and the time of submission.</li>
        <li>
          A salted SHA-256 hash of your IP address, used solely for
          per-IP rate limiting. The salt is rotated weekly so the hash
          can&apos;t correlate older buckets.
        </li>
      </ul>
      <p>
        We do <em>not</em> store the filename, EXIF data, GPS, or any
        other photo metadata.
      </p>
      <h2>About user-drawn content</h2>
      <p>
        Sticker Punch can&apos;t tell what&apos;s inside a sticker. Anything
        drawn on a notebook page — including names, faces, or other
        personal information — is preserved by the punch and is visible
        to anyone who sees the collage. Use the <strong>Report</strong>{" "}
        button on any sticker to flag it for removal; admins review
        reports and can hide content.
      </p>
      <h2>Moderation</h2>
      <p>
        We run a server-side moderation check on every submission before
        it&apos;s saved. Submissions flagged as NSFW are rejected and
        never reach storage.
      </p>
    </article>
  );
}
