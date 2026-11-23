"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Item, RunSummary, Step } from "@/lib/types";
import type { LiveRun } from "./Board";
import { Timeline } from "./Timeline";
import { Button, CategoryBadge, Confidence, Field, PriorityTag, inputClass } from "./ui";

export function ItemDrawer({
  item,
  live,
  onClose,
  onRun,
  onChange,
  onDelete,
}: {
  item: Item;
  live?: LiveRun;
  onClose: () => void;
  onRun: () => void;
  onChange: (item: Item) => void;
  onDelete: () => void;
}) {
  const [savedSteps, setSavedSteps] = useState<Step[] | null>(null);
  const [run, setRun] = useState<RunSummary | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ subject: item.subject, body: item.body });
  const [draft, setDraft] = useState(item.draft_reply ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = live?.running ?? item.status === "processing";

  // Load the saved timeline whenever the item changes outside a live run.
  useEffect(() => {
    if (live?.running) return;
    let cancelled = false;
    api<{ item: Item; steps: Step[]; run: RunSummary | null }>(`/api/items/${item.id}`)
      .then((r) => {
        if (cancelled) return;
        setSavedSteps(r.steps);
        setRun(r.run);
      })
      .catch(() => !cancelled && setSavedSteps([]));
    return () => {
      cancelled = true;
    };
  }, [item.id, item.updated_at, live?.running]);

  // Keep the editable draft in sync once the agent has written one.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!running) setDraft(item.draft_reply ?? "");
  }, [item.draft_reply, running]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function patch(body: Partial<Item>) {
    setBusy(true);
    setError(null);
    try {
      onChange(await api<Item>(`/api/items/${item.id}`, { method: "PATCH", body: JSON.stringify(body) }));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this item and its agent history?")) return;
    setBusy(true);
    try {
      await api(`/api/items/${item.id}`, { method: "DELETE" });
      onDelete();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const steps = live && (live.running || live.steps.length) ? live.steps : (savedSteps ?? []);
  const shownDraft = running ? (live?.draft ?? "") : draft;
  const ex = item.extracted;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        aria-label="Item details"
      >
        <header className="sticky top-0 z-10 flex items-start gap-3 border-b bg-white px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-slate-900">{item.subject}</h2>
            <p className="text-sm text-slate-500">
              {item.from_name ?? "Unknown"} {item.from_email && <>&lt;{item.from_email}&gt;</>}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <CategoryBadge category={item.category} />
              <PriorityTag priority={item.priority} />
              <Confidence value={item.confidence} />
              {item.customer_name && <span className="text-xs text-slate-600">Customer: {item.customer_name}</span>}
            </div>
          </div>
          <Button variant="primary" onClick={onRun} disabled={running || item.status === "done"}>
            {running ? "Running…" : item.processed_at ? "Re-run agent" : "Run agent"}
          </Button>
          <Button variant="ghost" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </header>

        <div className="space-y-5 px-5 py-4">
          {error && <p className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
          {live?.error && <p className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-800">Agent error: {live.error}</p>}

          {item.route_reason && !running && (
            <p
              className={
                item.status === "needs_review"
                  ? "rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                  : "rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
              }
            >
              {item.route_reason}
            </p>
          )}

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Agent steps</h3>
            {run && !running && run.model !== "seed" && (
              <p className="mb-2 text-xs text-slate-500">
                Last run: {run.trigger === "scheduled" ? "⏱ scheduled job" : "manual"} · {run.model} ·{" "}
                {(run.input_tokens + run.output_tokens).toLocaleString()} tokens · {run.status}
              </p>
            )}
            <Timeline steps={steps} running={running} />
          </section>

          {(shownDraft || item.processed_at) && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-800">
                Draft reply {running && <span className="font-normal text-indigo-600">(writing…)</span>}
              </h3>
              <textarea
                className={inputClass + " min-h-[180px] font-mono text-[13px]"}
                value={shownDraft}
                readOnly={running}
                onChange={(e) => setDraft(e.target.value)}
              />
              {!running && (
                <div className="mt-2 flex gap-2">
                  <Button disabled={busy || draft === (item.draft_reply ?? "")} onClick={() => patch({ draft_reply: draft })}>
                    Save edits
                  </Button>
                  <Button
                    variant="primary"
                    disabled={busy || !draft || item.status === "done"}
                    onClick={() => patch({ draft_reply: draft, status: "done" })}
                  >
                    Approve &amp; mark sent
                  </Button>
                </div>
              )}
            </section>
          )}

          {ex && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-800">Extracted fields</h3>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
                {Object.entries(ex).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-slate-500">{k.replace(/_/g, " ")}</dt>
                    <dd className="text-slate-900">{Array.isArray(v) ? v.join(", ") : String(v)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">Original item</h3>
              {!editing && !running && (
                <Button variant="ghost" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
            </div>
            {editing ? (
              <div className="space-y-3">
                <Field label="Subject">
                  <input className={inputClass} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
                </Field>
                <Field label="Body">
                  <textarea className={inputClass + " min-h-[160px]"} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
                </Field>
                <div className="flex gap-2">
                  <Button variant="primary" disabled={busy} onClick={async () => (await patch(form)) && setEditing(false)}>
                    Save
                  </Button>
                  <Button onClick={() => setEditing(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <pre className="whitespace-pre-wrap rounded bg-slate-50 p-3 font-sans text-sm text-slate-800">{item.body}</pre>
            )}
          </section>

          <footer className="flex justify-end border-t pt-4">
            <Button variant="danger" disabled={busy || running} onClick={remove}>
              Delete item
            </Button>
          </footer>
        </div>
      </aside>
    </div>
  );
}
