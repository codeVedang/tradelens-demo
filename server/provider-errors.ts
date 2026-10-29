// Translate only recognized error fields. Never return raw provider messages,
// which may contain credential fragments or submitted screen information.
export function providerFailure(error: unknown): Error & { status: number } {
  const detail = error as {
    status?: number;
    code?: string;
    name?: string;
  } | null;
  let message =
    "AI analysis failed. Check backend configuration, model access or provider availability.";
  if (detail?.status === 401 || detail?.code === "invalid_api_key") {
    message =
      "OpenAI rejected the API key (401). Replace OPENAI_API_KEY in the backend .env, save it, restart the app, and start a new session. Do not share your key.";
  } else if (detail?.code === "insufficient_quota") {
    message =
      "OpenAI API quota is unavailable. Check API billing, available credits and project limits before starting another session.";
  } else if (
    detail?.status === 403 ||
    detail?.status === 404 ||
    detail?.code === "model_not_found"
  ) {
    message =
      "OpenAI denied access to the configured model. Check OPENAI_MODEL and this API project's permissions, then restart the app.";
  } else if (detail?.status === 429) {
    message =
      "OpenAI rate limit reached. Pause capture, increase the analysis interval in Settings, then start a new session later.";
  } else if (
    detail?.name === "APIConnectionTimeoutError" ||
    detail?.name === "APIUserAbortError"
  ) {
    message =
      "OpenAI analysis timed out. Pause capture and check your connection and the configured model's response time.";
  } else if (detail?.name === "APIConnectionError") {
    message =
      "Cannot connect to OpenAI. Check your internet connection and proxy or firewall configuration.";
  } else if (detail?.status === 400) {
    message =
      "OpenAI rejected the analysis request (400). The configured model or request format needs checking; changing the key may not fix this.";
  } else if (detail?.code === "output_limit") {
    message =
      "AI output was incomplete: output token limit reached. Increase AI_MAX_OUTPUT_TOKENS or configure an appropriate AI_REASONING_EFFORT for your model, then restart.";
  } else if (
    detail?.code === "malformed_response" ||
    detail?.code === "incomplete_response"
  ) {
    message =
      "AI returned an incomplete or invalid structured response. No findings were saved for this frame.";
  } else if (detail?.code === "provider_refusal") {
    message =
      "AI declined this frame. No findings were saved; try a non-sensitive demo window.";
  }
  const code =
    detail?.status === 401 || detail?.code === "invalid_api_key"
      ? "AI_AUTH"
      : detail?.code === "insufficient_quota"
        ? "AI_QUOTA"
        : detail?.status === 403 || detail?.status === 404
          ? "AI_MODEL_ACCESS"
          : detail?.status === 429
            ? "AI_RATE_LIMIT"
            : "AI_FAILURE";
  return Object.assign(new Error(message), {
    status: 502,
    code,
    fatal: ["AI_AUTH", "AI_QUOTA", "AI_MODEL_ACCESS"].includes(code),
  });
}
