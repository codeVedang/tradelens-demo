import { randomUUID } from "node:crypto";
import { Store } from "./db.js";
import {
  ruleSchema,
  type Rule,
  type Session,
  type ProcessingFrame,
} from "../shared/schema.js";
export const fail = (status: number, message: string, code?: string) =>
  Object.assign(new Error(message), { status, code });
export class Sessions {
  constructor(
    public store: Store,
    private defaults = {
      intervalSeconds: 5,
      captureIntervalSeconds: 1,
      retentionDays: 30,
    },
  ) {}
  settings(owner: string) {
    return {
      ...this.defaults,
      ...this.store.get("settings", "settings", owner),
    };
  }
  get(id: string, owner: string) {
    const s = this.store.get<Session>("session", id, owner);
    if (!s) throw fail(404, "Session not found");
    return s;
  }
  events(id: string, owner: string) {
    return this.store
      .bySession<any>("event", id, owner)
      .map((e) => ({
        ...e,
        history: e.history ?? [],
        assessment:
          e.assessment ??
          (e.status === "insufficient_evidence"
            ? "not_assessable"
            : "awaiting_confirmation"),
        notes: e.notes ?? "",
        completedAfterStop: e.completedAfterStop ?? false,
      }))
      .sort((a, b) => a.timestampSeconds - b.timestampSeconds);
  }
  frames(id: string, owner: string) {
    return this.store
      .bySession<ProcessingFrame>("frame", id, owner)
      .sort((a, b) => a.timestampSeconds - b.timestampSeconds);
  }
  audit(action: string, resourceId: string, owner: string) {
    this.store.put(
      "audit",
      { id: randomUUID(), action, resourceId, at: new Date().toISOString() },
      owner,
    );
  }
  rules(owner: string): Rule[] {
    return this.store
      .all<any>("rule", owner)
      .map((r) => ({ ...r, ...ruleSchema.parse(r), version: r.version ?? 1 }));
  }
  create(title: string, mode: string, owner: string) {
    const prefs = this.settings(owner);
    return this.store.transaction(() => {
      const s = this.store.put<Session>(
        "session",
        {
          id: randomUUID(),
          title,
          status: "created",
          createdAt: new Date().toISOString(),
          startedAt: null,
          endedAt: null,
          frames: 0,
          attempts: 0,
          failedFrames: 0,
          capturedFrames: 0,
          notes: "",
          mode,
          intervalSeconds: prefs.intervalSeconds,
          captureIntervalSeconds: prefs.captureIntervalSeconds,
          rulesSnapshot: this.rules(owner).filter((r) => r.enabled),
        },
        owner,
      );
      this.audit("session.created", s.id, owner);
      return s;
    });
  }
  snapshot(s: Session, _owner: string) {
    return s.rulesSnapshot ?? [];
  }
  report(s: Session, owner: string) {
    const list = this.events(s.id, owner),
      frames = this.frames(s.id, owner),
      usable = list.filter((e) => e.status !== "dismissed");
    const groups = new Map<
      string,
      {
        category: string;
        observation: string;
        count: number;
        timestamps: number[];
      }
    >();
    for (const e of usable) {
      const key =
        e.category + "|" + (e.correction || e.observation).trim().toLowerCase();
      const g: {
        category: string;
        observation: string;
        count: number;
        timestamps: number[];
      } = groups.get(key) ?? {
        category: e.category,
        observation: e.correction || e.observation,
        count: 0,
        timestamps: [],
      };
      g.count++;
      g.timestamps.push(e.timestampSeconds);
      groups.set(key, g);
    }
    const linked = usable.filter((e) => e.ruleId);
    const rules = this.snapshot(s, owner).map((r) => ({
      rule: r,
      findings: linked.filter((e) => e.ruleId === r.id),
      assessment: linked.some((e) => e.ruleId === r.id)
        ? "review_findings"
        : "not_assessable",
    }));
    const latency = frames
      .filter((f) => f.latencyMs !== null)
      .map((f) => f.latencyMs!);
    return this.store.put(
      "report",
      {
        id: s.id,
        sessionId: s.id,
        title: s.title,
        mode: s.mode,
        generatedAt: new Date().toISOString(),
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        endReason: s.endReason ?? "user",
        durationSeconds: s.startedAt
          ? Math.max(
              0,
              Math.round(
                (Date.parse(s.endedAt ?? new Date().toISOString()) -
                  Date.parse(s.startedAt)) /
                  1000,
              ),
            )
          : 0,
        framesCaptured: s.capturedFrames ?? s.attempts,
        framesSubmitted: s.attempts,
        framesAnalyzed: s.frames,
        failedFrames: s.failedFrames,
        pendingFrames: frames.filter((f) => f.status === "processing").length,
        confirmed: list.filter((e) => e.status === "confirmed"),
        dismissed: list.filter((e) => e.status === "dismissed"),
        unconfirmed: list.filter(
          (e) => !["confirmed", "dismissed"].includes(e.status),
        ),
        potentialRuleViolations: linked.filter(
          (e) => e.assessment === "potential_deviation" && e.kind !== "unknown",
        ),
        rules,
        recurringObservations: [...groups.values()].filter((g) => g.count > 1),
        processing: frames.map(({ hash, ...frame }) => frame),
        latency: {
          samples: latency.length,
          averageMs: latency.length
            ? Math.round(latency.reduce((a, b) => a + b, 0) / latency.length)
            : null,
          maxMs: latency.length ? Math.max(...latency) : null,
        },
        improvements: usable.length
          ? [
              "Review the evidence and your corrections before drawing conclusions.",
              "Review checklist items associated with potential deviations; supply missing execution context in notes.",
            ]
          : [
              "No usable observations were available. No trading conclusions can be drawn.",
            ],
        limitations: [
          "Screenshots cannot independently verify broker execution, risk or profitability.",
          "Captured count is reported by the browser; failed and skipped frames have no AI coverage.",
          "Confidence is qualitative, not a calibrated probability.",
          ...(s.rulesSnapshot
            ? []
            : [
                "Legacy session has no rule snapshot; historical rules cannot be reconstructed.",
              ]),
        ],
        notes: s.notes,
      },
      owner,
    );
  }
  remove(id: string, owner: string) {
    this.store.transaction(() => {
      for (const kind of ["event", "frame"])
        for (const row of this.store.bySession(kind, id, owner))
          this.store.delete(kind, row.id, owner);
      this.store.delete("report", id, owner);
      this.store.delete("session", id, owner);
      this.audit("session.deleted", id, owner);
    });
  }
  recover(
    reason = "server_restart",
    cutoff?: number,
    skip?: (id: string, owner: string) => boolean,
  ) {
    let recovered = 0;
    for (const owner of this.store.owners())
      for (const s of this.store.all<Session>("session", owner)) {
        if (
          s.status !== "recording" ||
          skip?.(s.id, owner) ||
          (cutoff !== undefined &&
            Date.parse(s.lastSeenAt ?? s.startedAt ?? s.createdAt) > cutoff)
        )
          continue;
        this.store.transaction(() => {
          for (const f of this.frames(s.id, owner))
            if (f.status === "processing")
              this.store.put(
                "frame",
                {
                  ...f,
                  status: "failed",
                  error: "Analysis interrupted before completion",
                  httpStatus: 503,
                  completedAt: new Date().toISOString(),
                },
                owner,
              );
          const updated = this.store.put<Session>(
            "session",
            {
              ...s,
              status: "stopped",
              endedAt: s.lastSeenAt ?? new Date().toISOString(),
              endReason: reason,
              failedFrames: Math.max(
                s.failedFrames,
                this.frames(s.id, owner).filter((f) => f.status === "failed")
                  .length,
              ),
            },
            owner,
          );
          this.report(updated, owner);
          this.audit("session.recovered", s.id, owner);
        });
        recovered++;
      }
    return recovered;
  }
}
