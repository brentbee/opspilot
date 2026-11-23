import type { Step } from "@/lib/types";
import { cx } from "./ui";

const COLUMN: Record<string, string> = {
  new: "New",
  needs_review: "Needs review",
  ready: "Ready to send",
  done: "Done",
};

export const LABEL: Record<string, string> = {
  extract_fields: "Read the email",
  classify: "Work out the request type",
  lookup_customer: "Find the customer",
  draft_reply: "Write a reply",
  move_card: "Suggest where it goes",
  policy: "Final check",
};

function summary(step: Step): string {
  const p = step.payload as Record<string, unknown>;
  switch (step.kind) {
    case "thought":
      return String(p.text ?? "");
    case "tool_call": {
      const input = (p.input ?? {}) as Record<string, unknown>;
      if (step.tool === "classify")
        return `${String(input.category).replace("_", " ")}, ${input.priority} priority, ${Math.round(Number(input.confidence) * 100)}% sure. ${input.rationale ?? ""}`;
      if (step.tool === "lookup_customer") return `Searching for ${Object.values(input).filter(Boolean).join(" / ")}`;
      if (step.tool === "move_card") return `${COLUMN[String(input.status)] ?? input.status}: ${input.reason ?? ""}`;
      if (step.tool === "draft_reply") return `A ${input.tone} reply covering ${(input.key_points as string[] | undefined)?.length ?? 0} points`;
      if (step.tool === "extract_fields") return String(input.summary ?? "");
      return "";
    }
    case "tool_result": {
      if (p.is_error) return "Hit a problem with this step and tried again";
      if (step.tool === "lookup_customer") {
        const c = p.customer as { name?: string; company?: string; tier?: string } | undefined;
        return p.found ? `Found ${c?.name} (${c?.company}), ${c?.tier} customer` : "Not an existing customer";
      }
      return "Done";
    }
    case "draft":
      return "Reply written";
    case "route": {
      const reasons = (p.reasons as string[]) ?? [];
      return `${p.final === "ready" ? "Ready to send" : "Needs review"}${p.overridden ? " (the final check changed the assistant's suggestion)" : ""}${
        reasons.length ? `: ${reasons.join("; ")}` : ""
      }`;
    }
    case "human_override":
      return `Moved by staff from ${COLUMN[String(p.from)] ?? p.from} to ${COLUMN[String(p.to)] ?? p.to}`;
    case "error":
      return String(p.message ?? "");
  }
}

const DOT: Record<Step["kind"], string> = {
  thought: "bg-slate-400",
  tool_call: "bg-indigo-500",
  tool_result: "bg-indigo-300",
  draft: "bg-violet-500",
  route: "bg-emerald-500",
  human_override: "bg-amber-500",
  error: "bg-rose-500",
};

export function Timeline({ steps, running }: { steps: Step[]; running: boolean }) {
  // Tool results are folded into their call to keep the timeline readable.
  const visible = steps.filter((s) => s.kind !== "tool_result" || (s.payload as { is_error?: boolean }).is_error || s.tool === "lookup_customer");
  if (!visible.length && !running) return <p className="text-sm text-slate-500">Not processed yet. Press Process to watch the assistant work through it.</p>;
  return (
    <ol className="relative space-y-2 border-l border-slate-200 pl-4">
      {visible.map((s, i) => (
        <li key={s.id ?? i} className="relative">
          <span className={cx("absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white", DOT[s.kind])} />
          <p className="text-xs font-medium text-slate-500">
            {s.kind === "thought"
              ? "Assistant"
              : s.kind === "human_override"
                ? "Staff change"
                : s.kind === "tool_result"
                  ? `${LABEL[s.tool ?? ""] ?? s.tool}: result`
                  : s.kind === "error"
                    ? "Error"
                    : (LABEL[s.tool ?? ""] ?? s.tool)}
          </p>
          <p className="text-sm text-slate-800">{summary(s)}</p>
        </li>
      ))}
      {running && (
        <li className="relative">
          <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 animate-ping rounded-full bg-indigo-400" />
          <p className="text-sm text-indigo-700">Working…</p>
        </li>
      )}
    </ol>
  );
}
