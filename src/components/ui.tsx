import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Category, Priority } from "@/lib/types";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

const CATEGORY_STYLE: Record<Category, string> = {
  enquiry: "bg-sky-100 text-sky-800",
  quote_request: "bg-violet-100 text-violet-800",
  invoice: "bg-emerald-100 text-emerald-800",
  complaint: "bg-rose-100 text-rose-800",
  other: "bg-slate-200 text-slate-700",
};

export function CategoryBadge({ category }: { category: Category | null }) {
  if (!category) return null;
  return (
    <span className={cx("rounded px-1.5 py-0.5 text-[11px] font-medium", CATEGORY_STYLE[category])}>
      {category.replace("_", " ")}
    </span>
  );
}

const PRIORITY_STYLE: Record<Priority, string> = {
  low: "text-slate-500",
  normal: "text-slate-600",
  high: "text-amber-700",
  urgent: "text-rose-700 font-semibold",
};

export function PriorityTag({ priority }: { priority: Priority | null }) {
  if (!priority) return null;
  return <span className={cx("text-[11px] uppercase tracking-wide", PRIORITY_STYLE[priority])}>{priority}</span>;
}

export function Confidence({ value }: { value: number | null }) {
  if (value == null) return null;
  const pct = Math.round(value * 100);
  return (
    <span
      title="How sure the assistant is about the type of request"
      className={cx("text-[11px] tabular-nums", value < 0.75 ? "text-amber-700" : "text-slate-500")}
    >
      {pct}%
    </span>
  );
}

export function Button({
  children,
  variant = "secondary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const styles = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-300",
    secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:text-slate-400",
    danger: "border border-rose-300 bg-white text-rose-700 hover:bg-rose-50",
    ghost: "text-slate-600 hover:bg-slate-100",
  }[variant];
  return (
    <button
      {...props}
      className={cx("rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed", styles, className)}
    >
      {children}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
