"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api, streamRun } from "@/lib/api";
import { positionBetween } from "@/lib/ordering";
import { BOARD_COLUMNS, type Item, type Status, type Step } from "@/lib/types";
import { Button, CategoryBadge, Confidence, PriorityTag, cx, timeAgo } from "./ui";
import { ItemDrawer } from "./ItemDrawer";
import { NewItemDialog } from "./NewItemDialog";
import { LABEL } from "./Timeline";
import { ITEMS_CHANGED } from "./GenerateButton";

export interface LiveRun {
  steps: Step[];
  draft: string;
  running: boolean;
  error?: string;
}

/** Board column for an item ("processing" cards stay visible in New). */
function columnOf(item: Item): Status {
  return item.status === "processing" ? "new" : item.status;
}

export function Board() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, LiveRun>>({});
  const [batch, setBatch] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await api<Item[]>("/api/items"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial load from the API (an external system), then render.
     
    void load();
    // Deep link from the Customers page: /?item=<id> opens that item.
    const linked = new URLSearchParams(window.location.search).get("item");
    if (linked) setOpenId(linked);
    const reload = () => {
      setRuns({});
      setOpenId(null);
      void load();
    };
    window.addEventListener(ITEMS_CHANGED, reload);
    return () => window.removeEventListener(ITEMS_CHANGED, reload);
  }, [load]);

  const columns = useMemo(() => {
    const map = new Map<Status, Item[]>(BOARD_COLUMNS.map((c) => [c.status, []]));
    for (const it of [...items].sort((a, b) => a.position - b.position)) map.get(columnOf(it))?.push(it);
    return map;
  }, [items]);

  const upsert = useCallback((item: Item) => {
    setItems((prev) => (prev.some((p) => p.id === item.id) ? prev.map((p) => (p.id === item.id ? item : p)) : [...prev, item]));
  }, []);

  /* ------------------------------ agent runs ------------------------------ */

  const run = useCallback(
    async (id: string) => {
      setRuns((r) => ({ ...r, [id]: { steps: [], draft: "", running: true } }));
      setItems((prev) => prev.map((p) => (p.id === id ? { ...p, status: "processing" } : p)));
      const patch = (fn: (r: LiveRun) => LiveRun) => setRuns((all) => ({ ...all, [id]: fn(all[id]) }));
      try {
        await streamRun(id, (e) => {
          if (e.type === "step") patch((r) => ({ ...r, steps: [...r.steps, e.step] }));
          else if (e.type === "token") patch((r) => ({ ...r, draft: r.draft + e.text }));
          else if (e.type === "item") upsert(e.item);
          else if (e.type === "error") patch((r) => ({ ...r, error: e.message }));
        });
      } catch (e) {
        patch((r) => ({ ...r, error: (e as Error).message }));
        void load();
      } finally {
        patch((r) => ({ ...r, running: false }));
      }
    },
    [load, upsert],
  );

  async function runAllNew() {
    setBatch(true);
    try {
      for (const it of columns.get("new") ?? []) if (it.status === "new") await run(it.id);
    } finally {
      setBatch(false);
    }
  }

  /* ------------------------------ drag & drop ----------------------------- */

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const statusOfTarget = (overId: string): Status | null => {
    if (overId.startsWith("col:")) return overId.slice(4) as Status;
    const it = items.find((i) => i.id === overId);
    return it ? columnOf(it) : null;
  };

  function onDragStart(e: DragStartEvent) {
    setDragId(String(e.active.id));
  }

  // While dragging across columns, move the card in local state so it previews in place.
  function onDragOver(e: DragOverEvent) {
    if (!e.over) return;
    const activeId = String(e.active.id);
    const target = statusOfTarget(String(e.over.id));
    const active = items.find((i) => i.id === activeId);
    if (!active || !target || columnOf(active) === target) return;
    setItems((prev) => prev.map((p) => (p.id === activeId ? { ...p, status: target } : p)));
  }

  async function onDragEnd(e: DragEndEvent) {
    setDragId(null);
    const activeId = String(e.active.id);
    const original = items.find((i) => i.id === activeId);
    if (!e.over || !original) return void load();
    const target = statusOfTarget(String(e.over.id));
    if (!target) return void load();

    // Work out the card's new index within the target column, then its neighbours.
    const col = (columns.get(target) ?? []).filter((i) => i.id !== activeId);
    let index = col.length;
    const overIdx = col.findIndex((i) => i.id === String(e.over!.id));
    if (overIdx >= 0) {
      const overRect = e.over.rect;
      const activeRect = e.active.rect.current.translated;
      const below = activeRect && activeRect.top > overRect.top + overRect.height / 2;
      index = overIdx + (below ? 1 : 0);
    }
    const before = col[index - 1]?.position ?? null;
    const after = col[index]?.position ?? null;
    const position = positionBetween(before, after);

    const snapshot = items;
    setItems((prev) => prev.map((p) => (p.id === activeId ? { ...p, status: target, position } : p)));
    try {
      upsert(await api<Item>(`/api/items/${activeId}`, { method: "PATCH", body: JSON.stringify({ status: target, position }) }));
    } catch (err) {
      setItems(snapshot); // roll back the optimistic move
      setError(`Couldn't save the move: ${(err as Error).message}`);
    }
  }

  const dragging = items.find((i) => i.id === dragId) ?? null;
  const open = items.find((i) => i.id === openId) ?? null;
  const newCount = (columns.get("new") ?? []).filter((i) => i.status === "new").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Operations inbox</h1>
          <p className="text-sm text-slate-500">
            The assistant reads each email, drafts a reply and sorts it. Drag a card to move it; only staff can mark one Done.
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button onClick={() => setCreating(true)}>+ New item</Button>
          <Button variant="primary" disabled={batch || newCount === 0} onClick={runAllNew}>
            {batch ? "Processing…" : `Process all New (${newCount})`}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mx-6 mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error} <button className="ml-2 underline" onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      {loading ? (
        <p className="px-6 text-sm text-slate-500">Loading…</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={() => {
            setDragId(null);
            void load();
          }}
        >
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-x-auto px-6 pb-6 md:grid-cols-4">
            {BOARD_COLUMNS.map((c) => (
              <Column key={c.status} status={c.status} title={c.title} hint={c.hint} items={columns.get(c.status) ?? []}>
                {(columns.get(c.status) ?? []).map((it) => (
                  <Card key={it.id} item={it} live={runs[it.id]} onOpen={() => setOpenId(it.id)} />
                ))}
              </Column>
            ))}
          </div>
          <DragOverlay>{dragging ? <CardBody item={dragging} lifted /> : null}</DragOverlay>
        </DndContext>
      )}

      {open && (
        <ItemDrawer
          item={open}
          live={runs[open.id]}
          onClose={() => setOpenId(null)}
          onRun={() => run(open.id)}
          onChange={upsert}
          onDelete={() => {
            setItems((prev) => prev.filter((p) => p.id !== open.id));
            setOpenId(null);
          }}
        />
      )}
      {creating && (
        <NewItemDialog
          onClose={() => setCreating(false)}
          onCreated={(item, runNow) => {
            upsert(item);
            setCreating(false);
            if (runNow) {
              setOpenId(item.id);
              void run(item.id);
            }
          }}
        />
      )}
    </div>
  );
}

function Column({
  status,
  title,
  hint,
  items,
  children,
}: {
  status: Status;
  title: string;
  hint: string;
  items: Item[];
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}` });
  return (
    <section
      ref={setNodeRef}
      className={cx(
        "flex min-h-[200px] flex-col rounded-lg border bg-slate-100/70 p-2 transition",
        isOver ? "border-indigo-400 bg-indigo-50" : "border-slate-200",
        status === "needs_review" && "bg-amber-50/60",
      )}
    >
      <header className="mb-2 flex items-baseline justify-between px-1">
        <h2 className="text-sm font-semibold text-slate-800">
          {title} <span className="font-normal text-slate-500">{items.length}</span>
        </h2>
        <span className="text-[11px] text-slate-500">{hint}</span>
      </header>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-1 flex-col gap-2">{children}</div>
      </SortableContext>
    </section>
  );
}

function Card({ item, live, onOpen }: { item: Item; live?: LiveRun; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: item.status === "processing",
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cx(isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
      onClick={onOpen}
    >
      <CardBody item={item} live={live} />
    </div>
  );
}

function CardBody({ item, live, lifted }: { item: Item; live?: LiveRun; lifted?: boolean }) {
  const processing = item.status === "processing";
  const lastStep = live?.steps.at(-1);
  return (
    <article
      className={cx(
        "cursor-pointer rounded-md border bg-white p-2.5 text-left shadow-sm hover:border-indigo-300",
        processing ? "border-indigo-400 ring-2 ring-indigo-200" : "border-slate-200",
        lifted && "rotate-1 shadow-lg",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 text-sm font-medium text-slate-900">{item.subject}</h3>
        <PriorityTag priority={item.priority} />
      </div>
      <p className="mt-0.5 truncate text-xs text-slate-500">
        {item.customer_name ?? item.from_name ?? item.from_email ?? "Unknown sender"} · {timeAgo(item.created_at)}
      </p>
      {processing ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-indigo-700">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" />
          {lastStep?.tool ? `${LABEL[lastStep.tool] ?? "Working"}…` : "Assistant working…"}
        </p>
      ) : (
        (item.category || item.confidence != null) && (
          <div className="mt-2 flex items-center gap-2">
            <CategoryBadge category={item.category} />
            <Confidence value={item.confidence} />
            {item.agent_ms != null && (
              <span className="ml-auto text-[11px] text-slate-400">
                {item.last_trigger === "scheduled" && (
                  <span title="Handled by the automatic morning run" className="mr-1">
                    ⏱
                  </span>
                )}
                {(item.agent_ms / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        )
      )}
    </article>
  );
}
