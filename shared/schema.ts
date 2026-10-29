import { z } from "zod";
export const observationSchema = z.object({
  category: z.enum([
    "strategy_adherence",
    "risk_management",
    "session_discipline",
    "possible_repeated_activity",
    "observation",
    "insufficient_evidence",
  ]),
  observation: z.string().min(1).max(2000),
  evidence: z.string().min(1).max(2000),
  timestampSeconds: z.number().nonnegative(),
  ruleId: z.string().nullable(),
  status: z.enum(["needs_confirmation", "insufficient_evidence"]),
  confidence: z.null(),
  uncertainty: z.enum(["low", "moderate", "high", "unknown"]),
  kind: z.enum(["visible_fact", "inference", "unknown"]),
  assessment: z.enum([
    "followed",
    "potential_deviation",
    "not_assessable",
    "awaiting_confirmation",
  ]),
  limitations: z.array(z.string().max(500)).max(10),
});
export const analysisSchema = z.object({
  observations: z.array(observationSchema).max(5),
});
export const ruleSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(2000),
    enabled: z.boolean(),
    category: z
      .enum([
        "permitted_sessions",
        "max_trades",
        "max_risk",
        "stop_loss",
        "consecutive_losses",
        "strategy_entry",
        "exit_management",
      ])
      .default("strategy_entry"),
    numericLimit: z.number().positive().max(100000).nullable().default(null),
    sessionWindow: z.string().trim().max(200).nullable().default(null),
  })
  .superRefine((rule, context) => {
    if (
      rule.category === "max_risk" &&
      rule.numericLimit !== null &&
      rule.numericLimit > 100
    )
      context.addIssue({
        code: "custom",
        message: "Risk percentage must be at most 100",
        path: ["numericLimit"],
      });
    if (
      ["max_trades", "consecutive_losses"].includes(rule.category) &&
      rule.numericLimit !== null &&
      !Number.isInteger(rule.numericLimit)
    )
      context.addIssue({
        code: "custom",
        message: "Trade/loss limits must be integers",
        path: ["numericLimit"],
      });
  });
export const settingsSchema = z.object({
  intervalSeconds: z.number().int().min(5).max(120),
  retentionDays: z.number().int().min(1).max(365),
  captureIntervalSeconds: z.number().int().min(1).max(30).default(1),
});
export type Observation = Omit<z.infer<typeof observationSchema>, "status"> & {
  id: string;
  sessionId: string;
  simulated: boolean;
  status: string;
  frameId: string;
  correction?: string;
  history?: unknown[];
};
export type Rule = z.infer<typeof ruleSchema> & {
  id: string;
  version?: number;
};
export type Session = {
  id: string;
  title: string;
  status: "created" | "recording" | "stopped";
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  frames: number;
  attempts: number;
  failedFrames: number;
  notes: string;
  mode: string;
  intervalSeconds: number;
  captureIntervalSeconds?: number;
  capturedFrames?: number;
  rulesSnapshot?: Rule[];
  lastSeenAt?: string;
  endReason?: string;
};
export const scenarioSchema = z.enum([
  "normal",
  "deviation",
  "insufficient",
  "timeout",
  "error",
]);
export type Scenario = z.infer<typeof scenarioSchema>;
export type ProcessingFrame = {
  id: string;
  sessionId: string;
  hash: string;
  timestampSeconds: number;
  status: "processing" | "completed" | "failed";
  startedAt: string;
  completedAt: string | null;
  latencyMs: number | null;
  error: string | null;
  httpStatus?: number;
  completedAfterStop: boolean;
  provider: string;
  model: string | null;
};
