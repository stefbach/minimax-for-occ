export type LlmProvider = "openai" | "anthropic" | "minimax";

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
  tts_model: string | null;
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
