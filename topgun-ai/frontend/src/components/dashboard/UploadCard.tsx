import { Card } from "@/components/ui/Card";

export function UploadCard() {
  return (
    <Card
      title="Upload documents"
      subtitle="Drop AMMs, IPCs, work orders, logbooks, or scans"
    >
      <div className="rounded-xl border border-dashed border-cyan-500/30 bg-cyan-500/5 p-8 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
          ↑
        </div>
        <div className="text-[13px] text-ink-100">
          Drag a PDF or image here
        </div>
        <div className="mt-1 text-[11px] text-ink-400">
          Up to 50 MB · PDF, PNG, JPG, TIFF
        </div>
        <button className="btn-primary mt-5">Choose file</button>
      </div>
      <ul className="mt-4 grid gap-2 text-[11px] text-ink-400">
        <li>• Files are routed through the ingestion pipeline automatically.</li>
        <li>• OCR fallback runs only when the primary extractor finds no text.</li>
        <li>• You can ingest the same file again to refresh chunks and embeddings.</li>
      </ul>
    </Card>
  );
}
