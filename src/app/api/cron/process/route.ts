import { processNewItems } from "@/lib/batch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled workload, called by Vercel Cron (see vercel.json). Vercel sends
 * `Authorization: Bearer $CRON_SECRET`; anything else is rejected.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  return Response.json(await processNewItems(3, "scheduled"));
}
