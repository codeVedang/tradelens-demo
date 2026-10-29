let workspaceToken = "";
export function setWorkspaceToken(value: string) {
  workspaceToken = value;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public fatal = false,
  ) {
    super(message);
  }
}
export type RequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  retryTransport?: boolean;
};
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const attempts = options.retryTransport ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController(),
      abort = () => controller.abort();
    if (options.signal?.aborted)
      throw new DOMException("Request aborted", "AbortError");
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 130000,
    );
    try {
      const response = await fetch("/api" + path, {
        method,
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(workspaceToken
            ? { Authorization: "Bearer " + workspaceToken }
            : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const data = await response
          .json()
          .catch(() => ({ error: "Server unavailable" }));
        throw new ApiError(
          data.error ?? "Request failed",
          response.status,
          data.code,
          data.fatal ?? false,
        );
      }
      return response.status === 204 ? (undefined as T) : await response.json();
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (
        error instanceof ApiError ||
        (error instanceof DOMException && error.name === "AbortError") ||
        !(error instanceof TypeError) ||
        attempt === attempts - 1
      )
        throw error instanceof DOMException && error.name === "AbortError"
          ? new ApiError(
              "Request timed out. Check connectivity and review processing history.",
              504,
              "CLIENT_TIMEOUT",
            )
          : error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
  }
  throw new Error("Request failed");
}
export async function exportReport(id: string, format: "json" | "csv") {
  const response = await fetch(`/api/sessions/${id}/export?format=${format}`, {
    headers: workspaceToken
      ? { Authorization: "Bearer " + workspaceToken }
      : {},
  });
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: "Export failed" }));
    throw new Error(error.error);
  }
  const blob = await response.blob(),
    url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = `session-${id}.${format}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function notifyPageClosed(id: string, capturedCount: number) {
  const body = JSON.stringify({ reason: "page_closed", capturedCount });
  if (workspaceToken) {
    void fetch(`/api/sessions/${id}/stop`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + workspaceToken,
      },
      body,
      keepalive: true,
    }).catch(() => {});
  } else if (navigator.sendBeacon) {
    navigator.sendBeacon(
      `/api/sessions/${id}/stop`,
      new Blob([body], { type: "application/json" }),
    );
  }
}
