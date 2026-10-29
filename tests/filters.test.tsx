// @vitest-environment jsdom
import React from "react";
import { afterEach, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import SessionList from "../src/components/SessionList";
import type { Session } from "../shared/schema";
afterEach(cleanup);
it("filters persisted sessions by text, status and local date and clears the filters", () => {
  const base = {
    mode: "mock",
    frames: 0,
    attempts: 0,
    failedFrames: 0,
    notes: "",
    startedAt: null,
    endedAt: null,
    intervalSeconds: 5,
  };
  const sessions: Session[] = [
    {
      ...base,
      id: "one",
      title: "Morning review",
      createdAt: new Date(2026, 9, 28, 12).toISOString(),
      status: "stopped",
    },
    {
      ...base,
      id: "two",
      title: "Evening practice",
      createdAt: new Date(2026, 9, 29, 12).toISOString(),
      status: "created",
    },
  ];
  render(<SessionList sessions={sessions} onOpen={vi.fn()} />);
  expect(
    screen.getByRole("button", { name: "Morning review" }),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Search sessions"), {
    target: { value: "Morning" },
  });
  expect(
    screen.queryByRole("button", { name: "Evening practice" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  fireEvent.change(screen.getByLabelText("Session status"), {
    target: { value: "created" },
  });
  expect(
    screen.queryByRole("button", { name: "Morning review" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  fireEvent.change(screen.getByLabelText("From date"), {
    target: { value: "2026-10-29" },
  });
  expect(
    screen.queryByRole("button", { name: "Morning review" }),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("To date"), {
    target: { value: "2026-10-28" },
  });
  expect(screen.getByRole("alert")).toHaveTextContent("From date");
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(
    screen.getByRole("button", { name: "Morning review" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Evening practice" }),
  ).toBeInTheDocument();
});
