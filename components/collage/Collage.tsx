"use client";

import { useCallback, useRef, useState } from "react";
import { Masonry, useInfiniteLoader } from "masonic";

import { listStickers } from "@/app/actions/stickers";
import type { Sticker } from "@/lib/storage/types";

import { StickerModal } from "./StickerModal";
import { StickerTile } from "./StickerTile";

export interface CollageProps {
  initial: Sticker[];
  initialCursor: string | null;
}

export function Collage({ initial, initialCursor }: CollageProps) {
  const [items, setItems] = useState<Sticker[]>(initial);
  const cursorRef = useRef<string | null>(initialCursor);
  const inFlight = useRef(false);
  const [selected, setSelected] = useState<Sticker | null>(null);

  const fetchMore = useCallback(async () => {
    if (inFlight.current || cursorRef.current === null) return;
    inFlight.current = true;
    try {
      const page = await listStickers(cursorRef.current, 30);
      cursorRef.current = page.nextCursor;
      if (page.items.length > 0) {
        setItems((prev) => [...prev, ...page.items]);
      }
    } finally {
      inFlight.current = false;
    }
  }, []);

  const maybeLoadMore = useInfiniteLoader(fetchMore, {
    isItemLoaded: (index, loaded) => Boolean(loaded[index]),
    minimumBatchSize: 30,
    threshold: 8,
  });

  const renderTile = useCallback(
    ({ data, width, index }: { data: Sticker; width: number; index: number }) => (
      <StickerTile data={data} width={width} index={index} onSelect={setSelected} />
    ),
    [],
  );

  return (
    <div className="flex-1 px-4 py-6">
      <Masonry<Sticker>
        items={items}
        columnGutter={16}
        rowGutter={24}
        columnWidth={180}
        maxColumnCount={8}
        overscanBy={3}
        itemKey={(data) => data.id}
        itemHeightEstimate={220}
        render={renderTile}
        onRender={maybeLoadMore}
      />
      {selected ? (
        <StickerModal sticker={selected} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
}
