"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Customer } from "@/lib/types";
import { Button, Field, inputClass } from "@/components/ui";

type Row = Customer & { item_count: number };
type Form = { name: string; company: string; email: string; tier: "standard" | "priority"; notes: string };
const EMPTY: Form = { name: "", company: "", email: "", tier: "standard", notes: "" };

export default function CustomersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [editing, setEditing] = useState<{ id: string | null; form: Form } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await api<Row[]>("/api/customers"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    const f = editing.form;
    const body = JSON.stringify({
      name: f.name,
      company: f.company || null,
      email: f.email || null,
      tier: f.tier,
      notes: f.notes || null,
    });
    try {
      if (editing.id) await api(`/api/customers/${editing.id}`, { method: "PATCH", body });
      else await api("/api/customers", { method: "POST", body });
      setEditing(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: Row) {
    if (!confirm(`Delete ${c.name}? Their items stay but are unlinked.`)) return;
    try {
      await api(`/api/customers/${c.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-6">
      <div className="mb-4 flex items-center">
        <div>
          <h1 className="text-lg font-semibold">Customers</h1>
          <p className="text-sm text-slate-500">The agent&apos;s lookup_customer tool searches this table.</p>
        </div>
        <Button className="ml-auto" variant="primary" onClick={() => setEditing({ id: null, form: EMPTY })}>
          + New customer
        </Button>
      </div>
      {error && <p className="mb-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Company</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Tier</th>
              <th className="px-3 py-2 font-medium">Items</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-t align-top">
                <td className="px-3 py-2 font-medium text-slate-900">
                  {c.name}
                  {c.notes && <p className="text-xs font-normal text-slate-500">{c.notes}</p>}
                </td>
                <td className="px-3 py-2">{c.company}</td>
                <td className="px-3 py-2 text-slate-600">{c.email}</td>
                <td className="px-3 py-2">
                  <span className={c.tier === "priority" ? "text-indigo-700" : "text-slate-500"}>{c.tier}</span>
                </td>
                <td className="px-3 py-2 tabular-nums">{c.item_count}</td>
                <td className="space-x-1 whitespace-nowrap px-3 py-2 text-right">
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setEditing({
                        id: c.id,
                        form: { name: c.name, company: c.company ?? "", email: c.email ?? "", tier: c.tier, notes: c.notes ?? "" },
                      })
                    }
                  >
                    Edit
                  </Button>
                  <Button variant="ghost" className="text-rose-700" onClick={() => remove(c)}>
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setEditing(null)}>
          <form
            className="w-full max-w-md space-y-3 rounded-lg bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <h2 className="text-base font-semibold">{editing.id ? "Edit customer" : "New customer"}</h2>
            {(["name", "company", "email"] as const).map((k) => (
              <Field key={k} label={k[0].toUpperCase() + k.slice(1)}>
                <input
                  className={inputClass}
                  required={k === "name"}
                  type={k === "email" ? "email" : "text"}
                  value={editing.form[k]}
                  onChange={(e) => setEditing({ ...editing, form: { ...editing.form, [k]: e.target.value } })}
                />
              </Field>
            ))}
            <Field label="Tier">
              <select
                className={inputClass}
                value={editing.form.tier}
                onChange={(e) => setEditing({ ...editing, form: { ...editing.form, tier: e.target.value as Form["tier"] } })}
              >
                <option value="standard">standard</option>
                <option value="priority">priority</option>
              </select>
            </Field>
            <Field label="Notes (the agent reads these)">
              <textarea
                className={inputClass}
                value={editing.form.notes}
                onChange={(e) => setEditing({ ...editing, form: { ...editing.form, notes: e.target.value } })}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                Save
              </Button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
