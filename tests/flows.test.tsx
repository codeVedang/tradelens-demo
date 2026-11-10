// @vitest-environment jsdom
import React from "react";
import { afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import App from "../src/App";
import { Capture } from "../src/capture";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function service() {
  let rules: any[] = [],
    sessions: any[] = [];
  const events: any[] = [];
  const trace: any[] = [];
  const config = {
    provider: "mock",
    simulated: true,
    model: "test-fixture",
    connectionStatus: "unverified",
    intervalSeconds: 5,
    captureIntervalSeconds: 1,
    retentionDays: 30,
  };
  const report = () => ({
    id: sessions[0]?.id,
    notes: sessions[0]?.notes ?? "",
    durationSeconds: 10,
    framesAnalyzed: events.length,
    framesCaptured: 1,
    failedFrames: 0,
    confirmed: events.filter((e) => e.status === "confirmed"),
    dismissed: events.filter((e) => e.status === "dismissed"),
    unconfirmed: events.filter((e) => e.status === "needs_confirmation"),
    improvements: ["Review your checklist."],
    limitations: ["Simulated test."],
    potentialRuleViolations: [],
    processing: trace,
    rules: [],
    recurringObservations: [],
  });
  const fetcher = vi.fn(async (url: string, options: any = {}) => {
    const path = url.replace("/api", ""),
      method = options.method ?? "GET",
      body = options.body ? JSON.parse(options.body) : {};
    let output: any = [];
    if (path === "/config/status") output = config;
    else if (path === "/settings") {
      Object.assign(config, body);
      output = config;
    } else if (path === "/rules") {
      if (method === "POST") {
        const r = { ...body, id: "rule-1", version: 1 };
        rules.push(r);
        output = r;
      } else output = rules;
    } else if (path.startsWith("/rules/")) {
      if (method === "DELETE") rules = [];
      else
        rules = rules.map((r) => ({ ...r, ...body, version: r.version + 1 }));
      output = rules[0];
    } else if (path === "/sessions") {
      if (method === "POST") {
        const s = {
          id: "session-1",
          title: body.title,
          status: "created",
          createdAt: new Date().toISOString(),
          startedAt: null,
          endedAt: null,
          frames: 0,
          attempts: 0,
          failedFrames: 0,
          notes: "",
          mode: "mock",
          intervalSeconds: 5,
        };
        sessions.push(s);
        output = s;
      } else output = sessions;
    } else if (path.endsWith("/start")) {
      Object.assign(sessions[0], {
        status: "recording",
        startedAt: new Date().toISOString(),
      });
      output = sessions[0];
    } else if (path.endsWith("/frames")) {
      events.push({
        id: "event-1",
        sessionId: "session-1",
        frameId: "frame-1",
        category: "session_discipline",
        observation: "SIMULATED: Review checklist",
        evidence: "Test fixture only",
        timestampSeconds: 0,
        status: "needs_confirmation",
        confidence: null,
        uncertainty: "unknown",
        kind: "unknown",
        assessment: "not_assessable",
        simulated: true,
        limitations: ["Simulated"],
        history: [],
        notes: "",
      });
      sessions[0].frames = 1;
      output = { observations: events, processing: { latencyMs: 50 } };
    } else if (path.endsWith("/stop")) {
      sessions[0].status = "stopped";
      sessions[0].endedAt = new Date().toISOString();
      output = report();
    } else if (path.endsWith("/feedback")) {
      events[0] = {
        ...events[0],
        ...body,
        history: [
          {
            at: new Date().toISOString(),
            previousStatus: events[0].status,
            ...body,
          },
        ],
      };
      output = events[0];
    } else if (path.endsWith("/report")) output = report();
    else if (path.endsWith("/events")) output = events;
    else if (path.endsWith("/processing")) output = trace;
    else if (path.startsWith("/sessions/")) {
      if (method === "PATCH") Object.assign(sessions[0], body);
      output = sessions[0];
    }
    return {
      ok: true,
      status: method === "DELETE" ? 204 : 200,
      json: async () => structuredClone(output),
    };
  });
  vi.stubGlobal("fetch", fetcher);
  URL.revokeObjectURL = vi.fn();
  return {
    fetcher,
    config,
    getRules: () => rules,
    getSessions: () => sessions,
  };
}
it("runs a mocked browser capture through live observations, pause/resume, report review and saved notes", async () => {
  const svc = service();
  vi.spyOn(Capture.prototype, "request").mockResolvedValue({} as MediaStream);
  vi.spyOn(Capture.prototype, "begin").mockImplementation(async function (
    this: Capture,
    _interval,
    send,
    _save,
    _error,
    options,
  ) {
    this.capturedCount = 1;
    options?.onCapture?.(1);
    await send("data:image/jpeg;base64,/9j/2Q==", 0, {
      frameId: "frame-1",
      capturedCount: 1,
    });
  });
  vi.spyOn(Capture.prototype, "stop").mockResolvedValue(undefined);
  vi.spyOn(Capture.prototype, "cancel").mockImplementation(() => {});
  render(<App />);
  await screen.findAllByText("MOCK MODE");
  fireEvent.click(screen.getByRole("button", { name: "Live coach" }));
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
  await screen.findByText("SIMULATED: Review checklist");
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Stop & generate report" }),
  );
  await screen.findByText("Suggested improvements");
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await waitFor(() =>
    expect(
      screen.getByText(/confirmed/, { selector: ".evidence" }),
    ).toBeInTheDocument(),
  );
  fireEvent.change(screen.getByLabelText("Session notes"), {
    target: { value: "Follow up tomorrow" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save notes" }));
  await waitFor(() =>
    expect(svc.getSessions()[0].notes).toBe("Follow up tomorrow"),
  );
  fireEvent.change(screen.getByLabelText("Filter findings"), {
    target: { value: "dismissed" },
  });
  expect(
    screen.getByText("No findings match this filter."),
  ).toBeInTheDocument();
});
it("holds a late finding during pause and ends sharing while the report is pending", async () => {
  const svc = service();
  let finishFrame!: () => void;
  let finishStop!: () => void;
  const framePending = new Promise<void>((resolve) => {
    finishFrame = resolve;
  });
  const stopPending = new Promise<void>((resolve) => {
    finishStop = resolve;
  });
  vi.stubGlobal("fetch", async (url: string, options?: RequestInit) => {
    if (url.endsWith("/frames")) await framePending;
    if (url.endsWith("/stop")) await stopPending;
    if (url.endsWith("/processing"))
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: "Unavailable" }),
      };
    return svc.fetcher(url, options);
  });
  vi.spyOn(Capture.prototype, "request").mockResolvedValue({} as MediaStream);
  vi.spyOn(Capture.prototype, "begin").mockImplementation(
    async (_interval, send) => {
      void send("data:image/jpeg;base64,/9j/2Q==", 0, {
        frameId: "frame-1",
        capturedCount: 1,
      });
    },
  );
  const stopCapture = vi
    .spyOn(Capture.prototype, "stop")
    .mockResolvedValue(undefined);
  render(<App />);
  await screen.findAllByText("MOCK MODE");
  fireEvent.click(screen.getByRole("button", { name: "Live coach" }));
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
  await screen.findByText(/AI status: Analyzing frame/);
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  await act(async () => finishFrame());
  expect(screen.queryByText("SIMULATED: Review checklist")).toBeNull();
  expect(screen.getByText(/AI status: Paused/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  await screen.findByText("SIMULATED: Review checklist");
  fireEvent.click(
    screen.getByRole("button", { name: "Stop & generate report" }),
  );
  expect(stopCapture).toHaveBeenCalledOnce();
  expect(screen.queryByText("Screen sharing active")).toBeNull();
  expect(
    screen.getByText(/Screen sharing ended. Preparing your report/),
  ).toBeVisible();
  await act(async () => finishStop());
  await screen.findByText("Suggested improvements");
  expect(screen.getByRole("button", { name: "Export JSON" })).toBeEnabled();
  expect(screen.getByText(/Your report was saved/)).toBeVisible();
});
it("persists both intervals via settings and rejects no UI state on success", async () => {
  const svc = service();
  render(<App />);
  await screen.findAllByText("MOCK MODE");
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.change(screen.getByLabelText("Analysis interval (seconds)"), {
    target: { value: "15" },
  });
  fireEvent.change(screen.getByLabelText("Capture interval (seconds)"), {
    target: { value: "2" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
  await waitFor(() => expect(svc.config.intervalSeconds).toBe(15));
  expect(svc.config.captureIntervalSeconds).toBe(2);
});
