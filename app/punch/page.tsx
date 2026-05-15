import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Punch",
  description: "Punch a sticker out of a notebook photo.",
};

export default function PunchPage() {
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">
        Punch coming soon
      </h1>
      <p className="max-w-md text-neutral-600">
        The sticker workspace lands in the next step. For now, the route is
        wired up.
      </p>
    </section>
  );
}
