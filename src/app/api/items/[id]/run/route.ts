import { runAgent } from "@/agent/runAgent";
import { anthropicLLM, type AgentLLM } from "@/agent/llm";
import * as repo from "@/lib/repo";
import { idParam, notFound } from "@/lib/http";
import { runBudgetLeft } from "@/lib/limits";
import { encodeEvent } from "@/lib/sse";
import type { AgentEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

/** Runs the agent on one item and streams every step back as Server-Sent Events. */
export async function POST(_req: Request, { params }: Ctx) {
  const id = await idParam(params);
  const item = id && (await repo.getItem(id));
  if (!item) return notFound("Item not found");
  if (item.status === "done") return Response.json({ error: "This item is already done" }, { status: 409 });
  if ((await runBudgetLeft()) <= 0)
    return Response.json({ error: "Hourly demo limit reached, try again later" }, { status: 429 });

  let llm: AgentLLM;
  try {
    llm = anthropicLLM();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
  // Atomic claim: a double-click or second tab can't start a second run.
  if (!(await repo.claimItem(item.id)))
    return Response.json({ error: "This item is already being processed" }, { status: 409 });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (e: AgentEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encodeEvent(e));
        } catch {
          open = false; // client went away; the run still finishes and saves.
        }
      };
      try {
        await runAgent({ itemId: item.id, llm, store: repo, emit });
      } finally {
        if (open) controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
