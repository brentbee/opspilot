import { describe, expect, it } from "vitest";
import { createSSEParser, encodeEvent } from "@/lib/sse";
import type { AgentEvent } from "@/lib/types";

const dec = new TextDecoder();

describe("SSE encode/parse", () => {
  it("round-trips events", () => {
    const events: AgentEvent[] = [
      { type: "token", text: "Hello" },
      { type: "token", text: " world\n\nwith blank lines" },
      { type: "done", status: "ready", ms: 1200 },
    ];
    const wire = events.map((e) => dec.decode(encodeEvent(e))).join("");
    expect(createSSEParser()(wire)).toEqual(events);
  });

  it("buffers events split across chunks", () => {
    const wire = dec.decode(encodeEvent({ type: "token", text: "split me" }));
    const parse = createSSEParser();
    expect(parse(wire.slice(0, 10))).toEqual([]);
    expect(parse(wire.slice(10))).toEqual([{ type: "token", text: "split me" }]);
  });

  it("skips malformed frames", () => {
    expect(createSSEParser()("data: {not json\n\n")).toEqual([]);
  });
});
