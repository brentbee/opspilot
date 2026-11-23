import Anthropic from "@anthropic-ai/sdk";

export interface Usage {
  input: number;
  output: number;
}

export interface TurnRequest {
  system: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
}

/** The two model calls the agent makes. Abstracted so tests can script a fake. */
export interface AgentLLM {
  model: string;
  /** One agent turn: the model either calls tools or finishes. */
  turn(req: TurnRequest): Promise<Anthropic.Message>;
  /** Free-text generation, streamed token by token. */
  streamText(
    req: { system: string; prompt: string; maxTokens: number },
    onText: (delta: string) => void,
  ): Promise<{ text: string; usage: Usage }>;
}

export const DEFAULT_MODEL = "claude-sonnet-5-5";

export function anthropicLLM(): AgentLLM {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set (see .env.example)");
  // Short timeouts and no SDK retries keep a run well inside the function's time limit;
  // a failed run goes to a person rather than retrying for minutes.
  const client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 0 });
  const model = process.env.AGENT_MODEL || DEFAULT_MODEL;
  const writerModel = process.env.WRITER_MODEL || model;

  return {
    model,
    async turn({ system, messages, tools }) {
      return client.messages.create({
        model,
        max_tokens: 2048,
        system,
        messages,
        tools,
        // Routine back-office work: low effort keeps each step fast and cheap.
        output_config: { effort: "low" },
      });
    },
    async streamText({ system, prompt, maxTokens }, onText) {
      const stream = client.messages.stream(
        {
        model: writerModel,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: prompt }],
        output_config: { effort: "low" },
        },
        { timeout: 25_000 },
      );
      stream.on("text", onText);
      const final = await stream.finalMessage();
      const text = final.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      return { text, usage: { input: final.usage.input_tokens, output: final.usage.output_tokens } };
    },
  };
}
