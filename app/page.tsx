import Link from "next/link";

import { Collage } from "@/components/collage/Collage";
import { listStickers } from "./actions/stickers";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const initial = await listStickers(null, 30);

  if (initial.items.length === 0) {
    return (
      <section className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          No stickers yet.
        </h1>
        <p className="max-w-md text-neutral-600">
          Nobody has punched a sticker. Be first — drop a notebook page and
          punch out a subject.
        </p>
        <Link
          href="/punch"
          className="rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 transition-colors"
        >
          Start punching →
        </Link>
      </section>
    );
  }

  return <Collage initial={initial.items} initialCursor={initial.nextCursor} />;
}
