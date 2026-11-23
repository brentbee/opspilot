import { z } from "zod";
import { createItem, listItems } from "@/lib/repo";
import { parseBody } from "@/lib/http";

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
  return Response.json(await createItem(parsed.data), { status: 201 });
}
