import { z } from "zod";
import { deleteItem, getItem, insertStep, latestRun, listSteps, updateItem, type ItemPatch } from "@/lib/repo";
import { idParam, notFound, parseBody } from "@/lib/http";
import { CATEGORIES, PRIORITIES } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const id = await idParam(params);
  const item = id && (await getItem(id));
  if (!item) return notFound("Item not found");
  return Response.json({ item, steps: await listSteps(item.id), run: await latestRun(item.id) });
}

const patchSchema = z
  .object({
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(8000),
    from_name: z.string().trim().max(120).nullable(),
    from_email: z.string().trim().max(200).nullable(),
    // Humans may move cards anywhere except the transient "processing" state.
    status: z.enum(["new", "needs_review", "ready", "done"]),
    position: z.number().finite(),
    category: z.enum(CATEGORIES).nullable(),
    priority: z.enum(PRIORITIES).nullable(),
    draft_reply: z.string().max(8000).nullable(),
  })
  .partial();

export async function PATCH(req: Request, { params }: Ctx) {
  const id = await idParam(params);
  const before = id && (await getItem(id));
  if (!before) return notFound("Item not found");
  if (before.status === "processing") return Response.json({ error: "The agent is working on this item" }, { status: 409 });

  const parsed = await parseBody(req, patchSchema);
  if ("error" in parsed) return parsed.error;
  const patch: ItemPatch = parsed.data;
  // Sending a card back to New clears the old routing verdict; it is stale until the agent re-runs.
  if (patch.status === "new" && before.status !== "new") patch.route_reason = null;

  const item = await updateItem(before.id, patch);

  // A human moving a card the agent routed is the human-in-the-loop signal: log it.
  if (patch.status && patch.status !== before.status) {
    await insertStep({
      run_id: null,
      item_id: before.id,
      seq: 0,
      kind: "human_override",
      tool: null,
      payload: { from: before.status, to: patch.status, agent_routed: before.processed_at != null },
    });
  }
  return Response.json(item);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const id = await idParam(params);
  if (!id || !(await deleteItem(id))) return notFound("Item not found");
  return new Response(null, { status: 204 });
}
