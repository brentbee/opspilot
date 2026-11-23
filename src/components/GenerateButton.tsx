"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "./ui";

/** Fired after new items are created so the board can reload. */
export const ITEMS_CHANGED = "opspilot:items-changed";

export function GenerateButton() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  async function generate() {
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ created: number }>("/api/items/generate", { method: "POST" });
      setNote(`Added ${r.created} emails to New`);
      window.dispatchEvent(new Event(ITEMS_CHANGED));
      if (pathname !== "/") router.push("/");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
      setTimeout(() => setNote(null), 6000);
    }
  }

  return (
    <div className="ml-auto flex items-center gap-3">
      {note && <span className="text-xs text-slate-500">{note}</span>}
      <span className="hidden text-xs text-slate-400 sm:inline">Demo · synthetic data</span>
      <Button onClick={generate} disabled={busy} title="Claude writes 10 new, fictional inbox emails">
        {busy ? "Writing emails…" : "✨ Generate 10 emails"}
      </Button>
    </div>
  );
}
