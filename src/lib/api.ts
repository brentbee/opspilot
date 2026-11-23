"use client";

import { createSSEParser } from "./sse";
import type { AgentEvent } from "./types";

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** POSTs to the run endpoint and calls onEvent for each streamed agent event. */
export async function streamRun(itemId: string, onEvent: (e: AgentEvent) => void): Promise<void> {
  const res = await fetch(`/api/items/${itemId}/run`, { method: "POST" });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Run failed (${res.status})`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const parse = createSSEParser();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const e of parse(value)) onEvent(e);
  }
}
