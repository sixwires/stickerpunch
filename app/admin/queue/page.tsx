import { hideSticker, listStickers } from "@/app/actions/stickers";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Review queue",
  robots: { index: false, follow: false },
};

export default async function AdminQueuePage() {
  const page = await listStickers(null, 60);

  async function hide(formData: FormData) {
    "use server";
    const id = formData.get("id");
    if (typeof id === "string") {
      await hideSticker(id, "admin_review");
    }
  }

  return (
    <section className="flex-1 p-6">
      <h1 className="text-2xl font-semibold mb-4">Review queue</h1>
      <p className="text-sm text-neutral-600 mb-4">
        Most recent {page.items.length} sticker{page.items.length === 1 ? "" : "s"}.
        Hide removes them from the public collage. The action is currently
        one-way; restore is not implemented yet.
      </p>
      <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {page.items.map((sticker) => (
          <li
            key={sticker.id}
            className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm"
          >
            <div
              className="relative w-full"
              style={{
                aspectRatio: `${sticker.width} / ${sticker.height}`,
                background:
                  "linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)",
                backgroundSize: "16px 16px",
                backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={sticker.url}
                alt=""
                className="absolute inset-0 h-full w-full object-contain p-2"
                draggable={false}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-neutral-500">
              <span className="truncate" title={sticker.id}>
                {sticker.id}
              </span>
              <form action={hide}>
                <input type="hidden" name="id" value={sticker.id} />
                <button
                  type="submit"
                  className="rounded-full bg-red-600 text-white px-2 py-0.5 hover:bg-red-700 transition-colors"
                >
                  Hide
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
