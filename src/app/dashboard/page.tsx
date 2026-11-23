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
        <p className="text-sm text-slate-500">Live from the database. Historical rows are seeded demo data (see README).</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Items processed" value={String(t.processed)} hint={`${t.items} total in inbox`} />
        <Kpi
          label="Auto-routed to Ready"
          value={stats.auto_rate == null ? "–" : `${Math.round(stats.auto_rate * 100)}%`}
          hint="the rest went to a human"
        />
        <Kpi label="Avg agent time" value={t.avg_agent_ms == null ? "–" : `${(t.avg_agent_ms / 1000).toFixed(1)}s`} hint="per item, end to end" />
        <Kpi label="Human overrides" value={String(t.human_overrides)} hint="cards moved by a person" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">Items by category</h2>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={stats.by_category.filter((c) => c.category !== "unprocessed")}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="category" tick={{ fontSize: 12 }} />
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
        <h2 className="mb-1 font-semibold">⏱ Scheduled workload</h2>
        <p className="text-slate-600">
          A cron job (daily, 08:00 Brisbane) picks up to 3 items from New and runs the agent on them, with no human
          trigger. Last scheduled run:{" "}
          <span className="font-medium text-slate-900">
            {stats.scheduled.last_run_at
              ? new Date(stats.scheduled.last_run_at).toLocaleString("en-AU", { timeZone: "Australia/Brisbane" })
              : "not yet"}
          </span>
          . Last 7 days: {stats.scheduled.runs_7d} scheduled runs, {stats.scheduled.manual_runs_7d} manual runs.
        </p>
      </section>

      <p className="text-xs text-slate-500">
        Est. {Math.round(stats.minutes_saved / 60)} h of triage saved (assumes 6 min of manual handling per item) ·{" "}
        {t.tokens.toLocaleString()} tokens used
      </p>
    </main>
  );
}
