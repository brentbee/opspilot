import { anthropicJson, generateEmails } from "@/agent/generate";
import { createItem, listCustomers } from "@/lib/repo";
import { creationBlocked } from "@/lib/limits";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH = 10;

/** Uses Claude to write a batch of synthetic emails and adds them to the New column. */
export async function POST() {
  const blocked = await creationBlocked(BATCH);
  if (blocked) return Response.json({ error: blocked }, { status: 429 });

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
