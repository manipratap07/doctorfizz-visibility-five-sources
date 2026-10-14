export type SiteProfile = {
  category: string;
  subCategory: string;
  primaryOffering: string;
  targetAudience: string;
  isLocalBusiness: boolean;
  location: string;
  language: string;
  confidence: number;
};
export type Brand = { name: string; aliases: string[]; domain: string };
export type Citation = { url: string; title?: string; domain: string };
export type BrowserEvidence = {
  captureMethod: "visible_dom";
  adapterVersion: string;
  pageUrl: string;
  capturedAt: string;
  answerHash: string;
  completion: string;
  searchObservation: "confirmed" | "not_confirmed";
};
export type RunPhase =
  | "queued"
  | "opening"
  | "submitting"
  | "waiting"
  | "collecting"
  | "analysing"
  | "completed"
  | "failed";
export type BrowserInput = {
  prompt: string;
  signal: AbortSignal;
  // Epoch ms when `signal` fires. The adapter stops polling a little earlier so
  // it can return a clean timeout instead of being torn down mid-call.
  deadlineAt?: number;
  onObservation?: (diagnostics: CaptureDiagnostics) => Promise<void>;
  onProgress?: (
    phase: RunPhase,
    message: string,
    pageUrl?: string,
  ) => Promise<void>;
};
export type BatchPrompt = {
  id: string;
  index: number;
  text: string;
  // Set when "we/our" references were resolved with the business context.
  originalText?: string;
  contextApplied?: boolean;
  bias: boolean;
};
// Where a capture stood when it ended; logged by the worker for failed runs.
export type CaptureDiagnostics = {
  phase: string;
  answerRoots: number;
  answerCharacters: number;
  completionSeen: boolean;
  generationSeen: boolean;
  generatingNow?: boolean;
  stablePolls?: number;
  generationControl?: string;
};
export type ProviderResult = {
  diagnostics?: CaptureDiagnostics;
  browserEvidence?: BrowserEvidence;
  status: "ok" | "timeout" | "blocked" | "rate_limited" | "error";
  answerText?: string;
  citations?: Citation[];
  modelReported?: string;
  webSearchUsed: boolean;
  latencyMs: number;
  errorReason?: string;
};
export type Entity = {
  name: string;
  position: number | null;
  snippet: string;
  sentiment: "positive" | "neutral" | "negative";
};
export type Analysis = {
  mentioned: boolean;
  ambiguous: boolean;
  position: number | null;
  totalEntities: number;
  cited: boolean;
  citationUrls: string[];
  sentiment: Entity["sentiment"];
  snippet: string;
  competitors: Entity[];
  score: number;
};
export type Run = {
  id: string;
  provider_id: string;
  prompt_id?: string;
  prompt_index?: number;
  prompt_text?: string;
  prompt_bias?: boolean;
  phase?: RunPhase;
  phase_message?: string;
  source_url?: string;
  phase_updated_at?: string;
  status: string;
  reason?: string;
  answer_text?: string;
  citations: Citation[];
  model_reported?: string;
  web_search_used: boolean;
  latency_ms?: number;
  browser_evidence?: BrowserEvidence;
  from_cache: boolean;
  cache_created_at?: string;
  created_at: string;
  completed_at?: string;
  analysis?: Analysis;
  repeat_index: number;
};
export type Check = {
  id: string;
  brand: Brand;
  prompt_text: string;
  prompts?: BatchPrompt[];
  prompt_kind?: string;
  prompt_bias?: boolean;
  status: string;
  created_at: string;
  runs: Run[];
  refunded: boolean;
};
