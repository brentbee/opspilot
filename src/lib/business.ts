import { z } from "zod";

/**
 * The business profile staff edit on the Business details page. The assistant
 * reads it on every run, so replies use current hours, service areas and so on.
 */
export const businessSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(600),
  hours: z.string().trim().max(400),
  holidays: z.string().trim().max(400),
  emergency: z.string().trim().max(400),
  service_area: z.string().trim().max(400),
  brands: z.string().trim().max(600),
  policies: z.string().trim().max(2000),
  other: z.string().trim().max(2000),
});
export type Business = z.infer<typeof businessSchema>;

export const BUSINESS_FIELDS: { key: keyof Business; label: string; hint: string; long?: boolean }[] = [
  { key: "name", label: "Business name", hint: "Used to sign replies" },
  { key: "description", label: "What we do", hint: "One or two sentences", long: true },
  { key: "hours", label: "Opening hours", hint: "e.g. Mon–Fri 7am–5pm" },
  { key: "holidays", label: "Holiday closures", hint: "e.g. Christmas dates" },
  { key: "emergency", label: "Emergency contact", hint: "After-hours or breakdown line" },
  { key: "service_area", label: "Service area", hint: "Suburbs or regions you cover" },
  { key: "brands", label: "Brands and services", hint: "What you do and don't service", long: true },
  { key: "policies", label: "Policies", hint: "Quotes, hire, warranty, bookings: one per line", long: true },
  { key: "other", label: "Anything else the assistant should know", hint: "Optional", long: true },
];

export const DEFAULT_BUSINESS: Business = {
  name: "Harbour & Co",
  description:
    "Sells, hires, installs and services commercial kitchen equipment for cafés, restaurants, caterers, schools and aged care.",
  hours: "Monday to Friday 7am to 5pm, Saturday 8am to 12pm (AEST). Closed Sundays and public holidays.",
  holidays: "Office closed 25 December to 1 January. The emergency breakdown line runs throughout.",
  emergency: "24/7 breakdown line for refrigeration, cooking and dishwashing breakdowns: 1300 000 427.",
  service_area: "Brisbane, Logan, Ipswich, Moreton Bay, Gold Coast and Sunshine Coast.",
  brands:
    "We service Rational, Unox, Electrolux, Hobart, Skope, Williams, Waldorf, Moffat and Vitamix. We do not service coffee machines; we suggest the customer contact their coffee machine supplier.",
  policies: [
    "Quotes are emailed within 2 business days.",
    "Equipment hire needs 48 hours' notice and is subject to availability.",
    "Warranty claims: a technician inspects first; parts and labour are covered if the fault is under warranty.",
    "Bookings and reschedules: the service team confirms a time by phone or email within 1 business day.",
  ].join("\n"),
  other: "",
};

/** Renders the profile as the fact sheet given to the model. */
export function businessFacts(b: Business): string {
  const lines = BUSINESS_FIELDS.filter((f) => f.key !== "name" && b[f.key].trim()).map((f) => {
    const value = b[f.key].trim();
    return value.includes("\n")
      ? `- ${f.label}:\n${value
          .split("\n")
          .filter(Boolean)
          .map((l) => `  - ${l.trim()}`)
          .join("\n")}`
      : `- ${f.label}: ${value}`;
  });
  return `${b.name}: facts you may use in replies\n${lines.join("\n")}`;
}
