// Shared TypeScript types for the Topgun AI frontend.
// These mirror the FastAPI pydantic schemas defined in
// backend/app/schemas/. Keep them in sync when the API contract changes.

export type DocumentType =
  | "AMM"
  | "IPC"
  | "SB"
  | "WORK_ORDER"
  | "LOGBOOK"
  | "TROUBLESHOOTING"
  | "PARTS_CATALOG"
  | "INSPECTION_PROGRAM"
  | "UNKNOWN";

export type DocumentStatus = "uploaded" | "processing" | "indexed" | "failed";

export interface DocumentSummary {
  id: string;
  title: string;
  type: DocumentType;
  aircraft?: string | null;
  source?: string | null;
  status: DocumentStatus;
  pages?: number | null;
  size_mb?: number | null;
  uploaded_at?: string | null;
  uploaded_by?: string | null;
  tags: string[];
  summary?: string | null;
}

export interface DocumentListResponse {
  documents: DocumentSummary[];
  total: number;
}

export type ConfidenceLabel = "high" | "medium" | "low" | "insufficient";

export interface ConfidenceReport {
  score: number;
  label: ConfidenceLabel;
  reason: string;
}

export interface AnswerSection {
  heading: string;
  bullets: string[];
}

export interface Citation {
  document_id: string;
  document_title: string;
  document_type: string;
  page: number;
  snippet: string;
  score: number;
  lane: "manual" | "history" | "parts" | "pattern";
}

export interface DocRef {
  id: string;
  title: string;
  type: string;
}

export interface ExtractedEntity {
  kind:
    | "aircraft"
    | "tail_number"
    | "ata"
    | "part_number"
    | "bulletin"
    | "inspector"
    | "date";
  value: string;
}

export interface QueryResponse {
  question: string;
  answer: string;
  sections: AnswerSection[];
  citations: Citation[];
  related_documents: DocRef[];
  entities: ExtractedEntity[];
  confidence: ConfidenceReport;
  followups: string[];
  latency_ms: number;
}

export interface RecurringCluster {
  id: string;
  title: string;
  aircraft: string;
  ata: string;
  count_90d: number;
  aircraft_count: number;
  trend: "rising" | "falling" | "flat" | "stable";
  last_occurred: string;
  severity: "low" | "medium" | "high";
  notes?: string | null;
}

export interface AtaHotspot {
  ata: string;
  label: string;
  count_90d: number;
  delta_pct: number;
}

export interface FleetWidget {
  id: string;
  label: string;
  value: number;
  unit?: string | null;
  trend: "rising" | "falling" | "flat" | "stable";
  detail?: string | null;
}

export interface InsightsResponse {
  recurring_clusters: RecurringCluster[];
  ata_hotspots: AtaHotspot[];
  fleet_widgets: FleetWidget[];
}

export interface SystemComponent {
  id: string;
  label: string;
  status: "healthy" | "degraded" | "down";
}

export interface ProcessingLogEntry {
  ts: string;
  stage: string;
  doc: string;
  status: string;
  detail?: string | null;
}

export interface SystemStatusResponse {
  components: SystemComponent[];
  logs: ProcessingLogEntry[];
  version: string;
  demo_mode: boolean;
  ai_provider: string;
}

export interface RecentQuery {
  id: string;
  question: string;
  created_at?: string | null;
  confidence: ConfidenceLabel;
}
