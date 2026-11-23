import { sql } from "@/lib/db";
import { resetDemoData } from "@/lib/seed";
import { resetBlocked } from "@/lib/limits";

export const dynamic = "force-dynamic";

/**
 * Restores the synthetic demo data set. The demo is public and has no auth,
 * so anyone can reset it; it touches only demo data and costs no API credits.
 */
export async function POST() {
  const blocked = await resetBlocked();
  if (blocked) return Response.json({ error: blocked }, { status: 429 });
  return Response.json(await resetDemoData(sql()));
}
