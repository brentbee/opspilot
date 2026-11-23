"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { BUSINESS_FIELDS, type Business } from "@/lib/business";
import { Button, Field, inputClass } from "@/components/ui";

export default function BusinessPage() {
  const [saved, setSaved] = useState<Business | null>(null);
  const [form, setForm] = useState<Business | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api<Business>("/api/business").then(
      (b) => {
        setSaved(b);
        setForm(b);
      },
      (e: Error) => setNote({ ok: false, text: e.message }),
    );
  }, []);

  async function save() {
    if (!form) return;
    setBusy(true);
    setNote(null);
    try {
      const b = await api<Business>("/api/business", { method: "PUT", body: JSON.stringify(form) });
      setSaved(b);
      setForm(b);
      setNote({ ok: true, text: "Saved. The assistant will use these details from the next email it processes." });
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const dirty = form && saved && JSON.stringify(form) !== JSON.stringify(saved);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-6">
      <h1 className="text-lg font-semibold">Business details</h1>
      <p className="mb-5 text-sm text-slate-500">The assistant uses these details when it answers customers.</p>

      {note && (
        <p className={`mb-4 rounded px-3 py-2 text-sm ${note.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
          {note.text}
        </p>
      )}

      {!form ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <form
          className="space-y-4 rounded-lg border bg-white p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {BUSINESS_FIELDS.map((f) => (
            <Field key={f.key} label={f.label}>
              {f.long ? (
                <textarea
                  className={inputClass + " min-h-[80px]"}
                  value={form[f.key]}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                />
              ) : (
                <input
                  className={inputClass}
                  required={f.key === "name"}
                  value={form[f.key]}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                />
              )}
              <span className="mt-1 block text-xs text-slate-500">{f.hint}</span>
            </Field>
          ))}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" disabled={!dirty || busy} onClick={() => setForm(saved)}>
              Undo changes
            </Button>
            <Button type="submit" variant="primary" disabled={!dirty || busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      )}
    </main>
  );
}
