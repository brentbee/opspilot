import type { AgentEvent } from "./types";

const encoder = new TextEncoder();

export function encodeEvent(e: AgentEvent): Uint8Array {
  return encoder.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
}

/**
 * Incremental SSE parser for fetch() streams (EventSource can't POST).
 * Feed it decoded text chunks; it returns the complete events seen so far and
 * keeps any partial event buffered for the next chunk.
 */
export function createSSEParser() {
  let buffer = "";
  return function push(chunk: string): AgentEvent[] {
    buffer += chunk.replace(/\r\n/g, "\n");
    const events: AgentEvent[] = [];
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const data = raw
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      try {
        events.push(JSON.parse(data) as AgentEvent);
      } catch {
        // Ignore malformed frames rather than killing the stream.
      }
    }
    return events;
  };
}
