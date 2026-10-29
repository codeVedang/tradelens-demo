// @vitest-environment jsdom
import React from "react";
import { afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
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
it("creates structured rules, edits and disables them, and deletes a rule", async () => {
  const svc = service();
  render(<App />);
  await screen.findAllByText("MOCK MODE");
  fireEvent.click(screen.getByRole("button", { name: "Strategy & rules" }));
  fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
  fireEvent.change(screen.getByLabelText("Rule name"), {
    target: { value: "Risk checklist" },
  });
  fireEvent.change(screen.getByLabelText("Rule category"), {
    target: { value: "max_risk" },
  });
  fireEvent.change(screen.getByLabelText("Numeric limit (optional)"), {
    target: { value: "1" },
  });
  fireEvent.change(screen.getByLabelText("Requirement"), {
    target: { value: "Review configured risk" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save rule" }));
  await screen.findByText("Risk checklist");
  expect(svc.getRules()[0].numericLimit).toBe(1);
  fireEvent.click(
    screen.getByRole("button", { name: "Disable Risk checklist" }),
  );
  await screen.findByRole("button", { name: "Enable Risk checklist" });
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByLabelText("Rule name"), {
    target: { value: "Updated risk checklist" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save rule" }));
  await screen.findByText("Updated risk checklist");
  fireEvent.click(
    screen.getByRole("button", { name: "Delete Updated risk checklist" }),
  );
  await waitFor(() => expect(svc.getRules()).toHaveLength(0));
});
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
