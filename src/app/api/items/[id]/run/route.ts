import { runAgent } from "@/agent/runAgent";
import { anthropicLLM } from "@/agent/llm";
import * as repo from "@/lib/repo";
import { idParam, notFound } from "@/lib/http";
import { runBudgetLeft } from "@/lib/limits";
import { encodeEvent } from "@/lib/sse";
import type { AgentEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** Runs the agent on one item and streams every step back as Server-Sent Events. */
export async function POST(_req: Request, { params }: Ctx) {
  const id = await idParam(params);
  const item = id && (await repo.getItem(id));
  if (!item) return notFound("Item not found");
  if (item.status === "processing")
    return Response.json({ error: "Already processing" }, { status: 409 });
  if ((await runBudgetLeft()) <= 0)
    return Response.json({ error: "Hourly demo limit reached, try again later" }, { status: 429 });

  let llm;
  try {
    llm = anthropicLLM();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }

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
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
