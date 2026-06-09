// Structured AI Insights — mirrors the legacy dashboard's schema so the report
// renders identically. The JSON is produced by DeepSeek in json_object mode and
// normalised server-side before reaching the client.

export type AlertSeverity = "low" | "medium" | "high";

export interface PulseHighlight {
  label: string;
  value: string;
}
export interface InsightsPulse {
  summary: string;
  highlights: PulseHighlight[];
}
export interface StrategicAlert {
  severity: AlertSeverity;
  message: string;
  evidence_count: number;
}
export interface ObjectionInsight {
  label: string;
  count: number;
  percent: number;
  example_call_ids: string[];
  counter_argument: string;
}
export interface TrendKeyword {
  keyword: string;
  count: number;
  note: string;
}
export interface InsightsTrends {
  emerging_keywords: TrendKeyword[];
  weak_signals: string[];
}
export interface HangupTopic {
  topic: string;
  count: number;
  example_call_ids: string[];
}
export interface WinningPattern {
  phrase_or_theme: string;
  frequency_in_won: number;
  frequency_in_lost: number;
}
export interface ScriptAudit {
  common_hangup_topics: HangupTopic[];
  converted_call_patterns: WinningPattern[];
}
export interface HotLead {
  call_id: string;
  reason: string;
}
export interface SentimentClimate {
  average_score: number;
  distribution: { positive: number; neutral: number; negative: number };
  hot_leads: HotLead[];
}
export interface OptimizationHypothesis {
  observation: string;
  test_to_run: string;
}

export interface InsightsResult {
  pulse: InsightsPulse;
  strategic_alerts: StrategicAlert[];
  objections: ObjectionInsight[];
  trends: InsightsTrends;
  script_audit: ScriptAudit;
  sentiment: SentimentClimate;
  optimization_hypotheses: OptimizationHypothesis[];
  meta: {
    generated_at: string;
    calls_analysed: number;
    calls_with_summary: number;
    period_label: string;
    model: string;
    cached: boolean;
    elapsed_ms: number;
  };
}

// One call as fed to the LLM (PII-light: name is NOT sent, only call_id).
export interface InsightsCallInput {
  call_id: string;
  summary: string | null;
  // Raw CRM qualification (metadata.qualification), kept for transparency only.
  qualification: string | null;
  // Dashboard-effective qualification (bucketForCall mapped to the FR label).
  // The LLM must count from THIS field.
  qualification_effective: string;
  sentiment: string | null;
  duration_seconds: number;
  hour_of_day: number;
  day_of_week: number;
  disconnection_reason: string | null;
  attempt_number: number;
  answered: boolean;
}

// Light per-call record the client uses to resolve call_id → person and to open
// the call detail when a hot-lead / example badge is clicked.
export interface InsightsCallIndexEntry {
  id: string;
  name: string | null;
  phone: string | null;
  qualification: string; // our QualBucket key
  direction: string | null;
  duration_secs: number | null;
  answered: boolean;
  started_at: string | null;
}

export interface InsightsResponse {
  insights: InsightsResult;
  calls_index: Record<string, InsightsCallIndexEntry>;
}
