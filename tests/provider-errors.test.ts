import { expect, it } from "vitest";
import { providerFailure } from "../server/provider-errors";

it.each([
  [
    { status: 401, code: "invalid_api_key" },
    "OpenAI rejected the API key (401)",
  ],
  [{ status: 429, code: "insufficient_quota" }, "quota"],
  [{ status: 429 }, "rate limit"],
  [{ status: 404 }, "configured model"],
  [{ status: 400 }, "request (400)"],
  [{ name: "APIConnectionTimeoutError" }, "timed out"],
  [{ name: "APIConnectionError" }, "Cannot connect"],
])(
  "explains a recognized provider failure without exposing its raw message: %j",
  (detail, expected) => {
    const failure = providerFailure({
      ...detail,
      message: "private key or screenshot contents",
    });
    expect(failure.message).toContain(expected);
    expect(failure.message).not.toContain("private key or screenshot contents");
    expect(failure.status).toBe(502);
  },
);

it("never echoes unknown provider error details", () => {
  expect(
    providerFailure(new Error("secret screen content")).message,
  ).not.toContain("secret screen content");
});
