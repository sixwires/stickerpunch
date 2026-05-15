"use client";

import { useCallback, useEffect, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import {
  ACCEPTED_MIME,
  DecodeError,
  MAX_BYTES,
  decodeImage,
  isAcceptedFile,
} from "@/lib/workspace/decode";
import { useWorkspace } from "@/lib/workspace/store";

const DROPZONE_ACCEPT = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/heic": [".heic"],
  "image/heif": [".heif"],
};

export function Dropzone() {
  const setSource = useWorkspace((s) => s.setSource);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const { bitmap, width, height } = await decodeImage(file);
        setSource(bitmap, {
          fileName: file.name,
          width,
          height,
          byteSize: file.size,
        });
      } catch (err: unknown) {
        if (err instanceof DecodeError) {
          setError(err.message);
        } else if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Could not read that file");
        }
      } finally {
        setBusy(false);
      }
    },
    [setSource],
  );

  const onDrop = useCallback(
    (accepted: File[], rejected: FileRejection[]) => {
      if (rejected.length > 0) {
        const reason = rejected[0]?.errors[0];
        if (reason?.code === "file-too-large") {
          setError(`File is larger than ${Math.round(MAX_BYTES / 1024 / 1024)} MB`);
        } else if (reason?.code === "file-invalid-type") {
          setError("Unsupported file type — use jpg, png, webp, or heic");
        } else {
          setError(reason?.message ?? "File rejected");
        }
        return;
      }
      const file = accepted[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: DROPZONE_ACCEPT,
    maxSize: MAX_BYTES,
    multiple: false,
    noClick: true,
    noKeyboard: true,
  });

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (!file) continue;
        if (!isAcceptedFile(file)) continue;
        event.preventDefault();
        void handleFile(file);
        return;
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [handleFile]);

  return (
    <div
      {...getRootProps({
        className: [
          "flex-1 m-4 rounded-3xl border-2 border-dashed",
          "flex flex-col items-center justify-center gap-3 text-center px-6",
          "transition-colors",
          isDragActive
            ? "border-pink-400 bg-pink-50"
            : "border-neutral-300 bg-white",
        ].join(" "),
      })}
    >
      <input {...getInputProps()} aria-label="Choose notebook image" />
      <h1 className="text-2xl font-semibold tracking-tight">
        Drop a notebook page
      </h1>
      <p className="text-sm text-neutral-500 max-w-sm">
        Drag a photo here, paste from clipboard, or pick a file. Stays on this
        device — nothing uploads.
      </p>
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className="rounded-full bg-neutral-900 text-white text-sm px-4 py-2 hover:bg-neutral-700 disabled:opacity-50 transition-colors"
      >
        {busy ? "Reading…" : "Pick a file"}
      </button>
      <p className="text-xs text-neutral-400">
        {ACCEPTED_MIME.map((m) => m.replace("image/", "")).join(" · ")} ·
        max {Math.round(MAX_BYTES / 1024 / 1024)} MB
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-600 mt-1">
          {error}
        </p>
      )}
    </div>
  );
}
