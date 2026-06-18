export type LlmProvider = "deepseek" | "openai" | "anthropic" | "minimax";

export interface Agent {
  id: string;
  name: string;
  description: string | null;
  language: string;
  llm_provider: LlmProvider;
  llm_model: string;
  tts_voice_id: string | null;
  tts_emotion: string | null;
  tts_speed: number;
  tts_volume: number;
  tts_pitch: number;
  tts_model: string | null;
  // Advanced TTS knobs exposed per provider (Wati 16/06).
  //  Cartesia    : tts_language (force ISO code instead of auto-detect)
  //  ElevenLabs  : tts_stability, tts_similarity_boost, tts_style, tts_speaker_boost
  //  MiniMax     : tts_pitch (already), tts_emotion (already), tts_volume (already),
  //                tts_english_normalization
  tts_stability: number | null;
  tts_similarity_boost: number | null;
  tts_style: number | null;
  tts_speaker_boost: boolean | null;
  tts_language: string | null;
  tts_english_normalization: boolean | null;
  voice_style: string | null;
  system_prompt: string;
  greeting: string | null;
  rag_enabled: boolean;
  rag_top_k: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type AgentInput = Partial<Omit<Agent, "id" | "created_at" | "updated_at">> & {
  name: string;
};

export interface AgentN8nWorkflow {
  id: string;
  agent_id: string;
  workflow_id: string;
  workflow_name: string;
  webhook_path: string;
  description: string | null;
  payload_schema: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
}

export interface RagDocument {
  id: string;
  agent_id: string;
  source_name: string;
  chunk_index: number;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface N8nWorkflowSummary {
  id: string;
  name: string;
  active: boolean;
  tags: string[];
  webhook_paths: string[];
}

export type VoiceSource = "cloned" | "preset";

export interface Voice {
  id: string;
  voice_id: string;
  display_name: string;
  language: string;
  source: VoiceSource;
  description: string | null;
  sample_text: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
