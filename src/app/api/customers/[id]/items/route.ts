import { idParam, notFound } from "@/lib/http";
import { getCustomer, listCustomerItems } from "@/lib/repo";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const id = await idParam(params);
  if (!id || !(await getCustomer(id))) return notFound("Customer not found");
  return Response.json(await listCustomerItems(id));
}
