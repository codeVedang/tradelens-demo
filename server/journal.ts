import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import type { Store } from "./db.js";
import { fail } from "./sessions.js";

export type JournalEntry = {
  id: string;
  date: string;
  notes: string;
  expectedCents: number;
  realCents: number;
};
const amount = z
  .string()
  .regex(/^-?\d{1,9}(\.\d{1,2})?$/)
  .transform((text) => Math.round(Number(text) * 100));
const input = z
  .object({
    date: z.iso.date(),
    notes: z.string().trim().max(10000),
    expected: amount,
    real: amount,
  })
  .strict();
const filters = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  q: z.string().max(100).optional(),
});
const empty = () => ({ expectedCents: 0, realCents: 0, differenceCents: 0 });
const add = (totals: ReturnType<typeof empty>, row: JournalEntry) => {
  totals.expectedCents += row.expectedCents;
  totals.realCents += row.realCents;
  totals.differenceCents = totals.realCents - totals.expectedCents;
};
export function journal(
  store: Store,
  owner: (req: Request) => string,
  currency: string,
) {
  const router = Router();
  const entries = (req: Request) =>
    store
      .all<JournalEntry>("journal", owner(req))
      .sort((a, b) => b.date.localeCompare(a.date));
  router.get("/analytics", (req, res) => {
    const rows = entries(req);
    const totals = empty(),
      byDate = new Map<string, ReturnType<typeof empty>>();
    let positive = 0,
      negative = 0,
      flat = 0;
    for (const row of rows) {
      add(totals, row);
      const day = byDate.get(row.date) ?? empty();
      add(day, row);
      byDate.set(row.date, day);
      if (row.realCents > 0) positive++;
      else if (row.realCents < 0) negative++;
      else flat++;
    }
    res.json({
      ...totals,
      currency,
      count: rows.length,
      positive,
      negative,
      flat,
      trend: [...byDate]
        .reverse()
        .map(([date, values]) => ({ date, ...values })),
      recent: rows.slice(0, 5),
    });
  });
  router.get("/", (req, res) => {
    const { q, from, to } = filters.parse(req.query);
    if (from && to && from > to) throw fail(400, "Date range is reversed");
    res.json(
      entries(req).filter(
        (row) =>
          (!from || row.date >= from) &&
          (!to || row.date <= to) &&
          (!q || row.notes.toLowerCase().includes(q.toLowerCase())),
      ),
    );
  });
  const save = (req: Request, id: string, action: string) => {
    const { date, notes, expected, real } = input.parse(req.body);
    const user = owner(req);
    return store.transaction(() => {
      store.put(
        "audit",
        {
          id: randomUUID(),
          action,
          resourceId: id,
          at: new Date().toISOString(),
        },
        user,
      );
      return store.put(
        "journal",
        { id, date, notes, expectedCents: expected, realCents: real },
        user,
      );
    });
  };
  const existing = (req: Request) => {
    const id = z.uuid().parse(req.params.id);
    if (!store.get("journal", id, owner(req)))
      throw fail(404, "Journal entry not found");
    return id;
  };
  router.post("/", (req, res) =>
    res.status(201).json(save(req, randomUUID(), "journal.created")),
  );
  router.put("/:id", (req, res) =>
    res.json(save(req, existing(req), "journal.updated")),
  );
  router.delete("/:id", (req, res) => {
    const id = existing(req),
      user = owner(req);
    store.transaction(() => {
      store.delete("journal", id, user);
      store.put(
        "audit",
        {
          id: randomUUID(),
          action: "journal.deleted",
          resourceId: id,
          at: new Date().toISOString(),
        },
        user,
      );
    });
    res.status(204).end();
  });
  return router;
}
