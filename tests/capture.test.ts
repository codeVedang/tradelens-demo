// @vitest-environment jsdom
import { afterEach, it, expect, vi } from "vitest";
import { Capture } from "../src/capture";
import { api, ApiError, setWorkspaceToken, notifyPageClosed } from "../src/api";
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setWorkspaceToken("");
});
function browser() {
  const track = {
    readyState: "live",
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getDisplayMedia: vi.fn(async () => ({
        getVideoTracks: () => [track],
        getTracks: () => [track],
      })),
    },
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(
    2560,
  );
  vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(
    1440,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as any);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/jpeg;base64,/9j/2Q==",
  );
  return track;
}
it("captures periodically with a one-frame latest queue, no overlapping sends and pause cleanup", async () => {
  vi.useFakeTimers();
  const track = browser(),
    capture = new Capture();
  let release!: () => void;
  const send = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await capture.request();
  await capture.begin(5, send, false, vi.fn(), { captureIntervalSeconds: 1 });
  expect(send).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(16000);
  expect(send).toHaveBeenCalledTimes(1);
  expect(capture.capturedCount).toBe(17);
  release();
  await Promise.resolve();
  send.mockImplementation(async () => {});
  await vi.advanceTimersByTimeAsync(1000);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenLastCalledWith(
    expect.any(String),
    expect.any(Number),
    expect.objectContaining({ frameId: expect.any(String) }),
  );
  capture.pause();
  const count = capture.capturedCount;
  await vi.advanceTimersByTimeAsync(10000);
  expect(capture.capturedCount).toBe(count);
  capture.pause();
  await vi.advanceTimersByTimeAsync(1000);
  expect(capture.capturedCount).toBeGreaterThan(count);
  const a = capture.stop(),
    b = capture.stop();
  expect(a).toBe(b);
  await a;
  expect(track.stop).toHaveBeenCalledTimes(1);
  expect(track.removeEventListener).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it("retries a lost transport response with exactly the same frame request", async () => {
  const transport = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("network lost"))
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ observations: [] }),
    });
  vi.stubGlobal("fetch", transport);
  await api(
    "/sessions/test/frames",
    "POST",
    { frameId: "same-id" },
    { retryTransport: true },
  );
  expect(transport).toHaveBeenCalledTimes(2);
  expect(transport.mock.calls[0][1].body).toBe(transport.mock.calls[1][1].body);
});
it("does not retry known authentication failures and retains actionable codes", async () => {
  const transport = vi.fn(async () => ({
    ok: false,
    status: 502,
    json: async () => ({ error: "Key rejected", code: "AI_AUTH", fatal: true }),
  }));
  vi.stubGlobal("fetch", transport);
  await expect(
    api("/frames", "POST", {}, { retryTransport: true }),
  ).rejects.toMatchObject({ code: "AI_AUTH", fatal: true });
  expect(transport).toHaveBeenCalledTimes(1);
});
it("does not double the request deadline by replaying an expired request", async () => {
  vi.useFakeTimers();
  const transport = vi.fn(
    (_url: string, options: any) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => reject(new DOMException("Expired", "AbortError")),
          { once: true },
        );
      }),
  );
  vi.stubGlobal("fetch", transport);
  const pending = api(
    "/frames",
    "POST",
    {},
    { retryTransport: true, timeoutMs: 20 },
  );
  const assertion = expect(pending).rejects.toMatchObject({
    code: "CLIENT_TIMEOUT",
  });
  await vi.advanceTimersByTimeAsync(21);
  await assertion;
  expect(transport).toHaveBeenCalledTimes(1);
});
it("sends a best-effort close notification without including any OpenAI credential", () => {
  const beacon = vi.fn();
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: beacon,
  });
  notifyPageClosed("session-test", 12);
  expect(beacon).toHaveBeenCalledTimes(1);
  expect(beacon.mock.calls[0][0]).toBe("/api/sessions/session-test/stop");
  expect(beacon.mock.calls[0][1]).toBeInstanceOf(Blob);
});
it("cleans a stream granted after capture was already cancelled", async () => {
  const track = browser();
  let grant!: (value: MediaStream) => void;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getDisplayMedia: vi.fn(
        () =>
          new Promise<MediaStream>((resolve) => {
            grant = resolve;
          }),
      ),
    },
  });
  const capture = new Capture(),
    pending = capture.request();
  capture.cancel();
  grant({
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream);
  await expect(pending).rejects.toThrow("Unable to share");
  expect(track.stop).toHaveBeenCalledTimes(1);
  expect(capture.stream).toBeUndefined();
});
