import {
  riskReviewSchema,
  type TradingPlan,
  type observationSchema,
} from "../shared/schema.js";
import type { z } from "zod";

export function riskSuggestions(
  plan: TradingPlan | undefined,
  reading: unknown,
  timestampSeconds: number,
): z.infer<typeof observationSchema>[] {
  if (!plan) return [];
  const review = riskReviewSchema.safeParse(reading).data;
  const checks = [
    {
      label: "Daily loss",
      limit: plan.dailyLossLimitPercent,
      reading: review?.dailyLoss,
      verify:
        "Check today's realized loss as a percentage of account equity in your trading records.",
    },
    {
      label: "Per-trade risk",
      limit: plan.perTradeRiskLimitPercent,
      reading: review?.perTradeRisk,
      verify:
        "Verify the potential loss at the trade's stop as a percentage of account equity.",
    },
  ];
  const suggestions: z.infer<typeof observationSchema>[] = [];
  for (const check of checks) {
    if (check.limit === undefined) continue;
    const limit = check.limit;
    const reading = check.reading;
    const percent = !reading
      ? undefined
      : "percent" in reading
        ? reading.percent
        : (reading.lossAmount / reading.accountEquity) * 100;
    const actual =
      percent !== undefined && Number.isFinite(percent)
        ? Number(percent.toPrecision(8))
        : undefined;
    const relation =
      actual === undefined
        ? "unknown"
        : actual > limit
          ? "above"
          : actual === limit
            ? "at"
            : "below";
    const comparison =
      actual === undefined
        ? `The frame does not establish whether you are within your ${limit}% limit.`
        : `Based on this frame, ${check.label.toLowerCase()} of ${actual}% is ${relation} your ${limit}% limit.`;
    const nextStep =
      relation === "above" || relation === "at"
        ? " Review your plan's response for a reached or exceeded limit."
        : relation === "below"
          ? " Check your remaining risk budget before considering another trade."
          : "";
    suggestions.push({
      category: "risk_management",
      observation: `${check.verify} ${comparison}${nextStep}`,
      evidence:
        check.reading?.evidence ??
        "A clearly labeled percentage of account equity was not available in the frame.",
      timestampSeconds,
      ruleId: null,
      status:
        actual === undefined ? "insufficient_evidence" : "needs_confirmation",
      confidence: null,
      uncertainty: actual === undefined ? "unknown" : "moderate",
      kind: actual === undefined ? "unknown" : "inference",
      assessment:
        relation === "above"
          ? "potential_deviation"
          : relation === "unknown"
            ? "not_assessable"
            : "awaiting_confirmation",
      limitations: [
        "The comparison uses a screen reading. Verify the account, date, and equity basis in your records.",
      ],
    });
  }
  return suggestions;
}
