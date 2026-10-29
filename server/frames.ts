import sharp from "sharp";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  analysisSchema,
  scenarioSchema,
  type ProcessingFrame,
  type Session,
} from "../shared/schema.js";
import { Sessions, fail } from "./sessions.js";
import { type AIProvider } from "./providers.js";
import { providerFailure } from "./provider-errors.js";
export const frameSchema = z.object({
  frameId: z.string().uuid(),
  timestampSeconds: z.number().min(0).max(86400),
  image: z
    .string()
    .max(720000)
    .regex(/^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
  scenario: scenarioSchema.default("normal"),
  capturedCount: z.number().int().min(0).max(1000000).optional(),
});
export class Frames {
  readonly inflight = new Map<string, Promise<any>>();
  private lastRequest = new Map<string, number>();
  constructor(
    private sessions: Sessions,
    private provider: AIProvider,
    private options: {
      timeoutMs?: number;
      budget?: number;
      minIntervalMs?: number;
    } = {},
  ) {}
  private key(id: string, owner: string) {
    return JSON.stringify([owner, id]);
  }
  pending(id: string, owner: string) {
    return this.inflight.get(this.key(id, owner));
  }
  async analyze(id: string, owner: string, input: unknown) {
    let s = this.sessions.get(id, owner);
    const body = frameSchema.parse(input),
      key = this.key(id, owner);
    const hash = createHash("sha256")
      .update(body.image)
      .update(String(body.timestampSeconds))
      .update(body.scenario)
      .digest("hex");
    const old = this.sessions.store.get<ProcessingFrame>(
      "frame",
      body.frameId,
      owner,
    );
    if (old) {
      if (old.sessionId !== id || old.hash !== hash)
        throw fail(409, "Frame ID was already used for different input");
      if (old.status === "processing") {
        if (this.pending(id, owner))
          await this.pending(id, owner)!.catch(() => {});
      }
      const current = this.sessions.store.get<ProcessingFrame>(
        "frame",
        body.frameId,
        owner,
      )!;
      if (current.status === "failed")
        throw fail(
          current.httpStatus ?? 502,
          current.error ?? "Previous analysis failed",
          "CACHED_FRAME_FAILURE",
        );
      return {
        observations: this.sessions
          .events(id, owner)
          .filter((e) => e.frameId === body.frameId),
        processing: current,
        deduplicated: true,
      };
    }
    // Legacy events are also protected after migration.
    const existing = this.sessions
      .events(id, owner)
      .filter((e) => e.frameId === body.frameId);
    if (existing.length) return { observations: existing, deduplicated: true };
    if (s.status !== "recording") throw fail(409, "Session is not recording");
    if (this.pending(id, owner))
      throw fail(429, "Analysis already running", "ANALYSIS_BUSY");
    if (
      Date.now() - (this.lastRequest.get(key) ?? 0) <
      (this.options.minIntervalMs ?? s.intervalSeconds * 1000)
    )
      throw fail(429, "Analysis interval not elapsed", "ANALYSIS_INTERVAL");
    if (s.attempts >= (this.options.budget ?? 100))
      throw fail(429, "Session analysis request budget reached", "AI_BUDGET");
    if (this.inflight.size >= 2)
      throw fail(429, "Provider concurrency limit reached", "ANALYSIS_BUSY");
    const bytes = Buffer.from(body.image.split(",")[1], "base64");
    if (bytes.length > 512000) throw fail(413, "Frame exceeds 500 KB");
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
      webp =
        bytes.subarray(0, 4).toString() === "RIFF" &&
        bytes.subarray(8, 12).toString() === "WEBP";
    if (!(body.image.startsWith("data:image/jpeg") ? jpeg : webp))
      throw fail(400, "Image signature does not match its media type");
    // Reserve before asynchronous image decode, eliminating overlap admission races.
    const task = this.process(s, owner, body, hash, bytes);
    this.inflight.set(key, task);
    try {
      return await task;
    } finally {
      this.inflight.delete(key);
    }
  }
  private async process(
    s: Session,
    owner: string,
    body: z.infer<typeof frameSchema>,
    hash: string,
    bytes: Buffer,
  ) {
    try {
      await sharp(bytes, { limitInputPixels: 16000000, failOn: "warning" })
        .resize({ width: 16, height: 16, fit: "inside" })
        .raw()
        .toBuffer();
    } catch {
      throw fail(400, "Frame image cannot be decoded or exceeds pixel limits");
    }
    s = this.sessions.get(s.id, owner);
    if (s.status !== "recording")
      throw fail(409, "Session ended before analysis started");
    const key = this.key(s.id, owner);
    this.lastRequest.set(key, Date.now());
    const frame: ProcessingFrame = {
      id: body.frameId,
      sessionId: s.id,
      hash,
      timestampSeconds: body.timestampSeconds,
      status: "processing",
      startedAt: new Date().toISOString(),
      completedAt: null,
      latencyMs: null,
      error: null,
      completedAfterStop: false,
      provider: this.provider.mode,
      model: this.provider.model ?? null,
    };
    this.sessions.store.transaction(() => {
      this.sessions.store.put(
        "session",
        {
          ...s,
          attempts: s.attempts + 1,
          capturedFrames: Math.max(
            s.capturedFrames ?? 0,
            body.capturedCount ?? s.attempts + 1,
          ),
          lastSeenAt: new Date().toISOString(),
        },
        owner,
      );
      this.sessions.store.put("frame", frame, owner);
    });
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const raw = await Promise.race([
        this.provider.analyze({
          image: body.image,
          timestampSeconds: body.timestampSeconds,
          rules: this.sessions.snapshot(s, owner),
          scenario: body.scenario,
          signal: controller.signal,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(fail(504, "Analysis timed out", "AI_TIMEOUT"));
          }, this.options.timeoutMs ?? 60000);
        }),
      ]);
      const output = analysisSchema.parse(raw),
        current = this.sessions.get(s.id, owner),
        completedAt = new Date().toISOString(),
        latencyMs = Date.now() - Date.parse(frame.startedAt),
        late = current.status !== "recording";
      const ruleIds = new Set(
        this.sessions.snapshot(s, owner).map((r) => r.id),
      );
      return this.sessions.store.transaction(() => {
        const observations = output.observations.map((e) => {
          const ruleId = e.ruleId && ruleIds.has(e.ruleId) ? e.ruleId : null;
          const missing =
            e.category === "insufficient_evidence" || e.kind === "unknown";
          return this.sessions.store.put(
            "event",
            {
              ...e,
              ruleId,
              assessment: missing ? "not_assessable" : e.assessment,
              status: missing ? "insufficient_evidence" : "needs_confirmation",
              timestampSeconds: body.timestampSeconds,
              id: randomUUID(),
              sessionId: s.id,
              frameId: body.frameId,
              simulated: this.provider.mode === "mock",
              provider: this.provider.mode,
              model: this.provider.model ?? null,
              analyzedAt: completedAt,
              latencyMs,
              completedAfterStop: late,
              history: [],
              notes: "",
            },
            owner,
          );
        });
        const processing = this.sessions.store.put<ProcessingFrame>(
          "frame",
          {
            ...frame,
            status: "completed",
            completedAt,
            latencyMs,
            completedAfterStop: late,
          },
          owner,
        );
        this.sessions.store.put(
          "session",
          { ...current, frames: current.frames + 1 },
          owner,
        );
        return { observations, processing };
      });
    } catch (error) {
      const safe =
        (error as any)?.status === 504
          ? (error as Error & { status: number })
          : this.provider.mode === "openai"
            ? providerFailure(error)
            : fail(
                502,
                "Simulated analysis failure. Try the normal scenario.",
                "MOCK_FAILURE",
              );
      this.sessions.store.transaction(() => {
        const current = this.sessions.get(s.id, owner);
        this.sessions.store.put(
          "frame",
          {
            ...frame,
            status: "failed",
            completedAt: new Date().toISOString(),
            latencyMs: Date.now() - Date.parse(frame.startedAt),
            error: safe.message,
            httpStatus: safe.status,
            completedAfterStop: current.status !== "recording",
          },
          owner,
        );
        this.sessions.store.put(
          "session",
          { ...current, failedFrames: current.failedFrames + 1 },
          owner,
        );
      });
      throw safe;
    } finally {
      clearTimeout(timer);
    }
  }
  release(id: string, owner: string) {
    this.lastRequest.delete(this.key(id, owner));
  }
}
