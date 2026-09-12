export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: LLMToolCall[];
}

export interface LLMToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface LLMTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LLMResponse {
  content: string | null;
  toolCalls: LLMToolCall[];
  finishReason?: string;
}

export interface LLMRequest {
  model: string;
  messages: LLMMessage[];
  resoning?: {
    effort: "none" | "medium" | "high";
  };
  tools?: LLMTool[];
}

export interface LLMClientConfig {
  baseUrl: string;
  apiKey: string;
}

export class LLMClient {
  constructor(private readonly config: LLMClientConfig) {}

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        tools: request.tools,
      }),
    });

    if (!response.ok) {
      const body = await response.text();

      throw new Error(`LLM request failed (${response.status}): ${body}`);
    }

    const data = await response.json();

    // Some providers (OpenRouter in particular) return HTTP 200 with an
    // `error` field in the body instead of a non-2xx status — e.g. no
    // credits, a moderation flag, or the model being temporarily
    // unavailable. Surface that instead of the misleading "no choices".
    if (data.error) {
      const message =
        typeof data.error === "string" ? data.error : JSON.stringify(data.error);
      throw new Error(`LLM request failed: ${message}`);
    }

    const choice = data.choices?.[0];

    if (!choice) {
      throw new Error(
        `LLM returned no choices. Raw response: ${JSON.stringify(data).slice(0, 500)}`,
      );
    }

    const message = choice.message;

    return {
      content: message?.content ?? null,
      toolCalls: message?.tool_calls ?? [],
      finishReason: choice.finish_reason,
    };
  }
}
