"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "./ui";

/** Fired after demo data changes so the open page can reload. */
export const ITEMS_CHANGED = "opspilot:items-changed";

/** Demo helpers, kept apart from the app itself in the top bar. */
export function GenerateButton() {
  const [busy, setBusy] = useState<"generate" | "reset" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  async function act(kind: "generate" | "reset") {
    if (kind === "reset" && !confirm("Reset to the original demo data? All changes will be lost.")) return;
    setBusy(kind);
    setNote(null);
    try {
      if (kind === "generate") {
        const r = await api<{ created: number }>("/api/items/generate", { method: "POST" });
        setNote(`Added ${r.created} emails to New`);
      } else {
        await api("/api/demo/reset", { method: "POST" });
        setNote("Demo data restored");
      }
      window.dispatchEvent(new Event(ITEMS_CHANGED));
      if (pathname !== "/") router.push("/");
      router.refresh();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
      setTimeout(() => setNote(null), 6000);
    }
  }

  return (
    <div className="ml-auto flex items-center gap-2">
      {note && <span className="text-xs text-slate-500">{note}</span>}
      <span className="hidden text-xs text-slate-400 sm:inline">Demo tools:</span>
      <Button onClick={() => act("generate")} disabled={busy != null} title="Adds 10 made-up sample emails for trying things out">
        {busy === "generate" ? "Creating emails…" : "✨ Add 10 sample emails"}
      </Button>
      <Button variant="ghost" onClick={() => act("reset")} disabled={busy != null} title="Restore the original demo data">
        {busy === "reset" ? "Resetting…" : "Reset demo"}
      </Button>
    </div>
  );
}
