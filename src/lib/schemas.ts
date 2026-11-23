import { z } from "zod";

const email = z.string().trim().toLowerCase().email().max(200);

/** Fields a user may edit. No defaults, so omitted fields are left alone on PATCH. */
export const customerPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    company: z.string().trim().max(120).nullable(),
    email: email.nullable(),
    tier: z.enum(["standard", "priority"]),
    notes: z.string().trim().max(1000).nullable(),
  })
  .partial();

export const customerCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  company: z.string().trim().max(120).nullable().default(null),
  email: email.nullable().default(null),
  tier: z.enum(["standard", "priority"]).default("standard"),
  notes: z.string().trim().max(1000).nullable().default(null),
});
