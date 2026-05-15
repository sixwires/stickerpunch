import Link from "next/link";

export default function NotFound() {
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-sm uppercase tracking-widest text-neutral-500">
        404
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">
        Page not found
      </h1>
      <p className="max-w-md text-neutral-600">
        That page punched itself out of existence.
      </p>
      <Link
        href="/"
        className="text-sm font-medium underline underline-offset-4 hover:text-neutral-600"
      >
        Back to collage
      </Link>
    </section>
  );
}
