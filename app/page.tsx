import Link from "next/link";

export default function HomePage() {
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
