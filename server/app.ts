import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { Store } from "./db.js";
import { type AIProvider } from "./providers.js";
import { Frames } from "./frames.js";
import { Sessions, fail } from "./sessions.js";
import { ruleSchema, settingsSchema, type Session } from "../shared/schema.js";
const stopSchema = z.object({
  reason: z
    .enum(["user", "capture_ended", "page_closed", "unmount"])
    .default("user"),
  capturedCount: z.number().int().min(0).max(1000000).optional(),
});
export type AppOptions = {
  origin?: string;
  timeoutMs?: number;
  budget?: number;
  owner?: (req: express.Request) => string;
  minIntervalMs?: number;
  accessToken?: string;
  requestLimit?: number;
  defaultIntervalSeconds?: number;
  defaultCaptureIntervalSeconds?: number;
  allowedHosts?: string[];
  trustProxyHops?: number;
  hostedDemo?: boolean;
  ephemeralStorage?: boolean;
};
export function createApp(
  store: Store,
  provider: AIProvider,
  options: AppOptions = {},
) {
  if (options.hostedDemo && (!options.accessToken || provider.mode !== "mock"))
    throw new Error("Hosted demo requires a workspace token and mock AI");
  const app = express(),
    origin = options.origin ?? "http://127.0.0.1:5173";
  const sessions = new Sessions(store, {
    intervalSeconds: options.defaultIntervalSeconds ?? 5,
    captureIntervalSeconds: options.defaultCaptureIntervalSeconds ?? 1,
    retentionDays: 30,
  });
  const frames = new Frames(sessions, provider, options);
  app.locals.sessions = sessions;
  app.locals.frames = frames;
  const owner = (req: express.Request) =>
    options.owner?.(req) ?? "local-development-user";
  app.disable("x-powered-by");
  if (options.trustProxyHops) app.set("trust proxy", options.trustProxyHops);
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    const requestHost = req.get("host")?.toLowerCase();
    if (!requestHost || /[\/\\@\s]/.test(requestHost))
      return res.status(403).json({ error: "Host not permitted" });
    let hostname = "";
    try {
      hostname = new URL("http://" + requestHost).hostname;
    } catch {}
    if (
      !(
        options.allowedHosts ?? ["127.0.0.1", "localhost", "[::1]", "::1"]
      ).includes(hostname)
    )
      return res.status(403).json({ error: "Host not permitted" });
    if (req.headers.origin && req.headers.origin !== origin)
      return res.status(403).json({ error: "Origin not permitted" });
    next();
  });
  app.use(cors({ origin }));
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: options.requestLimit ?? 180,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (_req, res) =>
        res.status(429).json({
          error: "Too many requests. Try again later.",
          code: "HTTP_RATE_LIMIT",
        }),
    }),
  );
  if (options.accessToken)
    app.use("/api", (req, res, next) => {
      const actual = Buffer.from(
          req.headers.authorization?.replace(/^Bearer /, "") ?? "",
        ),
        expected = Buffer.from(options.accessToken!);
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        return res.status(401).json({
          error: "Workspace access token required",
          code: "WORKSPACE_AUTH",
        });
      next();
    });
  app.use(express.json({ limit: "750kb" }));
  app.use((req, res, next) => {
    const started = Date.now();
    res.on("finish", () => {
      if (process.env.NODE_ENV !== "test")
        console.info(
          JSON.stringify({
            method: req.method,
            status: res.statusCode,
            durationMs: Date.now() - started,
          }),
        );
    });
    next();
  });
  app.param("id", (_req, _res, next, id) => {
    try {
      z.uuid().parse(id);
      next();
    } catch {
      next(fail(400, "Invalid resource identifier"));
    }
  });
  const session = (req: express.Request) =>
    sessions.get(String(req.params.id), owner(req));
  const finalize = async (req: express.Request) => {
    const body = stopSchema.parse(req.body),
      s = session(req),
      o = owner(req);
    if (s.status === "created") throw fail(409, "Session has not started");
    if (s.status !== "stopped") {
      store.transaction(() => {
        store.put<Session>(
          "session",
          {
            ...s,
            status: "stopped",
            endedAt: new Date().toISOString(),
            endReason: body.reason,
            capturedFrames: Math.max(
              s.capturedFrames ?? s.attempts,
              body.capturedCount ?? 0,
            ),
          },
          o,
        );
        sessions.audit("session.stopped", s.id, o);
      });
    }
    await frames.pending(s.id, o)?.catch(() => {});
    frames.release(s.id, o);
    return sessions.report(sessions.get(s.id, o), o);
  };
  app.get("/api/config/status", (req, res) =>
    res.json({
      provider: provider.mode,
      deploymentMode: options.hostedDemo ? "hosted_demo" : "local",
      ephemeralStorage: options.ephemeralStorage ?? false,
      privacyNotice: options.hostedDemo
        ? "Shared demo workspace: selected frames are sent to this hosting server for mock processing. Use synthetic screens only; anyone with the demo token can review stored demo records."
        : null,
      model: provider.model ?? null,
      simulated: provider.mode === "mock",
      credentialsConfigured: provider.configured ?? provider.mode === "mock",
      connectionStatus: "unverified",
      authentication: options.accessToken
        ? options.hostedDemo
          ? "shared demo bearer gate; single owner"
          : "local bearer gate; single owner"
        : "development-only; loopback binding; single local user",
      requestBudget: options.budget ?? 100,
      timeoutMs: options.timeoutMs ?? 60000,
      ...sessions.settings(owner(req)),
    }),
  );
  app.put("/api/settings", (req, res) => {
    const settings = settingsSchema.parse(req.body);
    if (settings.captureIntervalSeconds > settings.intervalSeconds)
      throw fail(400, "Capture interval cannot exceed analysis interval");
    res.json(
      store.transaction(() => {
        const saved = store.put(
          "settings",
          { id: "settings", ...settings },
          owner(req),
        );
        sessions.audit("settings.updated", "settings", owner(req));
        return saved;
      }),
    );
  });
  app.post("/api/retention/cleanup", (req, res) => {
    z.object({}).strict().parse(req.body);
    const o = owner(req),
      cutoff = Date.now() - sessions.settings(o).retentionDays * 86400000;
    let deleted = 0;
    for (const s of store.all<Session>("session", o))
      if (
        s.status === "stopped" &&
        Date.parse(s.endedAt!) < cutoff &&
        !frames.pending(s.id, o)
      ) {
        sessions.remove(s.id, o);
        frames.release(s.id, o);
        deleted++;
      }
    store.transaction(() => {
      for (const a of store.all<any>("audit", o))
        if (Date.parse(a.at) < cutoff) store.delete("audit", a.id, o);
    });
    res.json({ deleted });
  });
  app.post("/api/sessions", (req, res) => {
    const body = z
      .object({
        title: z.string().trim().min(1).max(100).default("Trading session"),
      })
      .parse(req.body);
    res
      .status(201)
      .json(sessions.create(body.title, provider.mode, owner(req)));
  });
  app.get("/api/sessions", (req, res) => {
    const q = z
      .object({
        q: z.string().max(100).optional(),
        status: z.enum(["created", "recording", "stopped"]).optional(),
        from: z.iso.date().optional(),
        to: z.iso.date().optional(),
      })
      .parse(req.query);
    if (q.from && q.to && q.from > q.to)
      throw fail(400, "Date range is reversed");
    res.json(
      store
        .all<Session>("session", owner(req))
        .filter(
          (s) =>
            (!q.status || s.status === q.status) &&
            (!q.q || s.title.toLowerCase().includes(q.q.toLowerCase())) &&
            (!q.from || s.createdAt.slice(0, 10) >= q.from) &&
            (!q.to || s.createdAt.slice(0, 10) <= q.to),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  });
  app.get("/api/sessions/:id", (req, res) => res.json(session(req)));
  app.post("/api/sessions/:id/start", (req, res) => {
    z.object({}).strict().parse(req.body);
    const s = session(req),
      o = owner(req);
    if (s.status !== "created") throw fail(409, "Session has already started");
    res.json(
      store.transaction(() => {
        const next = store.put<Session>(
          "session",
          {
            ...s,
            status: "recording",
            startedAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString(),
            rulesSnapshot: sessions.rules(o).filter((r) => r.enabled),
          },
          o,
        );
        sessions.audit("session.started", s.id, o);
        return next;
      }),
    );
  });
  app.post("/api/sessions/:id/heartbeat", (req, res) => {
    const s = session(req);
    const body = z
      .object({ capturedCount: z.number().int().min(0).max(1000000) })
      .parse(req.body);
    if (s.status !== "recording") throw fail(409, "Session is not recording");
    res.json(
      store.put(
        "session",
        {
          ...s,
          lastSeenAt: new Date().toISOString(),
          capturedFrames: Math.max(s.capturedFrames ?? 0, body.capturedCount),
        },
        owner(req),
      ),
    );
  });
  app.post("/api/sessions/:id/stop", async (req, res) =>
    res.json(await finalize(req)),
  );
  app.patch("/api/sessions/:id", (req, res) => {
    const s = session(req),
      body = z.object({ notes: z.string().max(10000) }).parse(req.body),
      o = owner(req);
    res.json(
      store.transaction(() => {
        const updated = store.put("session", { ...s, ...body }, o);
        if (s.status === "stopped" && !frames.pending(s.id, o))
          sessions.report(updated, o);
        sessions.audit("session.notes_updated", s.id, o);
        return updated;
      }),
    );
  });
  app.delete("/api/sessions/:id", (req, res) => {
    const s = session(req),
      o = owner(req);
    if (s.status === "recording" || frames.pending(s.id, o))
      throw fail(409, "Stop recording and wait for analysis before deleting");
    sessions.remove(s.id, o);
    frames.release(s.id, o);
    res.status(204).end();
  });
  app.post("/api/sessions/:id/frames", async (req, res) => {
    session(req);
    res.json(await frames.analyze(String(req.params.id), owner(req), req.body));
  });
  app.get("/api/sessions/:id/processing", (req, res) =>
    res.json(
      sessions
        .frames(session(req).id, owner(req))
        .map(({ hash, ...frame }) => frame),
    ),
  );
  app.get("/api/sessions/:id/events", (req, res) =>
    res.json(sessions.events(session(req).id, owner(req))),
  );
  app.post("/api/events/:id/feedback", (req, res) => {
    const o = owner(req),
      e = store.get<any>("event", String(req.params.id), o);
    if (!e) throw fail(404, "Observation not found");
    const body = z
      .object({
        sessionId: z.string().uuid(),
        status: z.enum([
          "confirmed",
          "dismissed",
          "needs_confirmation",
          "insufficient_evidence",
        ]),
        correction: z.string().max(2000).optional(),
        notes: z.string().max(2000).optional(),
      })
      .parse(req.body);
    if (body.sessionId !== e.sessionId)
      throw fail(404, "Observation not found in this session");
    res.json(
      store.transaction(() => {
        const next = store.put(
          "event",
          {
            ...e,
            ...body,
            history: [
              ...(e.history ?? []),
              {
                at: new Date().toISOString(),
                previousStatus: e.status,
                previousCorrection: e.correction ?? "",
                previousNotes: e.notes ?? "",
                ...body,
              },
            ],
          },
          o,
        );
        const s = sessions.get(e.sessionId, o);
        if (s.status === "stopped" && !frames.pending(s.id, o))
          sessions.report(s, o);
        sessions.audit("observation.reviewed", e.id, o);
        return next;
      }),
    );
  });
  const finalizedReport = (req: express.Request) => {
    const s = session(req),
      o = owner(req);
    if (s.status !== "stopped" || frames.pending(s.id, o))
      throw fail(
        409,
        "Stop the session and wait for analysis to generate a report",
      );
    return sessions.report(s, o);
  };
  app.get("/api/sessions/:id/report", (req, res) =>
    res.json(finalizedReport(req)),
  );
  app.get("/api/sessions/:id/export", (req, res) => {
    const { format } = z
      .object({ format: z.enum(["json", "csv"]).default("json") })
      .parse(req.query);
    const report = finalizedReport(req);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="session-${report.id}.${format}"`,
    );
    sessions.audit("report.exported", report.id, owner(req));
    if (format === "json") return res.json(report);
    const cell = (v: unknown) => {
      let value = String(v ?? "");
      if (/^[\s]*[=+\-@\t\r]/.test(value)) value = "'" + value;
      return '"' + value.replaceAll('"', '""') + '"';
    };
    const rows = [
      [
        "session_id",
        "mode",
        "timestamp_seconds",
        "category",
        "assessment",
        "status",
        "observation",
        "correction",
        "notes",
        "evidence",
        "frame_id",
        "completed_after_stop",
      ],
      ...[...report.confirmed, ...report.dismissed, ...report.unconfirmed]
        .sort((a, b) => a.timestampSeconds - b.timestampSeconds)
        .map((e) => [
          report.sessionId,
          report.mode,
          e.timestampSeconds,
          e.category,
          e.assessment,
          e.status,
          e.observation,
          e.correction ?? "",
          e.notes ?? "",
          e.evidence,
          e.frameId,
          e.completedAfterStop,
        ]),
    ];
    res
      .type("text/csv")
      .send("\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n"));
  });
  app.get("/api/rules", (req, res) => res.json(sessions.rules(owner(req))));
  app.post("/api/rules", (req, res) => {
    const body = ruleSchema.parse(req.body),
      o = owner(req);
    res.status(201).json(
      store.transaction(() => {
        const r = store.put(
          "rule",
          { ...body, id: randomUUID(), version: 1 },
          o,
        );
        sessions.audit("rule.created", r.id, o);
        return r;
      }),
    );
  });
  app.put("/api/rules/:id", (req, res) => {
    const o = owner(req),
      old = store.get<any>("rule", String(req.params.id), o);
    if (!old) throw fail(404, "Rule not found");
    const body = ruleSchema.parse(req.body);
    res.json(
      store.transaction(() => {
        const r = store.put(
          "rule",
          { ...body, id: old.id, version: (old.version ?? 1) + 1 },
          o,
        );
        sessions.audit("rule.updated", r.id, o);
        return r;
      }),
    );
  });
  app.delete("/api/rules/:id", (req, res) => {
    const o = owner(req),
      id = String(req.params.id);
    if (!store.get("rule", id, o)) throw fail(404, "Rule not found");
    store.transaction(() => {
      store.delete("rule", id, o);
      sessions.audit("rule.deleted", id, o);
    });
    res.status(204).end();
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Endpoint not found" }),
  );
  app.use(
    (
      error: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status = error instanceof z.ZodError ? 400 : (error.status ?? 500);
      res.status(status).json({
        error:
          error instanceof z.ZodError
            ? "Invalid request payload"
            : status === 413
              ? "Payload too large"
              : status >= 500 && ![502, 504].includes(status)
                ? "Internal server error"
                : error.message,
        ...(typeof error.code === "string" && /^[A-Z_]{2,40}$/.test(error.code)
          ? { code: error.code }
          : {}),
        ...(error.fatal ? { fatal: true } : {}),
      });
    },
  );
  return app;
}
