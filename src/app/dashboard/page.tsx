"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import type { Stats } from "@/lib/stats";

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Stats>("/api/stats").then(setStats, (e: Error) => setError(e.message));
  }, []);

  if (error) return <main className="px-6 py-6 text-sm text-rose-700">{error}</main>;
  if (!stats) return <main className="px-6 py-6 text-sm text-slate-500">Loading…</main>;

  const t = stats.totals;
  const perDay = stats.per_day.map((d) => ({ ...d, day: d.day.slice(5) }));

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-6 py-6">
      <div>
        <h1 className="text-lg font-semibold">Dashboard</h1>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Items processed" value={String(t.processed)} hint={`${t.items} total in inbox`} />
        <Kpi
          label="Ready without review"
          value={stats.auto_rate == null ? "–" : `${Math.round(stats.auto_rate * 100)}%`}
          hint="the rest were checked by staff"
        />
        <Kpi label="Avg handling time" value={t.avg_agent_ms == null ? "–" : `${(t.avg_agent_ms / 1000).toFixed(1)}s`} hint="per item" />
        <Kpi label="Cards moved by staff" value={String(t.human_overrides)} hint="changes to the assistant's choice" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">Items by category</h2>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={stats.by_category.filter((c) => c.category !== "unprocessed")}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="category" tick={{ fontSize: 12 }} tickFormatter={(v: string) => v.replace("_", " ")} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="rounded-lg border bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">Items per day (last 14 days)</h2>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={perDay}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Line type="linear" dataKey="created" stroke="#94a3b8" strokeWidth={2} dot={false} />
                <Line type="linear" dataKey="processed" stroke="#6366f1" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <section className="rounded-lg border bg-white p-4 text-sm">
        <h2 className="mb-1 font-semibold">⏱ Automatic morning run</h2>
        <p className="text-slate-600">
          Every day at 8am the assistant works through up to 3 new items by itself. Last automatic run:{" "}
          <span className="font-medium text-slate-900">
            {stats.scheduled.last_run_at
              ? new Date(stats.scheduled.last_run_at).toLocaleString("en-AU", { timeZone: "Australia/Brisbane" })
              : "not yet"}
          </span>
          . This week: {stats.scheduled.runs_7d} handled automatically, {stats.scheduled.manual_runs_7d} handled on request.
        </p>
      </section>

      <p className="text-xs text-slate-500">
        About {Math.round(stats.minutes_saved / 60)} hours of sorting saved (estimate, at 6 minutes per item)
      </p>
    </main>
  );
}
