import { z } from "zod";
import { createItem, listItems } from "@/lib/repo";
import { parseBody } from "@/lib/http";
import { creationBlocked } from "@/lib/limits";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await listItems());
}

const createSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(8000),
  from_name: z.string().trim().max(120).nullish(),
  from_email: z.string().trim().email().max(200).nullish().or(z.literal("").transform(() => null)),
});

export async function POST(req: Request) {
  const parsed = await parseBody(req, createSchema);
  if ("error" in parsed) return parsed.error;
  const blocked = await creationBlocked(1);
  if (blocked) return Response.json({ error: blocked }, { status: 429 });
  return Response.json(await createItem(parsed.data), { status: 201 });
}
