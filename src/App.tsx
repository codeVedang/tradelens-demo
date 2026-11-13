import Journal from "./Journal";
import { AccountSettings, type Profile, type Subscription } from "./Account";
import BrandMark from "./components/BrandMark";
import Empty from "./components/Empty";
import SessionList from "./components/SessionList";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Check,
  ChevronRight,
  Circle,
  Clock3,
  FileText,
  Focus,
  LayoutDashboard,
  Monitor,
  Pause,
  Play,
  Plus,
  Settings,
  ShieldCheck,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, ApiError, exportReport, notifyPageClosed } from "./api";
import { Capture } from "./capture";
import {
  tradingPlanSchema,
  type Session,
  type TradingPlan,
} from "../shared/schema";
const pages = [
  "Overview",
  "Live coach",
  "Session reports",
  "Trading journal",
  "Settings",
];
const icons = [LayoutDashboard, Focus, FileText, BookOpen, Settings];
export const duration = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
function SavedTradingPlan({ plan }: { plan?: TradingPlan }) {
  if (!plan) return null;
  return (
    <details className="recording-plan saved-plan">
      <summary>Trading plan for this session</summary>
      {plan.dailyLossLimitPercent !== undefined && (
        <p>Daily loss limit: {plan.dailyLossLimitPercent}% of account equity</p>
      )}
      {plan.perTradeRiskLimitPercent !== undefined && (
        <p>
          Risk limit per trade: {plan.perTradeRiskLimitPercent}% of account
          equity
        </p>
      )}
      {plan.strategy && <p className="plan-notes">{plan.strategy}</p>}
    </details>
  );
}
export default function App({
  account,
  subscription,
  logout,
}: {
  account?: Profile;
  subscription?: Subscription;
  logout?: () => void;
} = {}) {
  const premium = !account || subscription?.active === true;
  const [addJournal, setAddJournal] = useState(false);
  const [strategy, setStrategy] = useState("");
  const [dailyRisk, setDailyRisk] = useState("");
  const [tradeRisk, setTradeRisk] = useState("");
  const starting = useRef(false);
  const [captureError, setCaptureError] = useState("");
  const [page, setPage] = useState(
      location.pathname === "/app/settings" ? "Settings" : "Overview",
    ),
    [sessions, setSessions] = useState<Session[]>([]),
    [config, setConfig] = useState<any>(),
    [active, setActive] = useState<Session>(),
    [selected, setSelected] = useState<Session>(),
    [events, setEvents] = useState<any[]>([]),
    [report, setReport] = useState<any>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [finalizing, setFinalizing] = useState(false),
    [loading, setLoading] = useState(true),
    [elapsed, setElapsed] = useState(0),
    [paused, setPaused] = useState(false),
    [consent, setConsent] = useState(false),
    [saveVideo, setSaveVideo] = useState(false),
    [scenario, setScenario] = useState("normal"),
    [analysis, setAnalysis] = useState("Idle"),
    [videoUrl, setVideoUrl] = useState(""),
    [notes, setNotes] = useState("");
  const [captured, setCaptured] = useState(0),
    [analyzed, setAnalyzed] = useState(0),
    [lastLatency, setLastLatency] = useState<number | null>(null),
    [processing, setProcessing] = useState<any[]>([]),
    [videoSession, setVideoSession] = useState(""),
    [notice, setNotice] = useState(""),
    [reviewFilter, setReviewFilter] = useState("all");
  const openSequence = useRef(0),
    stoppingRef = useRef(false),
    stopPromise = useRef<Promise<void> | undefined>(undefined),
    failureCount = useRef(0);
  const pausedResult = useRef<(() => void) | undefined>(undefined);
  const capture = useRef<Capture | undefined>(undefined),
    activeRef = useRef<Session | undefined>(undefined),
    stopRef = useRef<(reason?: "user" | "capture_ended") => Promise<void>>(
      async () => {},
    ),
    preview = useRef<HTMLVideoElement>(null),
    urlRef = useRef("");
  const refresh = async () => {
    const [ss, cc] = await Promise.all([
      premium ? api<Session[]>("/sessions") : Promise.resolve([]),
      api("/config/status"),
    ]);
    setSessions(ss);
    setConfig(cc);
    return ss;
  };
  useEffect(() => {
    refresh()
      .then(async (ss) => {
        if (ss[0]) await openSession(ss[0]);
      })
      .catch((e) => {
        setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [premium]);
  useEffect(() => {
    return () => {
      const current = activeRef.current;
      capture.current?.cancel();
      void capture.current?.stop().finally(() => {
        if (current)
          void api(`/sessions/${current.id}/stop`, "POST", {}).catch(() => {});
      });
      URL.revokeObjectURL(urlRef.current);
    };
  }, []);
  useEffect(() => {
    const pageClosed = () => {
      const s = activeRef.current;
      if (s) {
        notifyPageClosed(s.id, capture.current?.capturedCount ?? 0);
        activeRef.current = undefined;
        setActive(undefined);
        setPaused(false);
        setAnalysis("Capture ended");
        setNotice(
          "Capture ended when you left the page. Reopen the session report or start a new session.",
        );
      }
      capture.current?.cancel();
    };
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted)
        void refresh()
          .then(async (ss) => {
            if (ss[0]) await openSession(ss[0]);
          })
          .catch((e) => setError(e.message));
    };
    window.addEventListener("pagehide", pageClosed);
    window.addEventListener("pageshow", restored);
    return () => {
      window.removeEventListener("pagehide", pageClosed);
      window.removeEventListener("pageshow", restored);
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    const heartbeat = setInterval(() => {
      void api(
        `/sessions/${active.id}/heartbeat`,
        "POST",
        { capturedCount: capture.current?.capturedCount ?? 0 },
        { timeoutMs: 15000 },
      ).catch((e) => {
        setError(e.message);
        if (
          e instanceof ApiError &&
          ["PREMIUM_REQUIRED", "AUTH_REQUIRED"].includes(e.code ?? "")
        )
          void stopRef.current();
      });
    }, 10000);
    return () => clearInterval(heartbeat);
  }, [active]);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(
      () =>
        setElapsed(
          Math.floor((Date.now() - Date.parse(active.startedAt!)) / 1000),
        ),
      1000,
    );
    return () => clearInterval(t);
  }, [active]);
  useEffect(() => {
    if (preview.current && capture.current?.stream) {
      if (preview.current.srcObject !== capture.current.stream)
        preview.current.srcObject = capture.current.stream;
      if (paused) preview.current.pause();
      else void preview.current.play().catch(() => {});
    }
  }, [page, active, paused]);
  const run = async (fn: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const openSession = async (s: Session) => {
    if (stoppingRef.current) return;
    if (activeRef.current && activeRef.current.id !== s.id)
      throw new Error(
        "Stop the active recording before opening another session.",
      );
    const sequence = ++openSequence.current;
    const [latest, list, trace] = await Promise.all([
      api<Session>(`/sessions/${s.id}`),
      api(`/sessions/${s.id}/events`),
      api(`/sessions/${s.id}/processing`),
    ]);
    let nextReport;
    try {
      nextReport =
        latest.status === "stopped"
          ? await api(`/sessions/${s.id}/report`)
          : undefined;
    } catch (error) {
      if (sequence === openSequence.current) {
        setSelected(latest);
        setNotes(latest.notes);
        setEvents(list);
        setProcessing(trace);
        setReport(undefined);
      }
      throw error;
    }
    if (sequence !== openSequence.current) return;
    setSelected(latest);
    setNotes(latest.notes);
    setEvents(list);
    setProcessing(trace);
    setReport(nextReport);
  };
  const stop = async (reason: "user" | "capture_ended" = "user") => {
    if (stopPromise.current) return stopPromise.current;
    const s = activeRef.current;
    if (!s) return;
    stoppingRef.current = true;
    openSequence.current++;
    pausedResult.current = undefined;
    const engine = capture.current;
    const capturedCount = engine?.capturedCount ?? 0;
    const hadPendingFrame = engine?.busy ?? false;
    activeRef.current = undefined;
    setActive(undefined);
    setPaused(false);
    setFinalizing(true);
    setError("");
    setNotice("");
    setSelected(s);
    setNotes(s.notes);
    setReport(undefined);
    setEvents([]);
    setProcessing([]);
    setAnalysis("Idle");
    setPage("Session reports");
    const video = engine
      ?.stop()
      .then((blob) => {
        if (!blob) return;
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = URL.createObjectURL(blob);
        setVideoUrl(urlRef.current);
        setVideoSession(s.id);
      })
      .catch(() => setNotice("The local video could not be saved."));
    if (hadPendingFrame)
      setNotice(
        "The report includes any frame the server was already analyzing.",
      );
    const work = (async () => {
      try {
        const r = await api(
          `/sessions/${s.id}/stop`,
          "POST",
          { reason, capturedCount },
          { retryTransport: true },
        );
        setReport(r);
        const stopped = { ...s, status: "stopped" as const };
        setSelected(stopped);
        setSessions((list) =>
          list.map((item) => (item.id === s.id ? stopped : item)),
        );
        setNotes(r.notes);
        const [findings, trace, listing] = await Promise.allSettled([
          api(`/sessions/${s.id}/events`),
          api(`/sessions/${s.id}/processing`),
          refresh(),
        ]);
        if (findings.status === "fulfilled") setEvents(findings.value);
        if (trace.status === "fulfilled") setProcessing(trace.value);
        if (
          [findings, trace, listing].some(
            (result) => result.status === "rejected",
          )
        )
          setNotice(
            "Your report was saved. Reopen the session to reload any missing details.",
          );
      } catch (e) {
        setError(
          "Screen sharing ended. Retry report finalization: " +
            (e as Error).message,
        );
      } finally {
        await video;
        setFinalizing(false);
        stoppingRef.current = false;
      }
    })();
    stopPromise.current = work;
    try {
      await work;
    } finally {
      stopPromise.current = undefined;
    }
  };
  stopRef.current = stop;
  const start = () => {
    if (
      !premium ||
      !consent ||
      starting.current ||
      stoppingRef.current ||
      activeRef.current
    )
      return;
    const plan = tradingPlanSchema.safeParse({
      strategy,
      dailyLossLimitPercent: dailyRisk === "" ? undefined : Number(dailyRisk),
      perTradeRiskLimitPercent:
        tradeRisk === "" ? undefined : Number(tradeRisk),
    });
    if (!plan.success) {
      setError(
        "Enter risk limits between 0.01% and 100%, or leave them blank.",
      );
      return;
    }
    starting.current = true;
    setCaptureError("");
    void run(async () => {
      const engine = new Capture();
      stoppingRef.current = false;
      failureCount.current = 0;
      openSequence.current++;
      capture.current = engine;
      let s: Session | undefined;
      let started = false;
      try {
        await engine.request();
        engine.onEnded = () => {
          setCaptureError("Screen sharing ended.");
          if (activeRef.current) void stopRef.current("capture_ended");
          else engine.cancel();
        };
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = "";
        setVideoUrl("");
        setVideoSession("");
        setCaptured(0);
        setAnalyzed(0);
        setAnalysis("Waiting for the first frame…");
        setLastLatency(null);
        setProcessing([]);
        setNotice("");
        setReviewFilter("all");
        s = await api("/sessions", "POST", {
          title: `Session · ${new Date().toLocaleDateString()}`,
          ...(strategy.trim() || dailyRisk || tradeRisk
            ? { tradingPlan: plan.data }
            : {}),
        });
        if (engine.signal.aborted)
          throw new Error("Screen sharing ended before the session started.");
        s = await api("/sessions/" + s!.id + "/start", "POST", {});
        started = true;
        if (engine.signal.aborted)
          throw new Error("Screen sharing ended during session setup.");
        activeRef.current = s;
        setActive(s);
        const startedSession = s!;
        setSessions((list) => [
          startedSession,
          ...list.filter((item) => item.id !== startedSession.id),
        ]);
        setConsent(false);
        setSelected(s);
        setEvents([]);
        setReport(undefined);
        setElapsed(0);
        setPage("Live coach");
        await engine.begin(
          s!.intervalSeconds,
          async (image, seconds, meta) => {
            setAnalysis("Analyzing frame…");
            try {
              const result = await api(
                `/sessions/${s!.id}/frames`,
                "POST",
                {
                  image,
                  timestampSeconds: seconds,
                  frameId: meta.frameId,
                  capturedCount: meta.capturedCount,
                  scenario,
                },
                {
                  signal: engine.signal,
                  retryTransport: true,
                  timeoutMs: (config.timeoutMs ?? 60000) + 10000,
                },
              );
              if (activeRef.current?.id !== s!.id || stoppingRef.current)
                return;
              failureCount.current = 0;
              setError("");
              const showResult = () => {
                setEvents((old) => [
                  ...old,
                  ...result.observations.filter(
                    (e: any) => !old.some((existing) => existing.id === e.id),
                  ),
                ]);
                setAnalyzed((count) => count + 1);
                setLastLatency(result.processing?.latencyMs ?? null);
                setAnalysis(
                  result.observations.length
                    ? "Frame analyzed"
                    : "Frame analyzed · no findings",
                );
              };
              if (engine.paused) {
                pausedResult.current = showResult;
                setAnalysis("Last frame ready");
              } else showResult();
            } catch (e) {
              if (engine.signal.aborted || stoppingRef.current) return;
              if (
                e instanceof ApiError &&
                ["ANALYSIS_INTERVAL", "ANALYSIS_BUSY"].includes(e.code ?? "")
              ) {
                setAnalysis("Waiting for the next frame");
                return;
              }
              setCaptureError((e as Error).message);
              if (
                e instanceof ApiError &&
                ["PREMIUM_REQUIRED", "AUTH_REQUIRED"].includes(e.code ?? "")
              ) {
                void stopRef.current();
                return;
              }
              setAnalysis("Analysis failed");
              failureCount.current++;
              if (
                (e instanceof ApiError &&
                  (e.fatal || e.code === "AI_BUDGET")) ||
                failureCount.current >= 3
              ) {
                if (!engine.paused) setPaused(engine.pause());
                setNotice(
                  "Analysis paused to avoid repeated failures. Fix the error, then resume or start a new session.",
                );
              }
              throw e;
            }
          },
          saveVideo,
          (message) => {
            setError(message);
            setCaptureError(message);
          },
          {
            captureIntervalSeconds:
              s!.captureIntervalSeconds ?? config.captureIntervalSeconds ?? 1,
            onCapture: setCaptured,
          },
        );
      } catch (e) {
        setCaptureError((e as Error).message);
        await engine.stop();
        if (s) {
          await api(
            "/sessions/" + s.id + (started ? "/stop" : ""),
            started ? "POST" : "DELETE",
            started ? {} : undefined,
          ).catch(() => {});
          activeRef.current = undefined;
          setActive(undefined);
        }
        throw e;
      } finally {
        starting.current = false;
      }
    });
  };
  const shown = active ?? selected;
  const currentSession = sessions.find((s) => s.id === shown?.id) ?? shown;
  const confirmed = events.filter((e) => e.status === "confirmed").length,
    unconfirmed = events.filter(
      (e) => !["confirmed", "dismissed"].includes(e.status),
    ).length;
  const feedback = async (e: any, status: string, correction?: string) => {
    await api(`/events/${e.id}/feedback`, "POST", {
      sessionId: e.sessionId,
      status,
      ...(correction === undefined ? {} : { correction }),
    });
    await openSession(shown!);
  };
  const eventCards = (limit = 100) =>
    events
      .filter(
        (e) =>
          page !== "Session reports" ||
          reviewFilter === "all" ||
          e.status === reviewFilter,
      )
      .slice(-limit)
      .reverse()
      .map((e) => (
        <article className="event" key={e.id}>
          <div className="event-top">
            <span className="event-icon">
              <ShieldCheck size={17} />
            </span>
            <span className="eyebrow">{e.category.replaceAll("_", " ")}</span>
            <time>{duration(e.timestampSeconds)}</time>
          </div>
          {e.simulated && <span className="badge mock">MOCK · SIMULATED</span>}
          <h4>{e.correction || e.observation}</h4>
          <p>{e.evidence}</p>
          <p className="muted">
            {e.limitations.join(" ")} · Uncertainty: {e.uncertainty}
          </p>
          <p className="muted">
            Assessment:{" "}
            {e.assessment?.replaceAll("_", " ") ?? "awaiting confirmation"}
            {e.latencyMs != null
              ? ` · ${(e.latencyMs / 1000).toFixed(1)}s processing`
              : ""}
            {e.completedAfterStop ? " · Completed after session ended" : ""}
          </p>
          {e.correction && <p>Original: {e.observation}</p>}
          {e.notes && <p>Review notes: {e.notes}</p>}
          <div className="evidence">
            Frame {e.frameId.slice(0, 8)} · {e.kind.replaceAll("_", " ")} ·{" "}
            {e.status.replaceAll("_", " ")}
          </div>
          <div className="actions">
            <button
              className="small"
              onClick={() => void run(() => feedback(e, "confirmed"))}
            >
              <Check size={13} />
              Confirm
            </button>
            <button
              className="small"
              onClick={() => void run(() => feedback(e, "dismissed"))}
            >
              <X size={13} />
              Dismiss
            </button>
            <button
              className="small"
              onClick={() => {
                const correction = window.prompt(
                  "Correct this observation",
                  e.correction ?? e.observation,
                );
                if (correction !== null)
                  void run(() => feedback(e, "needs_confirmation", correction));
              }}
            >
              Correct
            </button>
            <span className="muted">{e.history.length} revisions</span>
            <button
              className="small"
              onClick={() => {
                const value = window.prompt("Observation notes", e.notes ?? "");
                if (value !== null)
                  void run(async () => {
                    await api(`/events/${e.id}/feedback`, "POST", {
                      sessionId: e.sessionId,
                      status: e.status,
                      notes: value,
                    });
                    await openSession(shown!);
                  });
              }}
            >
              Add note
            </button>
          </div>
          <details className="history">
            <summary>Review history</summary>
            {e.history.length ? (
              e.history.map((revision: any, index: number) => (
                <p key={index}>
                  {new Date(revision.at).toLocaleString()} ·{" "}
                  {revision.previousStatus} → {revision.status}
                  {revision.correction !== undefined
                    ? ` · Correction: ${revision.correction}`
                    : ""}
                  {revision.notes !== undefined
                    ? ` · Notes: ${revision.notes}`
                    : ""}
                </p>
              ))
            ) : (
              <p>No user revisions yet.</p>
            )}
          </details>
        </article>
      ));
  return (
    <div className="app">
      <aside>
        <a
          className="brand"
          href="#"
          aria-label="Tradzyn overview"
          onClick={() => setPage("Overview")}
        >
          <BrandMark className="brand-icon" />
          <span className="brand-name">
            Trad<span>zyn</span>
          </span>
        </a>
        <div className="workspace">
          <span className="avatar">P</span>
          <div>
            Personal workspace<small>Trading performance coach</small>
          </div>
          <ChevronRight size={15} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {pages.map((p, i) => {
            const Icon = icons[i];
            return (
              <button
                key={p}
                aria-label={account && p === "Live coach" ? "AI Companion" : p}
                className={p === page ? "nav active" : "nav"}
                onClick={() => {
                  setPage(p);
                  if (p === "Session reports" && !selected && sessions[0])
                    void run(() => openSession(sessions[0]));
                }}
              >
                <Icon size={19} />
                {account && p === "Live coach" ? "AI Companion" : p}
                {p === "Live coach" && (
                  <span className={"nav-dot " + (active ? "green" : "")} />
                )}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="badge mock">
              {!config
                ? "CONNECTING"
                : !config.simulated
                  ? "LIVE ANALYSIS"
                  : "MOCK MODE"}
            </span>
            <p>
              {config && !config.simulated
                ? "AI coaching is active"
                : "Practice the workflow safely"}
            </p>
            <small>
              {config && !config.simulated
                ? "Live integration · verify all findings"
                : "Simulated coaching for practice."}
            </small>
            <button onClick={() => setPage("Settings")}>
              Manage settings <ArrowUpRight size={14} />
            </button>
          </div>
          <div className="profile">
            <span className="avatar">LT</span>
            <div>
              {account?.name ?? "Local trader"}
              <small>Personal workspace</small>
            </div>
            <Settings size={16} />
          </div>
        </div>
      </aside>
      <main>
        <header>
          <div className="breadcrumbs">
            Workspace <ChevronRight size={13} />
            <span>{page}</span>
          </div>
          <div className="header-status">
            <span className="dot green" />
            {account?.name ?? "Local workspace"}
            <span className="avatar">LT</span>
          </div>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow accent">YOUR EDGE IS IN YOUR PROCESS</div>
              <h1>
                {page === "Overview"
                  ? account
                    ? "Performance dashboard"
                    : "A clearer view of your trading."
                  : page === "Live coach"
                    ? "Stay present. Trade with intention."
                    : page === "Session reports"
                      ? "Reflect. Refine. Repeat."
                      : page === "Trading journal"
                        ? "Trading journal"
                        : "Your workspace, your control."}
              </h1>
              <p>
                {page === "Overview"
                  ? "Build better habits with evidence, reflection, and a little perspective."
                  : page === "Live coach"
                    ? "Capture your process and review observations as they arrive."
                    : page === "Session reports"
                      ? "Review the evidence and add the context only you can provide."
                      : page === "Trading journal"
                        ? "Record what you expected, what happened, and what you learned."
                        : "Configure analysis, privacy, and data retention."}
              </p>
            </div>
            <span className="date">
              <Clock3 size={15} />
              {new Date().toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
          {error && (
            <div role="alert" className="alert">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {loading && <p role="status">Loading your workspace…</p>}
          {config?.deploymentMode === "hosted_demo" && (
            <p className="notice" role="status">
              {config.privacyNotice}
              {config.ephemeralStorage
                ? " Demo data may be erased whenever the host sleeps, restarts or redeploys. Export reports before leaving."
                : ""}
            </p>
          )}
          {notice && (
            <p role="status" className="notice">
              {notice}
            </p>
          )}
          {((!account && page === "Overview") ||
            (premium && page === "Live coach")) && (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <span className="badge">
                    <span className={"dot " + (active ? "green" : "")} />
                    {active
                      ? paused
                        ? "CAPTURE PAUSED"
                        : "SESSION LIVE"
                      : "READY WHEN YOU ARE"}
                  </span>
                  <h2>
                    {active
                      ? "Focus on the process."
                      : "A better session starts\nwith awareness."}
                  </h2>
                  <p>
                    Your personal coach for reflecting on visible trading
                    activity. Capture a session, notice patterns, and make your
                    next one more intentional.
                  </p>
                  <div className="hero-buttons">
                    <button
                      className="primary"
                      disabled={busy || !config}
                      onClick={() =>
                        active ? setPage("Live coach") : setPage("Live coach")
                      }
                    >
                      <Play size={15} />
                      {active ? "Open live session" : "Set up a session"}
                      <ArrowUpRight size={17} />
                    </button>
                    <span>
                      <ShieldCheck size={15} />
                      You control what’s shared
                    </span>
                  </div>
                </div>
                <div className="process-art" aria-hidden="true">
                  <div className="art-grid" />
                  <div className="orbit orbit-one" />
                  <div className="orbit orbit-two" />
                  <div className="focus-icon">
                    <Focus size={50} strokeWidth={1} />
                  </div>
                  <span className="art-chip chip-one">
                    <Circle size={10} /> Observe your process
                  </span>
                  <span className="art-chip chip-two">
                    <Check size={13} /> Reflect with evidence
                  </span>
                  <svg className="art-line" viewBox="0 0 300 100">
                    <path d="M0 85 L30 70 L55 75 L85 48 L110 58 L140 30 L165 42 L195 20 L225 28 L260 2" />
                  </svg>
                </div>
              </section>
              <div className="stats">
                {[
                  [
                    Clock3,
                    "Session duration",
                    duration(active ? elapsed : (report?.durationSeconds ?? 0)),
                    active
                      ? "Wall-clock elapsed"
                      : "Current or reviewed session",
                  ],
                  [
                    Monitor,
                    "Frames captured",
                    String(
                      active
                        ? captured
                        : (currentSession?.capturedFrames ??
                            currentSession?.attempts ??
                            0),
                    ),
                    active
                      ? `${analyzed} analyzed`
                      : `${currentSession?.frames ?? 0} analyzed · ${currentSession?.failedFrames ?? 0} failed`,
                  ],
                  [
                    Activity,
                    "Observations",
                    String(events.length),
                    config?.simulated
                      ? "Simulated in mock mode"
                      : "Evidence requires review",
                  ],
                  [
                    ShieldCheck,
                    "Reviewed findings",
                    `${confirmed} / ${events.length}`,
                    `${unconfirmed} awaiting your review`,
                  ],
                ].map(([Icon, label, value, sub]: any) => (
                  <div className="stat" key={label}>
                    <div>
                      <span>{label}</span>
                      <Icon size={17} />
                    </div>
                    <strong>{value}</strong>
                    <small>{sub}</small>
                  </div>
                ))}
              </div>
            </>
          )}
          {active && page !== "Live coach" && (
            <div className="notice live-status" role="status">
              <span className="dot green" />{" "}
              {paused
                ? "Capture paused · screen still shared"
                : "Screen sharing active"}{" "}
              · {duration(elapsed)}
              <button className="danger" onClick={() => void stopRef.current()}>
                Stop recording
              </button>
            </div>
          )}
          {page === "Live coach" && premium && (
            <div className="two-col">
              <section className="panel">
                <div className="panel-heading">
                  <h3>
                    <Monitor size={18} />
                    Screen capture
                  </h3>
                  <span className="badge">
                    {active ? (paused ? "PAUSED" : "RECORDING") : "INACTIVE"}
                  </span>
                </div>
                <div className="preview">
                  {active ? (
                    <video
                      ref={preview}
                      muted
                      playsInline
                      aria-label="Shared screen preview"
                    />
                  ) : (
                    <>
                      <Monitor size={40} />
                      <h3>Your screen, your choice.</h3>
                      <p>
                        Select a demo window or trading screen using your
                        browser’s native picker.
                      </p>
                    </>
                  )}
                </div>
                <div className="capture-controls">
                  {import.meta.env.DEV && (
                    <details className="processing capture-diagnostics">
                      <summary>Capture diagnostics</summary>
                      <p>
                        Secure context: {window.isSecureContext ? "yes" : "no"}{" "}
                        · Screen sharing API:{" "}
                        {navigator.mediaDevices &&
                        "getDisplayMedia" in navigator.mediaDevices
                          ? "available"
                          : "unavailable"}{" "}
                        · MediaRecorder:{" "}
                        {typeof MediaRecorder === "undefined"
                          ? "unavailable"
                          : "available"}
                      </p>
                      <p>
                        Sharing:{" "}
                        {active
                          ? paused
                            ? "paused"
                            : "active"
                          : starting.current
                            ? "starting"
                            : "inactive"}{" "}
                        · Session: {currentSession?.status ?? "none"} · Frames:{" "}
                        {captured} · Processing: {analysis} · Latency:{" "}
                        {lastLatency === null ? "none" : lastLatency + " ms"}
                      </p>
                      <p>Latest error: {captureError || "none"}</p>
                    </details>
                  )}
                  {!active ? (
                    <>
                      <fieldset
                        className="recording-plan"
                        disabled={busy || finalizing}
                      >
                        <legend>Trading plan</legend>
                        <p>
                          Set your own limits before sharing. The AI Companion
                          checks daily loss first, then risk per trade.
                        </p>
                        <label>
                          Strategy and session notes
                          <textarea
                            value={strategy}
                            maxLength={2000}
                            placeholder="Example: Wait for a candle to close. Check my daily loss before evaluating another trade."
                            onChange={(event) =>
                              setStrategy(event.target.value)
                            }
                          />
                        </label>
                        <label>
                          Daily loss limit (% of account equity)
                          <input
                            type="number"
                            min="0.01"
                            max="100"
                            step="any"
                            value={dailyRisk}
                            placeholder="Example: 2"
                            onChange={(event) =>
                              setDailyRisk(event.target.value)
                            }
                          />
                        </label>
                        <label>
                          Risk limit per trade (% of account equity)
                          <input
                            type="number"
                            min="0.01"
                            max="100"
                            step="any"
                            value={tradeRisk}
                            placeholder="Example: 0.5"
                            onChange={(event) =>
                              setTradeRisk(event.target.value)
                            }
                          />
                        </label>
                        <p className="muted">
                          All fields are optional. For live analysis, your plan
                          is sent with the selected screen frames.
                        </p>
                      </fieldset>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={consent}
                          onChange={(e) => setConsent(e.target.checked)}
                        />
                        I consent to screen capture. Selected screenshots{" "}
                        {config?.simulated
                          ? config?.deploymentMode === "hosted_demo"
                            ? "will be sent to the demo server for simulated processing"
                            : "are processed locally for this demo"
                          : "will be sent to the AI service for analysis"}
                        . Screens may contain private account information.
                      </label>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={saveVideo}
                          onChange={(e) => setSaveVideo(e.target.checked)}
                        />
                        Keep a local downloadable video in memory (100 MB
                        maximum). No server upload.
                      </label>
                      {config?.simulated && (
                        <label>
                          Mock scenario
                          <select
                            value={scenario}
                            onChange={(e) => setScenario(e.target.value)}
                          >
                            <option value="normal">Normal observation</option>
                            <option value="deviation">
                              Possible behavior to review
                            </option>
                            <option value="insufficient">
                              Insufficient evidence
                            </option>
                            <option value="error">Provider failure</option>
                            <option value="timeout">Analysis timeout</option>
                          </select>
                        </label>
                      )}
                      <button
                        className="primary"
                        disabled={!consent || busy || finalizing || !config}
                        onClick={start}
                      >
                        <Play size={16} />
                        Start recording
                      </button>
                    </>
                  ) : (
                    <>
                      <SavedTradingPlan plan={active.tradingPlan} />
                      <div className="live-status">
                        <span className="dot green" />
                        {paused
                          ? "Capture paused · screen still shared"
                          : "Screen sharing active"}
                        <strong aria-label="Elapsed session time">
                          {duration(elapsed)}
                        </strong>
                      </div>
                      <p className="muted">
                        AI status: {paused ? "Paused" : analysis} ·{" "}
                        {active.intervalSeconds}s interval ·{" "}
                        {config?.simulated
                          ? "MOCK · SIMULATED"
                          : "Live analysis"}
                      </p>
                      <p className="muted">
                        {captured} frames captured · {analyzed} analyzed
                        {lastLatency !== null
                          ? ` · Last analysis ${(lastLatency / 1000).toFixed(1)}s`
                          : ""}
                        . Busy intervals are skipped.
                      </p>
                      {paused && (
                        <p role="status" className="muted">
                          Preview and frame capture are paused.{" "}
                          {analysis === "Analyzing frame…" ||
                          pausedResult.current
                            ? "The last submitted frame will appear when you resume or open the report."
                            : "Resume to capture new frames."}
                        </p>
                      )}
                      {analysis === "Analysis failed" && error && (
                        <p className="notice" aria-live="polite">
                          {error}
                        </p>
                      )}
                      <div className="actions">
                        <button
                          onClick={() => {
                            const isPaused = capture.current!.pause();
                            setPaused(isPaused);
                            if (!isPaused) {
                              pausedResult.current?.();
                              pausedResult.current = undefined;
                            }
                            setNotice("");
                            failureCount.current = 0;
                          }}
                        >
                          <Pause size={15} />
                          {paused ? "Resume" : "Pause"}
                        </button>
                        <button className="danger" onClick={() => void stop()}>
                          <Square size={14} />
                          Stop & generate report
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <h3>Live suggestions</h3>
                  <span className="badge mock">
                    {config?.simulated
                      ? "MOCK · SIMULATED"
                      : "AI · REVIEW REQUIRED"}
                  </span>
                </div>
                {events.length ? (
                  eventCards(6)
                ) : (
                  <Empty
                    icon={Activity}
                    title="A little perspective, in real time"
                    text="Observations appear after a captured frame is analyzed. Missing information is never proof of a rule violation."
                  />
                )}
              </section>
            </div>
          )}
          {page === "Overview" && !account && (
            <>
              <div className="two-col">
                <section className="panel">
                  <div className="panel-heading">
                    <h3>Session activity</h3>
                    <span className="muted">
                      Frames analyzed · recent sessions
                    </span>
                  </div>
                  {sessions.some((s) => s.frames > 0) ? (
                    <div className="chart">
                      <ResponsiveContainer width="100%" height={220}>
                        <AreaChart
                          data={sessions
                            .slice(0, 10)
                            .reverse()
                            .map((s, i) => ({
                              name: `S${i + 1}`,
                              frames: s.frames,
                            }))}
                        >
                          <defs>
                            <linearGradient
                              id="fill"
                              x1="0"
                              y1="0"
                              x2="0"
                              y2="1"
                            >
                              <stop
                                offset="0%"
                                stopColor="#FF1738"
                                stopOpacity={0.25}
                              />
                              <stop
                                offset="100%"
                                stopColor="#FF1738"
                                stopOpacity={0}
                              />
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} stroke="#252c35" />
                          <XAxis
                            dataKey="name"
                            stroke="#77818e"
                            tickLine={false}
                            axisLine={false}
                          />
                          <YAxis
                            allowDecimals={false}
                            stroke="#77818e"
                            tickLine={false}
                            axisLine={false}
                          />
                          <Tooltip
                            contentStyle={{
                              background: "#19212c",
                              border: "1px solid #344051",
                            }}
                          />
                          <Area
                            type="monotone"
                            dataKey="frames"
                            stroke="#FF1738"
                            fill="url(#fill)"
                            strokeWidth={2}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <Empty
                      icon={BarChart3}
                      title="Your process has a story to tell"
                      text="Session activity will appear here after your first recording. No performance data is assumed."
                    />
                  )}
                  <div className="panel-foot">
                    <span className="dot green" />
                    Activity reflects recorded sessions only
                  </div>
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <h3>Coach’s perspective</h3>
                    <span className="badge mock">
                      {!config
                        ? "CONNECTING"
                        : config.simulated
                          ? "MOCK MODE"
                          : "LIVE ANALYSIS"}
                    </span>
                  </div>
                  {events.length ? (
                    eventCards(1)
                  ) : (
                    <div className="perspective">
                      <span className="quote">“</span>
                      <h2>
                        Consistency starts
                        <br />
                        with noticing.
                      </h2>
                      <p>
                        Record a session to bring your process into focus. Your
                        coach will help you reflect on what’s visible and flag
                        what needs your confirmation.
                      </p>
                      <button
                        className="text-button"
                        onClick={() => setPage("Live coach")}
                      >
                        Meet your live coach <ArrowUpRight size={16} />
                      </button>
                    </div>
                  )}
                </section>
              </div>
              <SessionList
                sessions={sessions}
                onOpen={(s) =>
                  void run(async () => {
                    await openSession(s);
                    setPage("Session reports");
                  })
                }
              />
              <div className="privacy-footer">
                <ShieldCheck size={16} />
                <span>
                  Built for reflection. No trading signals, price predictions,
                  or trade execution.
                </span>
                <button
                  className="text-button"
                  onClick={() => setPage("Settings")}
                >
                  Privacy & data <ArrowUpRight size={13} />
                </button>
              </div>
            </>
          )}
          {page === "Session reports" && premium && (
            <>
              <SessionList
                sessions={sessions}
                onOpen={(s) => void run(() => openSession(s))}
              />
              {selected && (
                <section className="panel report">
                  <div className="panel-heading">
                    <h3>{selected.title}</h3>
                    <div className="actions">
                      <button
                        className="small"
                        disabled={!report || busy}
                        onClick={() =>
                          void run(() => exportReport(selected.id, "json"))
                        }
                      >
                        Export JSON
                      </button>
                      <button
                        className="small"
                        disabled={!report || busy}
                        onClick={() =>
                          void run(() => exportReport(selected.id, "csv"))
                        }
                      >
                        Export CSV
                      </button>
                      <span className="badge mock">
                        {selected.mode === "mock"
                          ? "MOCK · SIMULATED REPORT"
                          : "AI · REVIEW REQUIRED"}
                      </span>
                      <button
                        className="small danger"
                        disabled={busy || selected.status === "recording"}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Delete this session, report and all correction history?",
                            )
                          )
                            void run(async () => {
                              await api(`/sessions/${selected.id}`, "DELETE");
                              openSequence.current++;
                              setSelected(undefined);
                              setEvents([]);
                              setReport(undefined);
                              await refresh();
                            });
                        }}
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </div>
                  </div>
                  {report ? (
                    <>
                      <SavedTradingPlan plan={selected.tradingPlan} />
                      <div className="report-stats">
                        <span>
                          Frames captured
                          <strong>
                            {report.framesCaptured ?? report.framesSubmitted}
                          </strong>
                        </span>
                        <span>
                          Duration{" "}
                          <strong>{duration(report.durationSeconds)}</strong>
                        </span>
                        <span>
                          Frames analyzed{" "}
                          <strong>{report.framesAnalyzed}</strong>
                        </span>
                        <span>
                          Confirmed <strong>{report.confirmed.length}</strong>
                        </span>
                        <span>
                          Unconfirmed{" "}
                          <strong>{report.unconfirmed.length}</strong>
                        </span>
                        <span>
                          Dismissed <strong>{report.dismissed.length}</strong>
                        </span>
                        <span>
                          Failed analyses <strong>{report.failedFrames}</strong>
                        </span>
                      </div>
                      <p className="muted">
                        Started:{" "}
                        {report.startedAt
                          ? new Date(report.startedAt).toLocaleString()
                          : "Unknown"}{" "}
                        · Ended:{" "}
                        {report.endedAt
                          ? new Date(report.endedAt).toLocaleString()
                          : "Unknown"}{" "}
                        · End reason:{" "}
                        {report.endReason?.replaceAll("_", " ") ?? "user"}
                      </p>
                      <p className="muted">
                        Processing latency:{" "}
                        {report.latency?.averageMs != null
                          ? `${(report.latency.averageMs / 1000).toFixed(1)}s average, ${(report.latency.maxMs / 1000).toFixed(1)}s maximum`
                          : "No processing samples"}{" "}
                        · {report.framesSubmitted ?? 0} submitted ·{" "}
                        {report.pendingFrames ?? 0} pending
                      </p>
                      <h4>Suggested improvements</h4>
                      {report.improvements.map((s: string) => (
                        <p key={s}>{s}</p>
                      ))}
                      <p className="notice">{report.limitations.join(" ")}</p>
                    </>
                  ) : finalizing ? (
                    <p className="notice" role="status">
                      Screen sharing ended. Preparing your report…
                    </p>
                  ) : (
                    <div className="notice">
                      <p>
                        {selected.status === "created"
                          ? "This session never started. You can delete it."
                          : selected.status === "stopped"
                            ? "Report is unavailable. Retry generation from saved observations."
                            : "This session has not ended. A vanished screen stream cannot be resumed."}
                      </p>
                      {!active && selected.status !== "created" && (
                        <button
                          className="small"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              if (selected.status !== "stopped")
                                await api(
                                  `/sessions/${selected.id}/stop`,
                                  "POST",
                                  {},
                                );
                              await openSession({
                                ...selected,
                                status: "stopped",
                              });
                              await refresh();
                            })
                          }
                        >
                          Retry finalization / report
                        </button>
                      )}
                    </div>
                  )}
                  <label>
                    Session notes
                    <textarea
                      value={notes}
                      disabled={finalizing}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Add context, corrections, or your next-session intention…"
                    />
                  </label>
                  <button
                    className="small"
                    disabled={busy || finalizing}
                    onClick={() =>
                      void run(async () => {
                        await api(`/sessions/${selected.id}`, "PATCH", {
                          notes,
                        });
                        await refresh();
                        await openSession({ ...selected, notes });
                      })
                    }
                  >
                    Save notes
                  </button>
                  {videoUrl && videoSession === selected.id && (
                    <a
                      className="download"
                      href={videoUrl}
                      download="tradelens-session.webm"
                    >
                      Download opt-in local video
                    </a>
                  )}
                  <h3 className="section-title">Evidence timeline</h3>
                  <label>
                    Filter findings
                    <select
                      value={reviewFilter}
                      onChange={(e) => setReviewFilter(e.target.value)}
                    >
                      <option value="all">All findings</option>
                      <option value="confirmed">Confirmed by user</option>
                      <option value="dismissed">Dismissed by user</option>
                      <option value="needs_confirmation">
                        Needs confirmation
                      </option>
                      <option value="insufficient_evidence">
                        Insufficient evidence
                      </option>
                    </select>
                  </label>
                  {events.length ? (
                    eventCards()
                  ) : (
                    <Empty
                      icon={Activity}
                      title="No observations recorded"
                      text="No conclusions can be drawn from this session."
                    />
                  )}
                  {events.length > 0 && eventCards().length === 0 && (
                    <p>No findings match this filter.</p>
                  )}
                  <details className="processing">
                    <summary>
                      Frame processing history ({processing.length})
                    </summary>
                    <p>
                      Evidence images are transient and cannot be reopened. Late
                      results are report findings, not live suggestions.
                    </p>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>FRAME TIME</th>
                            <th>RESULT</th>
                            <th>LATENCY</th>
                            <th>DETAILS</th>
                          </tr>
                        </thead>
                        <tbody>
                          {processing.map((frame) => (
                            <tr key={frame.id}>
                              <td>{duration(frame.timestampSeconds)}</td>
                              <td>{frame.status}</td>
                              <td>
                                {frame.latencyMs == null
                                  ? "—"
                                  : `${(frame.latencyMs / 1000).toFixed(1)}s`}
                              </td>
                              <td>
                                {frame.error ??
                                  (frame.completedAfterStop
                                    ? "Completed after stop"
                                    : "Completed during session")}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!processing.length && (
                      <p>
                        No frame ledger is available for this session (legacy
                        sessions may only have event records).
                      </p>
                    )}
                  </details>
                  {report && (
                    <details className="processing">
                      <summary>Recurring observations</summary>
                      <h4>Repeated recorded observations</h4>
                      <p>
                        Counts describe repeated finding text within this
                        session, not proven repeated trades.
                      </p>
                      {report.recurringObservations?.map(
                        (item: any, index: number) => (
                          <p key={index}>
                            {item.observation} · {item.count} occurrences at{" "}
                            {item.timestamps.map(duration).join(", ")}
                          </p>
                        ),
                      )}
                    </details>
                  )}
                </section>
              )}
            </>
          )}
          {account && (page === "Overview" || page === "Trading journal") && (
            <Journal
              dashboard={page === "Overview"}
              addOnOpen={addJournal}
              onOpened={() => setAddJournal(false)}
              onJournal={(add) => {
                setAddJournal(Boolean(add));
                setPage("Trading journal");
              }}
              onCompanion={() => setPage("Live coach")}
            />
          )}
          {!premium &&
            (page === "Live coach" || page === "Session reports") && (
              <section className="panel settings">
                <span className="badge mock">PREMIUM</span>
                <h3>AI Screen Recording Companion</h3>
                <p>
                  Share a selected screen, review observations, and save session
                  reports with an active Premium subscription.
                </p>
                <button className="primary" onClick={() => setPage("Settings")}>
                  View subscription
                </button>
              </section>
            )}
          {page === "Settings" && account && logout && (
            <AccountSettings
              profile={account}
              subscription={subscription}
              logout={() => {
                void stopRef.current().finally(logout);
              }}
            />
          )}
          {page === "Settings" && config && (
            <div className="two-col">
              <section className="panel settings">
                <h3>Analysis preferences</h3>
                <span className="badge mock">
                  {config.simulated ? "MOCK · SIMULATED" : "LIVE ANALYSIS"}
                </span>
                <p>
                  {config.simulated
                    ? "Demo observations are simulated."
                    : "Review AI observations before relying on them."}
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const data = new FormData(e.currentTarget);
                    void run(async () => {
                      await api("/settings", "PUT", {
                        intervalSeconds: Number(data.get("interval")),
                        retentionDays: Number(data.get("retention")),
                        captureIntervalSeconds: Number(
                          data.get("captureInterval"),
                        ),
                      });
                      await refresh();
                    });
                  }}
                >
                  <label>
                    Analysis interval (seconds)
                    <input
                      name="interval"
                      type="number"
                      min={5}
                      max={120}
                      required
                      defaultValue={config.intervalSeconds}
                    />
                  </label>
                  <p className="muted">
                    Applies to new sessions. Actual latency depends on network,
                    model response time, and rate limits.
                  </p>
                  <label>
                    Capture interval (seconds)
                    <input
                      name="captureInterval"
                      type="number"
                      min={1}
                      max={30}
                      required
                      defaultValue={config.captureIntervalSeconds ?? 1}
                    />
                  </label>
                  <label>
                    Retention (days)
                    <input
                      name="retention"
                      type="number"
                      min={1}
                      max={365}
                      required
                      defaultValue={config.retentionDays}
                    />
                  </label>
                  <button className="primary small" disabled={busy}>
                    Save preferences
                  </button>
                </form>
                <button
                  className="small"
                  onClick={() =>
                    void run(async () => {
                      const result = await api(
                        "/retention/cleanup",
                        "POST",
                        {},
                      );
                      await refresh();
                      setAnalysis(`${result.deleted} expired sessions deleted`);
                    })
                  }
                >
                  Delete expired sessions now
                </button>
                <p className="muted">
                  {analysis === "Idle"
                    ? "Retention cleanup runs only when you request it."
                    : analysis}
                </p>
                <p>
                  Sessions, notes, corrections and reports persist in your
                  account. Frames are transient. Full videos are never stored on
                  the server.
                </p>
              </section>
              <section className="panel settings">
                <h3>Privacy & consent</h3>
                <p>
                  Capture starts only after you click Start recording and choose
                  a source in your browser. Select a demo window to avoid
                  exposing account numbers, balances, names, or private
                  information.
                </p>
                <p>
                  During live analysis, selected screenshots are sent to an AI
                  service. The service may retain data under its privacy policy.
                </p>
              </section>
            </div>
          )}
          <footer>
            <span className="brand-mini">
              <BrandMark />
              Tradzyn
            </span>
            <span>A little more awareness. A better trading process.</span>
            <span>
              {config?.deploymentMode === "hosted_demo"
                ? "HOSTED DEMO · MOCK"
                : "LOCAL MVP · v1.0"}
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}
