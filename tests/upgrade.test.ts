import { beforeEach, afterEach, it, expect, vi } from "vitest";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import initSqlJs from "sql.js";
import { Store } from "../server/db";
import { Sessions } from "../server/sessions";
import { createApp } from "../server/app";
import {
  MockAIProvider,
  OpenAIProvider,
  type AIProvider,
} from "../server/providers";
import { serverConfig } from "../server/config";
import { zodTextFormat } from "openai/helpers/zod";
import { analysisSchema } from "../shared/schema";
process.env.NODE_ENV = "test";
let store: Store, app: ReturnType<typeof createApp>;
const image =
  "data:image/jpeg;base64," +
  fs
    .readFileSync(new URL("./fixtures/frame.jpg", import.meta.url))
    .toString("base64");
const frame = () => ({ frameId: randomUUID(), image, timestampSeconds: 10 });
async function start() {
  const created = await request(app)
    .post("/api/sessions")
    .send({ title: "Upgrade test" });
  expect(created.status).toBe(201);
  await request(app)
    .post(`/api/sessions/${created.body.id}/start`)
    .send({})
    .expect(200);
  return created.body.id as string;
}
beforeEach(async () => {
  store = await Store.open();
  app = createApp(store, new MockAIProvider(), { minIntervalMs: 0 });
});
afterEach(() => {
  store.close();
  vi.restoreAllMocks();
});

it("deduplicates empty AI results, including replays after stop", async () => {
  const analyze = vi.fn(async () => ({ observations: [] }));
  app = createApp(store, { mode: "mock", analyze }, { minIntervalMs: 0 });
  const id = await start(),
    body = frame();
  await request(app).post(`/api/sessions/${id}/frames`).send(body).expect(200);
  await request(app).post(`/api/sessions/${id}/stop`).send({});
  const replay = await request(app)
    .post(`/api/sessions/${id}/frames`)
    .send(body)
    .expect(200);
  expect(replay.body.deduplicated).toBe(true);
  expect(replay.body.observations).toEqual([]);
  expect(analyze).toHaveBeenCalledTimes(1);
  expect((await request(app).get(`/api/sessions/${id}`)).body.frames).toBe(1);
});
it("caches failed requests without replaying the provider", async () => {
  const analyze = vi.fn(async () => {
    throw new Error("sensitive upstream details");
  });
  app = createApp(store, { mode: "mock", analyze }, { minIntervalMs: 0 });
  const id = await start(),
    body = frame();
  await request(app).post(`/api/sessions/${id}/frames`).send(body).expect(502);
  await request(app).post(`/api/sessions/${id}/frames`).send(body).expect(502);
  expect(analyze).toHaveBeenCalledTimes(1);
  expect(
    (await request(app).get(`/api/sessions/${id}`)).body.failedFrames,
  ).toBe(1);
});
it("rejects reused frame IDs for a different timestamp or session", async () => {
  const id = await start(),
    second = await start(),
    body = frame();
  await request(app).post(`/api/sessions/${id}/frames`).send(body).expect(200);
  await request(app)
    .post(`/api/sessions/${id}/frames`)
    .send({ ...body, timestampSeconds: 15 })
    .expect(409);
  await request(app)
    .post(`/api/sessions/${second}/frames`)
    .send(body)
    .expect(409);
});
it("records latency and labels permitted results completing after stop", async () => {
  const id = await start(),
    pending = request(app)
      .post(`/api/sessions/${id}/frames`)
      .send(frame())
      .then((r) => r);
  await new Promise((r) => setTimeout(r, 15));
  const [a, b] = await Promise.all([
    request(app).post(`/api/sessions/${id}/stop`).send({}),
    request(app).post(`/api/sessions/${id}/stop`).send({}),
  ]);
  await pending;
  expect(a.body.framesAnalyzed).toBe(1);
  expect(b.body.framesAnalyzed).toBe(1);
  expect(a.body.unconfirmed[0].completedAfterStop).toBe(true);
  expect(a.body.latency.samples).toBe(1);
  expect(a.body.processing[0]).not.toHaveProperty("hash");
});
it("preserves a rule snapshot when current rules are edited and deleted", async () => {
  const rule = (
    await request(app).post("/api/rules").send({
      title: "Checklist v1",
      description: "Review the checklist",
      enabled: true,
      category: "max_risk",
      numericLimit: 1,
    })
  ).body;
  const id = await start();
  await request(app)
    .put(`/api/rules/${rule.id}`)
    .send({ ...rule, title: "Checklist v2", numericLimit: 2 });
  await request(app).delete(`/api/rules/${rule.id}`);
  const output = await request(app)
    .post(`/api/sessions/${id}/frames`)
    .send({ ...frame(), scenario: "deviation" })
    .expect(200);
  expect(output.body.observations[0].ruleId).toBe(rule.id);
  const report = (await request(app).post(`/api/sessions/${id}/stop`).send({}))
    .body;
  expect(report.rules[0].rule.title).toBe("Checklist v1");
  expect(report.rules[0].rule.numericLimit).toBe(1);
  expect(report.potentialRuleViolations).toHaveLength(1);
});
it("does not count supported adherence or unknown information as a potential violation", async () => {
  const rule = (
    await request(app).post("/api/rules").send({
      title: "Visible checklist",
      description: "Checklist visible",
      enabled: true,
    })
  ).body;
  const base = await new MockAIProvider().analyze({
    image,
    timestampSeconds: 0,
    rules: [],
    scenario: "normal",
    signal: new AbortController().signal,
  });
  app = createApp(
    store,
    {
      mode: "mock",
      analyze: async () => ({
        observations: [
          {
            ...base.observations[0],
            ruleId: rule.id,
            assessment: "followed",
            kind: "visible_fact",
          },
        ],
      }),
    },
    { minIntervalMs: 0 },
  );
  const id = await start();
  await request(app).post(`/api/sessions/${id}/frames`).send(frame());
  const report = (await request(app).post(`/api/sessions/${id}/stop`).send({}))
    .body;
  expect(report.potentialRuleViolations).toHaveLength(0);
  expect(report.rules[0].findings[0].assessment).toBe("followed");
});
it("keeps identical record IDs isolated by owner, including settings", () => {
  store.put("settings", { id: "settings", intervalSeconds: 5 }, "alice");
  store.put("settings", { id: "settings", intervalSeconds: 15 }, "bob");
  expect(store.get("settings", "settings", "alice").intervalSeconds).toBe(5);
  expect(store.get("settings", "settings", "bob").intervalSeconds).toBe(15);
});
it("rolls back multi-record mutations on failure", () => {
  expect(() =>
    store.transaction(() => {
      store.put("rule", { id: "one" }, "alice");
      store.put("event", { id: "two" }, "alice");
      throw new Error("cancel");
    }),
  ).toThrow("cancel");
  expect(store.all("rule", "alice")).toEqual([]);
  expect(store.all("event", "alice")).toEqual([]);
});
it("refuses a second writer to the same SQLite file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coach-lock-"));
  try {
    const file = path.join(dir, "db.sqlite"),
      first = await Store.open(file);
    await expect(Store.open(file)).rejects.toThrow("already in use");
    first.close();
    const next = await Store.open(file);
    next.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
it("migrates v1 SQLite with an exact backup and original records preserved", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coach-migration-"));
  try {
    const file = path.join(dir, "coach.sqlite"),
      SQL = await initSqlJs(),
      old = new SQL.Database();
    old.run(
      "CREATE TABLE records(kind TEXT,id TEXT,owner TEXT,body TEXT,PRIMARY KEY(kind,id)); PRAGMA user_version=1",
    );
    old.run("INSERT INTO records VALUES (?,?,?,?)", [
      "rule",
      "legacy",
      "alice",
      JSON.stringify({ id: "legacy", title: "Keep me" }),
    ]);
    const bytes = old.export();
    fs.writeFileSync(file, bytes);
    old.close();
    const upgraded = await Store.open(file);
    expect(upgraded.get("rule", "legacy", "alice").title).toBe("Keep me");
    expect(fs.readFileSync(file + ".pre-v2.bak")).toEqual(Buffer.from(bytes));
    expect(upgraded.db.exec("PRAGMA user_version")[0].values[0][0]).toBe(2);
    upgraded.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
it("recovers abandoned sessions and interrupted processing across a database reopen", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coach-recovery-"));
  try {
    const file = path.join(dir, "db.sqlite"),
      a = await Store.open(file),
      svc = new Sessions(a),
      s = svc.create("Interrupted", "mock", "alice");
    a.put(
      "session",
      {
        ...s,
        status: "recording",
        startedAt: "2020-01-01T00:00:00Z",
        lastSeenAt: "2020-01-01T00:00:05Z",
      },
      "alice",
    );
    a.put(
      "frame",
      {
        id: randomUUID(),
        sessionId: s.id,
        status: "processing",
        latencyMs: null,
      },
      "alice",
    );
    a.close();
    const b = await Store.open(file),
      recovery = new Sessions(b);
    expect(recovery.recover()).toBe(1);
    expect(recovery.get(s.id, "alice").status).toBe("stopped");
    expect(b.get("report", s.id, "alice").failedFrames).toBe(1);
    expect(recovery.recover()).toBe(0);
    b.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
it("heartbeats preserve the browser capture count and expiry skips healthy sessions", async () => {
  const id = await start();
  await request(app)
    .post(`/api/sessions/${id}/heartbeat`)
    .send({ capturedCount: 17 })
    .expect(200);
  expect(
    app.locals.sessions.recover("heartbeat_expired", Date.now() - 90000),
  ).toBe(0);
  const report = (
    await request(app)
      .post(`/api/sessions/${id}/stop`)
      .send({ capturedCount: 20 })
  ).body;
  expect(report.framesCaptured).toBe(20);
  expect(report.framesAnalyzed).toBe(0);
});
it("supports notes without erasing a previous correction and exports safe CSV and JSON", async () => {
  const id = await start(),
    output = await request(app)
      .post(`/api/sessions/${id}/frames`)
      .send(frame()),
    event = output.body.observations[0];
  await request(app).post(`/api/events/${event.id}/feedback`).send({
    sessionId: id,
    status: "confirmed",
    correction: "=unsafe-formula",
  });
  await request(app)
    .post(`/api/events/${event.id}/feedback`)
    .send({ sessionId: id, status: "confirmed", notes: "Manually reviewed" });
  await request(app).post(`/api/sessions/${id}/stop`).send({});
  const json = await request(app)
    .get(`/api/sessions/${id}/export?format=json`)
    .expect(200);
  expect(json.body.confirmed[0].correction).toBe("=unsafe-formula");
  expect(json.body.confirmed[0].notes).toBe("Manually reviewed");
  const csv = await request(app)
    .get(`/api/sessions/${id}/export?format=csv`)
    .expect(200);
  expect(csv.text).toContain("'=unsafe-formula");
  expect(csv.headers["content-disposition"]).toContain(".csv");
});
it("validates rule limits, dates, resource IDs and fully decodes uploaded images", async () => {
  await request(app)
    .post("/api/rules")
    .send({
      title: "Risk",
      description: "Risk limit",
      enabled: true,
      category: "max_risk",
      numericLimit: 101,
    })
    .expect(400);
  await request(app)
    .get("/api/sessions?from=2026-10-30&to=2026-10-01")
    .expect(400);
  await request(app).get("/api/sessions/not-a-uuid").expect(400);
  const id = await start();
  await request(app)
    .post(`/api/sessions/${id}/frames`)
    .send({ ...frame(), image: "data:image/jpeg;base64,/9j/2Q==" })
    .expect(400);
});
it("enforces a workspace gate, request limits and Host validation", async () => {
  app = createApp(store, new MockAIProvider(), {
    accessToken: "test-workspace-token-24-characters",
  });
  await request(app).get("/api/health").expect(200);
  await request(app).get("/api/sessions").expect(401);
  await request(app)
    .get("/api/sessions")
    .set("Authorization", "Bearer test-workspace-token-24-characters")
    .expect(200);
  await request(app)
    .get("/api/sessions")
    .set("Host", "attacker.example")
    .expect(403);
  app = createApp(store, new MockAIProvider(), { requestLimit: 1 });
  await request(app).get("/api/sessions").expect(200);
  const out = await request(app).get("/api/sessions").expect(429);
  expect(out.body.code).toBe("HTTP_RATE_LIMIT");
});
it("configuration requires an explicit local security mode and bounds configuration", () => {
  expect(() => serverConfig({})).toThrow();
  expect(serverConfig({ DEV_NO_AUTH: "true" }).AI_TIMEOUT_MS).toBe(60000);
  expect(() =>
    serverConfig({ DEV_NO_AUTH: "false", APP_ACCESS_TOKEN: "short" }),
  ).toThrow();
  expect(() =>
    serverConfig({ DEV_NO_AUTH: "true", AI_TIMEOUT_MS: "NaN" }),
  ).toThrow();
});
it("supports abortable deterministic mock timeout fixtures", async () => {
  app = createApp(store, new MockAIProvider(), { timeoutMs: 20 });
  const id = await start();
  await request(app)
    .post(`/api/sessions/${id}/frames`)
    .send({ ...frame(), scenario: "timeout" })
    .expect(504);
  expect(
    (await request(app).get(`/api/sessions/${id}/processing`)).body[0].status,
  ).toBe("failed");
});
it("checks the exact schema sent to the SDK includes assessment and rejects incomplete model output", async () => {
  const format = zodTextFormat(analysisSchema, "test");
  expect(JSON.stringify(format.schema)).toContain("assessment");
  const transport = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        id: "test",
        object: "response",
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
  const provider = new OpenAIProvider("test-key", "gpt-5.5", {
    imageDetail: "high",
    reasoningEffort: "low",
    maxOutputTokens: 4096,
  });
  await expect(
    provider.analyze({
      image,
      timestampSeconds: 0,
      rules: [],
      scenario: "normal",
      signal: new AbortController().signal,
    }),
  ).rejects.toHaveProperty("code", "output_limit");
  const sent = JSON.parse(transport.mock.calls[0][1]?.body as string);
  expect(sent.reasoning.effort).toBe("low");
  expect(sent.input[1].content[1].detail).toBe("high");
  expect(sent.store).toBe(false);
});
