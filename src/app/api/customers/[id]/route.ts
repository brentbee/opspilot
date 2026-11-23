import { deleteCustomer, getCustomer, updateCustomer } from "@/lib/repo";
import { idParam, notFound, parseBody } from "@/lib/http";
import { customerPatchSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const id = await idParam(params);
  const c = id && (await getCustomer(id));
  return c ? Response.json(c) : notFound("Customer not found");
}

export async function PATCH(req: Request, { params }: Ctx) {
  const id = await idParam(params);
  if (!id || !(await getCustomer(id))) return notFound("Customer not found");
  const parsed = await parseBody(req, customerPatchSchema);
  if ("error" in parsed) return parsed.error;
  try {
    return Response.json(await updateCustomer(id, parsed.data));
  } catch (err) {
    if ((err as { code?: string }).code === "23505")
      return Response.json({ error: "A customer with that email already exists" }, { status: 409 });
    throw err;
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const id = await idParam(params);
  if (!id || !(await deleteCustomer(id))) return notFound("Customer not found");
  return new Response(null, { status: 204 });
}
