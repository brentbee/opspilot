import { z } from "zod";

export const uuid = z.string().uuid();

export function badRequest(message: string, issues?: unknown) {
  return Response.json({ error: message, issues }, { status: 400 });
}

export function notFound(what = "Not found") {
  return Response.json({ error: what }, { status: 404 });
}

/** Parses a JSON body against a schema; returns data or a 400 Response. */
export async function parseBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<{ data: z.infer<S> } | { error: Response }> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return { error: badRequest("Body must be JSON") };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return { error: badRequest("Invalid body", z.flattenError(parsed.error)) };
  return { data: parsed.data };
}

export async function idParam(params: Promise<{ id: string }>): Promise<string | null> {
  const { id } = await params;
  return uuid.safeParse(id).success ? id : null;
}
