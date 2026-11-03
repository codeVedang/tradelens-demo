import { useEffect, useState, type FormEvent } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "./api";

export type Entry = {
  id: string;
  date: string;
  notes: string;
  expectedCents: number;
  realCents: number;
};
type Summary = {
  count: number;
  currency: string;
  positive: number;
  negative: number;
  flat: number;
  expectedCents: number;
  realCents: number;
  differenceCents: number;
  trend: Array<{ date: string; expectedCents: number; realCents: number }>;
  recent: Entry[];
};
const today = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
};

export default function Journal({
  dashboard,
  onJournal,
  onCompanion,
  addOnOpen,
  onOpened,
}: {
  dashboard: boolean;
  onJournal: (add?: boolean) => void;
  onCompanion: () => void;
  addOnOpen: boolean;
  onOpened: () => void;
}) {
  const [summary, setSummary] = useState<Summary>();
  const [rows, setRows] = useState<Entry[]>([]);
  const [edit, setEdit] = useState<Entry | null>();
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (addOnOpen && !dashboard) {
      setEdit(null);
      onOpened();
    }
  }, [addOnOpen, dashboard, onOpened]);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (!dashboard) {
      if (query) params.set("q", query);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
    }
    setError("");
    const options = { signal: controller.signal };
    void Promise.all([
      api<Summary>("/journal/analytics", "GET", undefined, options),
      dashboard
        ? Promise.resolve([])
        : api<Entry[]>("/journal?" + params, "GET", undefined, options),
    ])
      .then(([analytics, entries]) => {
        if (!controller.signal.aborted) {
          setSummary(analytics);
          setRows(entries);
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          setRows([]);
          setError(failure.message);
        }
      });
    return () => controller.abort();
  }, [dashboard, from, to, query, revision]);
  const money = (cents: number) =>
    summary
      ? new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: summary.currency,
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(cents / 100)
      : "—";
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await mutate(async () => {
      await api(
        edit ? "/journal/" + edit.id : "/journal",
        edit ? "PUT" : "POST",
        Object.fromEntries(data),
      );
      setEdit(undefined);
    });
  }
  async function mutate(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
      setRevision((value) => value + 1);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const visible = dashboard ? (summary?.recent ?? []) : rows;
  return (
    <>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {dashboard ? (
        <>
          <div className="actions journal-actions">
            <button className="primary" onClick={() => onJournal(true)}>
              Add journal entry
            </button>
            <button onClick={() => onJournal()}>View all entries</button>
            <button onClick={onCompanion}>AI Companion</button>
          </div>
          <div className="stats">
            {[
              ["Total entries", summary?.count ?? "—"],
              ["Expected P&L", money(summary?.expectedCents ?? 0)],
              ["Real P&L", money(summary?.realCents ?? 0)],
              [
                "Difference (real − expected)",
                money(summary?.differenceCents ?? 0),
              ],
            ].map(([label, value]) => (
              <div className="stat" key={label}>
                <div>{label}</div>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <section className="panel settings journal-chart">
            <h3>P&L trend</h3>
            {summary?.trend.length ? (
              <ResponsiveContainer width="100%" height={230}>
                <AreaChart data={summary.trend}>
                  <CartesianGrid vertical={false} stroke="#31323a" />
                  <XAxis dataKey="date" stroke="#a8a8b3" />
                  <YAxis stroke="#a8a8b3" tickFormatter={money} width={95} />
                  <Tooltip
                    formatter={(value) => money(Number(value))}
                    contentStyle={{ background: "#171d26", color: "#fff" }}
                  />
                  <Area
                    name="Expected P&L"
                    dataKey="expectedCents"
                    stroke="#ff9cac"
                    fill="transparent"
                  />
                  <Area
                    name="Real P&L"
                    dataKey="realCents"
                    stroke="#FF1738"
                    fill="#FF173833"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p>Save a journal entry to see your performance over time.</p>
            )}
            {summary && (
              <p>
                {summary.positive} positive · {summary.negative} negative ·{" "}
                {summary.flat} flat
              </p>
            )}
          </section>
        </>
      ) : (
        <>
          <div className="actions journal-actions">
            <button className="primary" onClick={() => setEdit(null)}>
              Add journal entry
            </button>
          </div>
          {edit !== undefined && (
            <form
              className="panel settings journal-form"
              key={edit?.id ?? "new"}
              onSubmit={save}
            >
              <h3>{edit ? "Edit journal entry" : "New journal entry"}</h3>
              <label>
                Date
                <input
                  name="date"
                  type="date"
                  required
                  defaultValue={edit?.date ?? today()}
                />
              </label>
              <label>
                Notes
                <textarea
                  name="notes"
                  maxLength={10000}
                  defaultValue={edit?.notes}
                />
              </label>
              <div className="journal-amounts">
                <label>
                  Expected P&L ({summary?.currency ?? "reporting currency"})
                  <input
                    name="expected"
                    inputMode="decimal"
                    pattern="-?[0-9]{1,9}(\.[0-9]{1,2})?"
                    required
                    defaultValue={
                      edit ? (edit.expectedCents / 100).toFixed(2) : ""
                    }
                  />
                </label>
                <label>
                  Real P&L ({summary?.currency ?? "reporting currency"})
                  <input
                    name="real"
                    inputMode="decimal"
                    pattern="-?[0-9]{1,9}(\.[0-9]{1,2})?"
                    required
                    defaultValue={edit ? (edit.realCents / 100).toFixed(2) : ""}
                  />
                </label>
              </div>
              <div className="actions">
                <button className="primary" disabled={busy}>
                  Save entry
                </button>
                <button type="button" onClick={() => setEdit(undefined)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
          <div className="filters journal-filter">
            <label>
              Search notes
              <input
                value={query}
                maxLength={100}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label>
              From date
              <input
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </label>
            <label>
              To date
              <input
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </label>
          </div>
        </>
      )}
      <section className="panel journal-list">
        <div className="panel-heading">
          <h3>{dashboard ? "Recent journal entries" : "Journal history"}</h3>
        </div>
        {visible.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Notes</th>
                  <th>Expected P&L</th>
                  <th>Real P&L</th>
                  {!dashboard && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id}>
                    <td>{row.date}</td>
                    <td className="journal-notes">{row.notes || "—"}</td>
                    <td>{money(row.expectedCents)}</td>
                    <td>{money(row.realCents)}</td>
                    {!dashboard && (
                      <td>
                        <div className="actions">
                          <button
                            className="small"
                            onClick={() => setEdit(row)}
                          >
                            Edit
                          </button>
                          <button
                            className="small danger"
                            disabled={busy}
                            onClick={() => {
                              if (window.confirm("Delete this journal entry?"))
                                void mutate(async () => {
                                  await api("/journal/" + row.id, "DELETE");
                                  if (edit?.id === row.id) setEdit(undefined);
                                });
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <p>No journal entries to show.</p>
          </div>
        )}
      </section>
    </>
  );
}
