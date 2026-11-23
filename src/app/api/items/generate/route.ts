import { anthropicJson, generateEmails } from "@/agent/generate";
import { sql } from "@/lib/db";
import { createItem, listCustomers } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH = 10;
/** Keeps a public demo (and its API key) from being flooded. */
const MAX_CREATED_PER_HOUR = 100;
const MAX_NEW_COLUMN = 60;

/** Uses Claude to write a batch of synthetic emails and adds them to the New column. */
export async function POST() {
  const [counts] = await sql()<{ recent: number; waiting: number }[]>`
    select
      (select count(*)::int from items where created_at > now() - interval '1 hour') as recent,
      (select count(*)::int from items where status = 'new') as waiting`;
  if (counts.waiting >= MAX_NEW_COLUMN)
    return Response.json({ error: `New already has ${counts.waiting} items; process some first` }, { status: 409 });
  if (counts.recent + BATCH > MAX_CREATED_PER_HOUR)
    return Response.json({ error: "Hourly demo limit reached, try again later" }, { status: 429 });

  let complete;
  try {
    complete = anthropicJson();
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }

  try {
    const emails = await generateEmails(await listCustomers(), BATCH, complete);
    const items = [];
    for (const e of emails)
      items.push(
        await createItem({
          subject: e.subject,
          body: e.body,
          from_name: e.from_name,
          from_email: e.from_email || null,
        }),
      );
    return Response.json({ created: items.length, items }, { status: 201 });
  } catch (err) {
    return Response.json({ error: `Generation failed: ${(err as Error).message}` }, { status: 502 });
  }
}
