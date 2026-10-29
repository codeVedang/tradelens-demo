// @vitest-environment jsdom
import React from "react";
import { afterEach, it, expect, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import App from "../src/App";
import { Capture } from "../src/capture";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mockApi() {
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.endsWith("/config/status")
          ? {
              provider: "mock",
              simulated: true,
              intervalSeconds: 5,
              retentionDays: 30,
            }
          : [],
    })),
  );
}
it("requires consent before starting capture and displays denied permission", async () => {
  mockApi();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getDisplayMedia: vi
        .fn()
        .mockRejectedValue(new DOMException("Denied", "NotAllowedError")),
    },
  });
  render(<App />);
  fireEvent.click(screen.getByText("Live coach"));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Start recording" }),
    ).toBeDisabled(),
  );
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "permission was denied",
  );
  expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledTimes(1);
});
it("handles ended capture and cleans media tracks", async () => {
  let ended: () => void = () => {};
  const track = {
    stop: vi.fn(),
    addEventListener: vi.fn((_event: string, callback: () => void) => {
      ended = callback;
    }),
  };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getDisplayMedia: vi.fn().mockResolvedValue(stream) },
  });
  const capture = new Capture(),
    callback = vi.fn();
  capture.onEnded = callback;
  await capture.request();
  ended();
  expect(callback).toHaveBeenCalled();
  await capture.stop();
  expect(track.stop).toHaveBeenCalledTimes(1);
  expect(capture.stream).toBeUndefined();
});
it("reports browser capture limitations clearly", async () => {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: undefined,
  });
  await expect(new Capture().request()).rejects.toThrow(
    "supported desktop browser",
  );
});
it("renders mock labels and a truthful empty session history", async () => {
  mockApi();
  render(<App />);
  expect((await screen.findAllByText("MOCK MODE")).length).toBeGreaterThan(0);
  expect(
    screen.getByText("Your first session is a fresh start"),
  ).toBeInTheDocument();
  expect(screen.queryByText(/profit/i)).not.toBeInTheDocument();
});
