import { businessSchema } from "@/lib/business";
import { parseBody } from "@/lib/http";
import { getBusiness, saveBusiness } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getBusiness());
}

export async function PUT(req: Request) {
  const parsed = await parseBody(req, businessSchema);
  if ("error" in parsed) return parsed.error;
  return Response.json(await saveBusiness(parsed.data));
}
