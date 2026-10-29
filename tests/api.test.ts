import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { Store } from "../server/db";
import { createApp } from "../server/app";
import {
  createProvider,
  MockAIProvider,
  OpenAIProvider,
  type AIProvider,
} from "../server/providers";
import { analysisSchema } from "../shared/schema";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.NODE_ENV = "test";
let store: Store, app: ReturnType<typeof createApp>;
const frame = () => ({
  frameId: randomUUID(),
  timestampSeconds: 5,
  image:
    "data:image/jpeg;base64," +
    fs
      .readFileSync(new URL("./fixtures/frame.jpg", import.meta.url))
      .toString("base64"),
});
const start = async (a = app) => {
  const s = (await request(a).post("/api/sessions").send({})).body;
  await request(a).post(`/api/sessions/${s.id}/start`).send({});
  return s.id;
};
beforeEach(async () => {
  store = await Store.open();
  app = createApp(store, new MockAIProvider(), { minIntervalMs: 0 });
});
afterEach(() => {
  store.close();
  vi.restoreAllMocks();
});
describe("session APIs", () => {
  it("records observations, stops, reports, corrects with history, and deletes", async () => {
    const id = await start();
    const f = frame();
    const out = await request(app)
      .post(`/api/sessions/${id}/frames`)
      .send(f)
      .expect(200);
    expect(out.body.observations[0].simulated).toBe(true);
    await request(app).post(`/api/sessions/${id}/frames`).send(f).expect(200);
    const r = await request(app)
      .post(`/api/sessions/${id}/stop`)
      .send({})
      .expect(200);
    expect(r.body.framesAnalyzed).toBe(1);
    expect(r.body.unconfirmed).toHaveLength(1);
    const event = out.body.observations[0];
    await request(app)
      .post(`/api/events/${event.id}/feedback`)
      .send({
        sessionId: id,
        status: "confirmed",
        correction: "Verified manually",
      })
      .expect(200);
    const updated = await request(app).get(`/api/sessions/${id}/report`);
    expect(updated.body.confirmed[0].history).toHaveLength(1);
    expect(updated.body.confirmed[0].correction).toBe("Verified manually");
    await request(app)
      .patch(`/api/sessions/${id}`)
      .send({ notes: "Review tomorrow" })
      .expect(200);
    expect(
      (await request(app).get(`/api/sessions/${id}/report`)).body.notes,
    ).toBe("Review tomorrow");
    await request(app).delete(`/api/sessions/${id}`).expect(204);
    await request(app).get(`/api/sessions/${id}`).expect(404);
    expect(store.all("event", "local-development-user")).toHaveLength(0);
  });
  it("rejects invalid lifecycle transitions", async () => {
    const s = (await request(app).post("/api/sessions").send({})).body;
    await request(app)
      .post(`/api/sessions/${s.id}/frames`)
      .send(frame())
      .expect(409);
    await request(app).post(`/api/sessions/${s.id}/stop`).send({}).expect(409);
    await request(app).post(`/api/sessions/${s.id}/start`).send({}).expect(200);
    await request(app).post(`/api/sessions/${s.id}/start`).send({}).expect(409);
    await request(app).delete(`/api/sessions/${s.id}`).expect(409);
  });
  it("validates frames and payload sizes", async () => {
    const id = await start();
    await request(app)
      .post(`/api/sessions/${id}/frames`)
      .send({ ...frame(), image: "not an image" })
      .expect(400);
    await request(app)
      .post(`/api/sessions/${id}/frames`)
      .send({ ...frame(), image: "data:image/jpeg;base64,YWJj" })
      .expect(400);
    await request(app)
      .post(`/api/sessions/${id}/frames`)
      .send({
        ...frame(),
        image:
          "data:image/jpeg;base64," +
          Buffer.alloc(520000, 255).toString("base64"),
      })
      .expect(413);
    await request(app)
      .post(`/api/sessions/${id}/frames`)
      .send({ ...frame(), image: "a".repeat(800000) })
      .expect(413);
  });
  it("prevents cross-owner and cross-session access", async () => {
    app = createApp(store, new MockAIProvider(), {
      owner: (req) => (req.headers["x-test-owner"] as string) || "alice",
      minIntervalMs: 0,
    });
    const id = await start();
    const other = await start();
    await request(app)
      .get(`/api/sessions/${id}`)
      .set("x-test-owner", "bob")
      .expect(404);
    await request(app)
      .post(`/api/sessions/${id}/frames`)
      .set("x-test-owner", "bob")
      .send(frame())
      .expect(404);
    const out = await request(app)
      .post(`/api/sessions/${id}/frames`)
      .send(frame());
    await request(app)
      .post(`/api/events/${out.body.observations[0].id}/feedback`)
      .send({ sessionId: other, status: "confirmed" })
      .expect(404);
    await request(app)
      .post(`/api/events/${out.body.observations[0].id}/feedback`)
      .set("x-test-owner", "bob")
      .send({ sessionId: id, status: "confirmed" })
      .expect(404);
  });
  it("waits for in-flight work before finalizing report", async () => {
    const id = await start();
    const pending = request(app)
      .post(`/api/sessions/${id}/frames`)
      .send(frame())
      .then((r) => r);
    await new Promise((r) => setTimeout(r, 30));
    const report = await request(app).post(`/api/sessions/${id}/stop`).send({});
    await pending;
    expect(report.body.framesAnalyzed).toBe(1);
  });
  it("rejects foreign origins and malformed requests", async () => {
    await request(app)
      .post("/api/sessions")
      .set("Origin", "https://other.example")
      .send({})
      .expect(403);
    await request(app)
      .post("/api/sessions")
      .set("Content-Type", "application/json")
      .send("{")
      .expect(400);
  });
  it("enforces request budget and concurrency", async () => {
    app = createApp(store, new MockAIProvider(), {
      budget: 1,
      minIntervalMs: 0,
    });
    const id = await start();
    const pending = request(app)
      .post(`/api/sessions/${id}/frames`)
      .send(frame())
      .then((r) => r);
    await new Promise((r) => setTimeout(r, 30));
    await request(app)
      .post(`/api/sessions/${id}/frames`)
      .send(frame())
      .expect(429);
    await pending;
    await request(app)
      .post(`/api/sessions/${id}/frames`)
      .send(frame())
      .expect(429);
  });
  it("persists settings and cleans expired stopped sessions", async () => {
    await request(app)
      .put("/api/settings")
      .send({ intervalSeconds: 10, retentionDays: 1 })
      .expect(200);
    expect(
      (await request(app).get("/api/config/status")).body.intervalSeconds,
    ).toBe(10);
    const id = await start();
    await request(app).post(`/api/sessions/${id}/stop`).send({});
    const s = store.get("session", id, "local-development-user");
    store.put(
      "session",
      { ...s, endedAt: "2020-01-01T00:00:00Z" },
      "local-development-user",
    );
    expect(
      (await request(app).post("/api/retention/cleanup").send({})).body.deleted,
    ).toBe(1);
  });
});
it("supports rule create, update, disable, delete and owner isolation", async () => {
  const r = await request(app)
    .post("/api/rules")
    .send({
      title: "Risk review",
      description: "Check configured risk",
      enabled: true,
    })
    .expect(201);
  await request(app)
    .put(`/api/rules/${r.body.id}`)
    .send({ ...r.body, enabled: false })
    .expect(200);
  expect((await request(app).get("/api/rules")).body[0].enabled).toBe(false);
  await request(app).delete(`/api/rules/${r.body.id}`).expect(204);
  expect((await request(app).get("/api/rules")).body).toEqual([]);
  await request(app).post("/api/rules").send({ title: "" }).expect(400);
});
it("persists SQLite across reopens", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coach-test-"));
  try {
    const file = path.join(dir, "db.sqlite");
    const a = await Store.open(file);
    a.put("rule", { id: "test", title: "Persistent" }, "alice");
    a.close();
    const b = await Store.open(file);
    expect(b.get("rule", "test", "alice").title).toBe("Persistent");
    expect(b.get("rule", "test", "bob")).toBeUndefined();
    b.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
describe("providers", () => {
  it("returns an actionable sanitized message for a rejected real API key", async () => {
    app = createApp(store, {
      mode: "openai",
      analyze: async () => {
        throw Object.assign(new Error("private credential fragment"), {
          status: 401,
          code: "invalid_api_key",
        });
      },
    });
    const id = await start();
    const result = await request(app)
      .post(`/api/sessions/${id}/frames`)
      .send(frame())
      .expect(502);
    expect(result.body.error).toContain("API key (401)");
    expect(result.body.error).not.toContain("private credential fragment");
    expect(
      (await request(app).get(`/api/sessions/${id}/events`)).body,
    ).toHaveLength(0);
  });
  it("uses the installed OpenAI Responses SDK with structured vision input and no response storage", async () => {
    const expected = await new MockAIProvider().analyze({
      ...frame(),
      rules: [],
      signal: new AbortController().signal,
      scenario: "normal",
    });
    const transport = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_test",
          object: "response",
          created_at: 1,
          status: "completed",
          model: "test-model",
          output: [
            {
              id: "msg_test",
              type: "message",
              role: "assistant",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify(expected),
                  annotations: [],
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const p = new OpenAIProvider("test-key-never-live", "test-model");
    const output = await p.analyze({
      ...frame(),
      rules: [],
      signal: new AbortController().signal,
      scenario: "normal",
    });
    expect(output).toEqual(expected);
    const args = transport.mock.calls[0];
    const sent = JSON.parse(args[1]?.body as string);
    expect(sent.store).toBe(false);
    expect(sent.text.format.type).toBe("json_schema");
    expect(sent.input[1].content[1].type).toBe("input_image");
  });
  it("switches safely and requires explicit credentials", () => {
    expect(createProvider({}).mode).toBe("mock");
    expect(() => createProvider({ AI_PROVIDER: "openai" })).toThrow(
      "OPENAI_API_KEY",
    );
    expect(
      createProvider({ AI_PROVIDER: "openai", OPENAI_API_KEY: "test-only" })
        .mode,
    ).toBe("openai");
  });
  it("mock output is deterministic and validated", async () => {
    const provider = new MockAIProvider(),
      input = {
        ...frame(),
        rules: [],
        signal: new AbortController().signal,
        scenario: "normal" as const,
      };
    expect(await provider.analyze(input)).toEqual(
      await provider.analyze(input),
    );
    expect(() =>
      analysisSchema.parse({ observations: [{ observation: "bad" }] }),
    ).toThrow();
  });
  it.each(["malformed", "failure", "timeout"])(
    "handles %s without saving findings",
    async (kind) => {
      const p: AIProvider = {
        mode: "mock",
        analyze: async () => {
          if (kind === "failure") throw new Error("secret provider detail");
          if (kind === "timeout") return new Promise(() => {});
          return { observations: [{}] };
        },
      };
      app = createApp(store, p, { timeoutMs: 20 });
      const id = await start();
      const result = await request(app)
        .post(`/api/sessions/${id}/frames`)
        .send(frame())
        .expect(kind === "timeout" ? 504 : 502);
      expect(result.body.error).not.toContain("secret");
      expect(
        (await request(app).get(`/api/sessions/${id}/events`)).body,
      ).toHaveLength(0);
      expect(
        (await request(app).post(`/api/sessions/${id}/stop`).send({})).body
          .failedFrames,
      ).toBe(1);
    },
  );
});
