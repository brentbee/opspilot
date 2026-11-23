"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { Item } from "@/lib/types";
import { Button, Field, inputClass } from "./ui";

export function NewItemDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (item: Item, runNow: boolean) => void;
}) {
  const [form, setForm] = useState({ from_name: "", from_email: "", subject: "", body: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(runNow: boolean) {
    setBusy(true);
    setError(null);
    try {
      const item = await api<Item>("/api/items", {
        method: "POST",
        body: JSON.stringify({ ...form, from_name: form.from_name || null, from_email: form.from_email || null }),
      });
      onCreated(item, runNow);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <form
        className="w-full max-w-lg space-y-3 rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void submit(true);
        }}
      >
        <h2 className="text-base font-semibold">New inbox item</h2>
        <p className="text-sm text-slate-500">Paste an email, enquiry or invoice note. Use made-up details only.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From name">
            <input className={inputClass} value={form.from_name} onChange={(e) => setForm({ ...form, from_name: e.target.value })} />
          </Field>
          <Field label="From email">
            <input className={inputClass} type="email" value={form.from_email} onChange={(e) => setForm({ ...form, from_email: e.target.value })} />
          </Field>
        </div>
        <Field label="Subject">
          <input className={inputClass} required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
        </Field>
        <Field label="Body">
          <textarea className={inputClass + " min-h-[160px]"} required value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        </Field>
        {error && <p className="text-sm text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={busy || !form.subject || !form.body} onClick={() => submit(false)}>
            Add to New
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !form.subject || !form.body}>
            Add &amp; run agent
          </Button>
        </div>
      </form>
    </div>
  );
}
