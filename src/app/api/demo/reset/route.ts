import { sql } from "@/lib/db";
import { resetDemoData } from "@/lib/seed";

export const dynamic = "force-dynamic";

/**
 * Restores the synthetic demo data set. The demo is public and has no auth,
 * so anyone can reset it; it touches only demo data and costs no API credits.
 */
export async function POST() {
  return Response.json(await resetDemoData(sql()));
}
