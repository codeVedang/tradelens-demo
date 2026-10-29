import { useState } from "react";
import { FileText, ArrowUpRight } from "lucide-react";
import type { Session } from "../../shared/schema";
import Empty from "./Empty";

export default function SessionList({
  sessions,
  onOpen,
}: {
  sessions: Session[];
  onOpen: (s: Session) => void;
}) {
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const invalidRange = !!(from && to && from > to);
  const localDate = (value: string) => {
    const d = new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const filtered = invalidRange
    ? []
    : sessions.filter(
        (s) =>
          (!query || s.title.toLowerCase().includes(query.toLowerCase())) &&
          (status === "all" || s.status === status) &&
          (!from || localDate(s.createdAt) >= from) &&
          (!to || localDate(s.createdAt) <= to),
      );
  return (
    <section className="panel session-list">
      <div className="panel-heading">
        <h3>
          Session history{" "}
          <span className="count">
            {filtered.length} / {sessions.length}
          </span>
        </h3>
        <span className="muted">Your recorded process</span>
      </div>
      <div className="filters">
        <label>
          Search sessions
          <input
            value={query}
            maxLength={100}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Session title"
          />
        </label>
        <label>
          Session status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="created">Created</option>
            <option value="recording">Recording</option>
            <option value="stopped">Ready to review</option>
          </select>
        </label>
        <label>
          From date
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          To date
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button
          className="small"
          onClick={() => {
            setQuery("");
            setStatus("all");
            setFrom("");
            setTo("");
          }}
        >
          Clear filters
        </button>
      </div>
      {invalidRange && (
        <p role="alert" className="notice">
          From date must not be after To date.
        </p>
      )}
      {filtered.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SESSION</th>
                <th>DATE</th>
                <th>MODE</th>
                <th>FRAMES</th>
                <th>STATUS</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td>
                    <button className="session-title" onClick={() => onOpen(s)}>
                      <FileText size={16} />
                      {s.title}
                    </button>
                  </td>
                  <td>{new Date(s.createdAt).toLocaleString()}</td>
                  <td>
                    <span className="badge mock">
                      {s.mode === "mock" ? "MOCK" : "OPENAI"}
                    </span>
                  </td>
                  <td>{s.frames}</td>
                  <td>
                    <span className="badge">
                      {s.status === "stopped" ? "Ready to review" : s.status}
                    </span>
                  </td>
                  <td>
                    <button
                      aria-label={`Review ${s.title}`}
                      onClick={() => onOpen(s)}
                    >
                      <ArrowUpRight size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          icon={FileText}
          title={
            sessions.length
              ? "No sessions match your filters"
              : "Your first session is a fresh start"
          }
          text={
            sessions.length
              ? "Change or clear the filters to see other saved sessions."
              : "Record a session to build a history of observations, reflections, and improvements."
          }
        />
      )}
    </section>
  );
}
