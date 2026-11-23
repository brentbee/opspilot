import { createCustomer, listCustomers } from "@/lib/repo";
import { parseBody } from "@/lib/http";
import { customerCreateSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await listCustomers());
}

export async function POST(req: Request) {
  const parsed = await parseBody(req, customerCreateSchema);
  if ("error" in parsed) return parsed.error;
  try {
    return Response.json(await createCustomer(parsed.data), { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === "23505")
      return Response.json({ error: "A customer with that email already exists" }, { status: 409 });
    throw err;
  }
}
