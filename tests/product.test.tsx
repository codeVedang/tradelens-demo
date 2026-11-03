// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import Site, { type Subscription } from "../src/Account";
import App from "../src/App";

const account = {
  id: "test-owner",
  name: "Example Trader",
  email: "trader@example.test",
};
const free: Subscription = {
  plan: { name: "Premium", price: null, period: null },
  active: false,
  status: "FREE",
  paidThrough: null,
  demo: false,
  checkoutEnabled: false,
  manageEnabled: false,
  payments: [],
};
const answer = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  history.replaceState({}, "", "/");
});
it("shows the public landing page, pricing, section navigation and both entry points", async () => {
  const fetcher = vi.fn(async (_url: string) => answer(free.plan));
  vi.stubGlobal("fetch", fetcher);
  render(<Site />);
  expect(screen.getByRole("heading", { name: /trade better/i })).toBeVisible();
  expect(screen.getByRole("link", { name: "Features" })).toHaveAttribute(
    "href",
    "#features",
  );
  expect(screen.getByRole("link", { name: "How It Works" })).toHaveAttribute(
    "href",
    "#how",
  );
  expect(screen.getByRole("link", { name: "Pricing" })).toHaveAttribute(
    "href",
    "#pricing",
  );
  expect(screen.getAllByRole("link", { name: "Login" })[0]).toHaveAttribute(
    "href",
    "/login",
  );
  expect(
    screen.getAllByRole("link", { name: "Get Started" })[0],
  ).toHaveAttribute("href", "/signup");
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(fetcher.mock.calls[0]?.[0]).toBe("/api/public/plan");
});
it("offers Google on the sign-up page and scopes demo controls to an enabled environment", async () => {
  history.replaceState({}, "", "/signup");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      answer({ profile: null, googleConfigured: true, demoEnabled: false }),
    ),
  );
  render(<Site />);
  expect(
    screen.getByRole("heading", { name: "Create your account" }),
  ).toBeVisible();
  expect(
    await screen.findByRole("link", { name: "Continue with Google" }),
  ).toHaveAttribute("href", "/api/auth/google");
  expect(screen.queryByLabelText("Password")).toBeNull();
});
it("shows the free journal, saves the four fields, and locks recording without requesting permission", async () => {
  let entry:
    | {
        id: string;
        date: string;
        notes: string;
        expectedCents: number;
        realCents: number;
      }
    | undefined;
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === "/api/journal" && options?.method === "POST") {
      const body = JSON.parse(String(options.body));
      entry = {
        id: "fixture",
        date: body.date,
        notes: body.notes,
        expectedCents: Number(body.expected) * 100,
        realCents: Number(body.real) * 100,
      };
      return answer(entry, 201);
    }
    if (url.startsWith("/api/journal?")) return answer(entry ? [entry] : []);
    if (url === "/api/journal/analytics")
      return answer({
        count: entry ? 1 : 0,
        currency: "INR",
        expectedCents: entry?.expectedCents ?? 0,
        realCents: entry?.realCents ?? 0,
        differenceCents: entry ? entry.realCents - entry.expectedCents : 0,
        positive: 0,
        negative: 0,
        flat: 0,
        trend: [],
        recent: entry ? [entry] : [],
      });
    return answer({
      simulated: true,
      intervalSeconds: 5,
      captureIntervalSeconds: 1,
      retentionDays: 30,
    });
  });
  vi.stubGlobal("fetch", fetcher);
  URL.revokeObjectURL = vi.fn();
  render(<App account={account} subscription={free} logout={() => {}} />);
  expect(
    await screen.findByRole("heading", { name: "Performance dashboard" }),
  ).toBeVisible();
  expect(screen.queryByText("Strategy & rules")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Add journal entry" }));
  fireEvent.change(screen.getByLabelText("Date", { exact: true }), {
    target: { value: "2026-11-01" },
  });
  fireEvent.change(screen.getByLabelText("Notes"), {
    target: { value: "Synthetic test note" },
  });
  fireEvent.change(screen.getByLabelText(/Expected P&L/), {
    target: { value: "10.50" },
  });
  fireEvent.change(screen.getByLabelText(/Real P&L/), {
    target: { value: "-2.75" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save entry" }));
  await screen.findByText("Synthetic test note");
  expect(entry).toMatchObject({
    date: "2026-11-01",
    expectedCents: 1050,
    realCents: -275,
  });
  fireEvent.click(screen.getByRole("button", { name: "AI Companion" }));
  expect(
    screen.getByRole("heading", { name: "AI Screen Recording Companion" }),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: "Start recording" })).toBeNull();
  expect(
    fetcher.mock.calls.some(([url]) => url.startsWith("/api/sessions")),
  ).toBe(false);
});
