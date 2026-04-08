"use client";

import { useRef, useState } from "react";

import { Card } from "@/components/ui/Card";
import { api } from "@/lib/api";
import type { DocumentSummary } from "@/lib/types";

type Status =
  | { kind: "idle" }
  | { kind: "uploading"; filename: string }
  | { kind: "ok"; doc: DocumentSummary }
  | { kind: "error"; message: string };

export function UploadCard() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [drag, setDrag] = useState(false);

  const onPick = () => inputRef.current?.click();

  const upload = async (file: File) => {
    setStatus({ kind: "uploading", filename: file.name });
    try {
      const doc = await api.uploadDocument(file);
      setStatus({ kind: "ok", doc });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Upload failed",
      });
    }
  };

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await upload(file);
    e.target.value = ""; // allow re-upload of same file
  };

  const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await upload(file);
  };

  return (
    <Card
      variant="accent"
      title="Upload documents"
      subtitle="Drop AMMs, IPCs, work orders, logbooks, or scans"
    >
      <div
        onClick={onPick}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        role="button"
        tabIndex={0}
        className={`group cursor-pointer rounded-xl border border-dashed p-7 text-center transition ${
          drag
            ? "border-cyan-400/60 bg-cyan-500/[0.08]"
            : "border-cyan-500/30 bg-cyan-500/[0.04] hover:border-cyan-400/50 hover:bg-cyan-500/[0.07]"
        }`}
      >
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl border border-cyan-500/30 bg-cyan-500/[0.1] text-lg text-cyan-300 transition group-hover:scale-105">
          ↑
        </div>
        <div className="text-[13px] font-medium text-ink-100">
          Drag a file here, or click to browse
        </div>
        <div className="mt-1 text-[11px] text-ink-400">
          PDF, TXT, MD · up to 50 MB · ingested with citations
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.txt,.md"
          onChange={onChange}
          className="hidden"
        />
      </div>

      {/* Status row */}
      <div className="mt-4 min-h-[58px]">
        {status.kind === "idle" && (
          <ul className="space-y-1.5 text-[11px] leading-relaxed text-ink-400">
            <li>• Files are routed through the ingestion pipeline automatically.</li>
            <li>• OCR fallback runs only when the primary parser finds no text.</li>
            <li>• Re-upload to refresh chunks and embeddings for a document.</li>
          </ul>
        )}
        {status.kind === "uploading" && (
          <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/[0.06] p-3">
            <div className="flex items-center justify-between text-[11px]">
              <span className="label-eyebrow text-cyan-300">Ingesting…</span>
              <span className="mono-meta">{status.filename}</span>
            </div>
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/[0.05]">
              <div className="h-full w-1/2 animate-pulse bg-gradient-to-r from-cyan-400 to-cyan-600" />
            </div>
          </div>
        )}
        {status.kind === "ok" && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-3">
            <div className="flex items-center justify-between text-[11px]">
              <span className="label-eyebrow text-emerald-300">
                Indexed · {status.doc.type}
              </span>
              <span className="mono-meta">{status.doc.pages ?? "—"} pages</span>
            </div>
            <div className="mt-1 truncate text-[12.5px] text-ink-100">
              {status.doc.title}
            </div>
          </div>
        )}
        {status.kind === "error" && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/[0.06] p-3">
            <div className="label-eyebrow text-rose-300">Upload failed</div>
            <div className="mt-1 text-[12px] text-ink-200">
              {status.message}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
