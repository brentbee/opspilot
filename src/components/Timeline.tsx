import type { Step } from "@/lib/types";
import { cx } from "./ui";

const LABEL: Record<string, string> = {
  extract_fields: "Extract fields",
  classify: "Classify",
  lookup_customer: "Look up customer",
  draft_reply: "Draft reply",
  move_card: "Request column",
  policy: "Review policy",
};

function summary(step: Step): string {
  const p = step.payload as Record<string, unknown>;
  switch (step.kind) {
    case "thought":
      return String(p.text ?? "");
    case "tool_call": {
      const input = (p.input ?? {}) as Record<string, unknown>;
      if (step.tool === "classify") return `${input.category} · ${input.priority} · ${input.confidence}: ${input.rationale ?? ""}`;
      if (step.tool === "lookup_customer") return Object.values(input).filter(Boolean).join(" / ");
      if (step.tool === "move_card") return `${input.status}: ${input.reason ?? ""}`;
      if (step.tool === "draft_reply") return `${input.tone}; ${(input.key_points as string[] | undefined)?.length ?? 0} key points`;
      if (step.tool === "extract_fields") return String(input.summary ?? "");
      return JSON.stringify(input);
    }
    case "tool_result": {
      if (p.is_error) return `Error: ${String(p.error ?? "")}`;
      if (step.tool === "lookup_customer") {
        const c = p.customer as { name?: string; company?: string; tier?: string } | undefined;
        return p.found ? `Found ${c?.name} (${c?.company}), ${c?.tier} tier` : "No matching customer";
      }
      return "ok";
    }
    case "draft":
      return `${String(p.text ?? "").length} characters written`;
    case "route": {
      const reasons = (p.reasons as string[]) ?? [];
      return `${p.final === "ready" ? "Ready to send" : "Needs review"}${p.overridden ? " (policy overrode the agent)" : ""}${
        reasons.length ? `: ${reasons.join("; ")}` : ""
      }`;
    }
    case "human_override":
      return `A person moved this card from ${p.from} to ${p.to}`;
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
  if (!visible.length && !running) return <p className="text-sm text-slate-500">Not processed yet. Run the agent to see each step live.</p>;
  return (
    <ol className="relative space-y-2 border-l border-slate-200 pl-4">
      {visible.map((s, i) => (
        <li key={s.id ?? i} className="relative">
          <span className={cx("absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white", DOT[s.kind])} />
          <p className="text-xs font-medium text-slate-500">
            {s.kind === "thought"
              ? "Agent"
              : s.kind === "human_override"
                ? "Human override"
                : s.kind === "tool_result"
                  ? `${LABEL[s.tool ?? ""] ?? s.tool} → result`
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
