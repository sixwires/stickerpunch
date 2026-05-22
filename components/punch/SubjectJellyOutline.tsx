"use client";

import { useWorkspace } from "@/lib/workspace/store";

import { JellyOutline } from "./JellyOutline";

/**
 * Animated jelly outline for the currently hovered or active subject in
 * Step 3's segmentation results. Active subjects wobble at full amplitude;
 * hovered (non-active) subjects wobble more gently to telegraph
 * interactability without distracting from the underlying photo.
 */
export function SubjectJellyOutline() {
  const segmentation = useWorkspace((s) => s.segmentation);
  const source = useWorkspace((s) => s.source);
  const hoverId = useWorkspace((s) => s.hoverSubjectId);
  const activeId = useWorkspace((s) => s.activeSubjectId);

  if (!segmentation || !source) return null;
  const id = activeId ?? hoverId;
  if (!id) return null;
  const subject = segmentation.subjects.find((s) => s.id === id);
  if (!subject) return null;

  const isActive = id === activeId;
  return (
    <JellyOutline
      alpha={subject.mask}
      maskWidth={subject.maskWidth}
      maskHeight={subject.maskHeight}
      sourceWidth={source.width}
      sourceHeight={source.height}
      version={isActive ? 2 : 1}
      amplitudeScale={isActive ? 1 : 0.4}
      stroke={isActive ? "#22c55e" : "#7c3aed"}
    />
  );
}
