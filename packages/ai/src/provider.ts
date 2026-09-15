export type AIMessageRole = 'system' | 'user' | 'assistant';

export interface AIMessage {
  role: AIMessageRole;
  content: string;
}

export interface AIRequest {
  model: string;
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
  structuredOutput?: { name: string; schema: Record<string, unknown> };
  signal?: AbortSignal;
  /** Local correlation only; providers must not send these identifiers to the model. */
  context?: { projectId: string; goal: string };
}

export interface AIUsageRecord {
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  timestamp: string;
  durationMs: number;
}

export interface AIResponse {
  content: string;
  model: string;
  structured?: unknown;
  usageRecord?: AIUsageRecord;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export interface AIProvider {
  generate(request: AIRequest): Promise<AIResponse>;
}
