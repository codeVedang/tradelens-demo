import { useEffect, useState, type FormEvent } from "react";
import {
  Bar,
  Cell,
  ComposedChart,
  CartesianGrid,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download } from "lucide-react";
import { api, exportJournal } from "./api";

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
  trend: Array<{
    date: string;
    expectedCents: number;
    realCents: number;
    differenceCents: number;
    entryCount: number;
  }>;
  recent: Entry[];
};
const outcome = (cents: number) =>
  cents > 0 ? "Profit" : cents < 0 ? "Loss" : "Break-even";
const tone = (cents: number) =>
  cents > 0 ? "profit" : cents < 0 ? "loss" : "flat";
const chartColors = { profit: "#50d49b", loss: "#ff7583", flat: "#a8a8b3" };
const journalFilters = (query: string, from: string, to: string) => {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return params;
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
  const [exporting, setExporting] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (addOnOpen && !dashboard) {
      setEdit(null);
      onOpened();
    }
  }, [addOnOpen, dashboard, onOpened]);
  useEffect(() => {
    const controller = new AbortController();
    const params = journalFilters(query, from, to);
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
  const signedMoney = (cents: number) => (cents > 0 ? "+" : "") + money(cents);
  const days = summary?.trend ?? [];
  const profitDays = days.filter((day) => day.realCents > 0).length;
  const lossDays = days.filter((day) => day.realCents < 0).length;
  async function downloadCsv() {
    setExporting(true);
    setError("");
    try {
      await exportJournal(journalFilters(query, from, to));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setExporting(false);
    }
  }
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
            <div className="stat">
              <div>Total entries</div>
              <strong>{summary?.count ?? "—"}</strong>
            </div>
            <div className="stat">
              <div>Expected P&L</div>
              <strong>{money(summary?.expectedCents ?? 0)}</strong>
            </div>
            <div className="stat">
              <div>Real P&L</div>
              <strong
                className={
                  summary ? "pnl-" + tone(summary.realCents) : undefined
                }
              >
                {signedMoney(summary?.realCents ?? 0)}
              </strong>
              {summary && <small>{outcome(summary.realCents)}</small>}
            </div>
            <div className="stat">
              <div>Difference (real − expected)</div>
              <strong>{signedMoney(summary?.differenceCents ?? 0)}</strong>
            </div>
          </div>
          <section className="panel settings journal-chart">
            <h3>Daily profit and loss</h3>
            {days.length ? (
              <>
                <p>Each day adds up the entries recorded on that date.</p>
                <div className="pnl-legend">
                  <span className="pnl-profit">
                    {profitDays} profit {profitDays === 1 ? "day" : "days"}
                  </span>
                  <span className="pnl-loss">
                    {lossDays} loss {lossDays === 1 ? "day" : "days"}
                  </span>
                  <span className="pnl-flat">
                    {days.length - profitDays - lossDays} break-even
                  </span>
                  <span className="pnl-expected">Expected P&L</span>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={days}>
                    <CartesianGrid vertical={false} stroke="#31323a" />
                    <XAxis dataKey="date" stroke="#a8a8b3" />
                    <YAxis stroke="#a8a8b3" tickFormatter={money} width={95} />
                    <Tooltip
                      formatter={(value) => money(Number(value))}
                      contentStyle={{ background: "#171d26", color: "#fff" }}
                    />
                    <ReferenceLine y={0} stroke="#687180" />
                    <Bar
                      name="Real P&L"
                      dataKey="realCents"
                      maxBarSize={48}
                      isAnimationActive={false}
                    >
                      {days.map((day) => (
                        <Cell
                          key={day.date}
                          fill={chartColors[tone(day.realCents)]}
                        />
                      ))}
                    </Bar>
                    <Line
                      name="Expected P&L"
                      dataKey="expectedCents"
                      stroke="#9ebaff"
                      strokeDasharray="4 4"
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
                <div className="table-wrap daily-pnl-table">
                  <table aria-label="Daily profit and loss breakdown">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Entries</th>
                        <th>Expected P&L</th>
                        <th>Real P&L</th>
                        <th>Difference</th>
                        <th>Outcome</th>
                      </tr>
                    </thead>
                    <tbody>
                      {days
                        .slice()
                        .reverse()
                        .map((day) => (
                          <tr key={day.date}>
                            <td>{day.date}</td>
                            <td>{day.entryCount}</td>
                            <td>{money(day.expectedCents)}</td>
                            <td className={"pnl-" + tone(day.realCents)}>
                              {signedMoney(day.realCents)}
                            </td>
                            <td>{signedMoney(day.differenceCents)}</td>
                            <td className={"pnl-" + tone(day.realCents)}>
                              {outcome(day.realCents)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p>Save a journal entry to see your performance over time.</p>
            )}
          </section>
        </>
      ) : (
        <>
          <div className="actions journal-actions">
            <button className="primary" onClick={() => setEdit(null)}>
              Add journal entry
            </button>
            <button
              onClick={() => void downloadCsv()}
              disabled={exporting || Boolean(from && to && from > to)}
            >
              <Download size={15} /> {exporting ? "Exporting…" : "Export CSV"}
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
                    <td className={"pnl-" + tone(row.realCents)}>
                      {signedMoney(row.realCents)}
                    </td>
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
