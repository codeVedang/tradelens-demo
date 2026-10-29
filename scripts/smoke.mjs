import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "tradelens-smoke-"));
const reservation = net.createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`,
  token = "smoke-test-workspace-token-24-chars";
let child;
async function launch() {
  child = spawn(process.execPath, ["dist-server/server/index.js"], {
    env: {
      ...process.env,
      PORT: String(port),
      FRONTEND_ORIGIN: base,
      DATABASE_PATH: path.join(root, "coach.sqlite"),
      AI_PROVIDER: "mock",
      DEV_NO_AUTH: "false",
      APP_ACCESS_TOKEN: token,
      AI_ANALYSIS_INTERVAL_SECONDS: "5",
    },
    stdio: "ignore",
    windowsHide: true,
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) return;
    } catch {}
    if (child.exitCode !== null)
      throw new Error("Compiled server exited during startup");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Compiled server startup timed out");
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await exited;
}
async function call(url, method = "GET", body, expected = 200) {
  const res = await fetch(base + "/api" + url, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(res.status, expected, `${method} ${url}: ${res.status}`);
  return expected === 204 ? undefined : res.json();
}
try {
  await launch();
  assert.equal((await fetch(base + "/api/sessions")).status, 401);
  assert.equal((await fetch(base)).status, 200);
  const rule = await call(
    "/rules",
    "POST",
    {
      title: "Smoke checklist",
      description: "Synthetic reference only",
      enabled: true,
    },
    201,
  );
  const session = await call(
    "/sessions",
    "POST",
    { title: "Isolated smoke session" },
    201,
  );
  await call(`/sessions/${session.id}/start`, "POST", {});
  const body = {
    frameId: randomUUID(),
    timestampSeconds: 1,
    scenario: "deviation",
    image:
      "data:image/jpeg;base64," +
      fs.readFileSync("tests/fixtures/frame.jpg").toString("base64"),
  };
  const first = await call(`/sessions/${session.id}/frames`, "POST", body);
  assert.equal(first.observations[0].simulated, true);
  const again = await call(`/sessions/${session.id}/frames`, "POST", body);
  assert.equal(again.deduplicated, true);
  await call(`/events/${first.observations[0].id}/feedback`, "POST", {
    sessionId: session.id,
    status: "confirmed",
    notes: "Smoke review",
  });
  await call(`/sessions/${session.id}/heartbeat`, "POST", { capturedCount: 8 });
  const report = await call(`/sessions/${session.id}/stop`, "POST", {});
  assert.equal(report.framesCaptured, 8);
  assert.equal(report.framesAnalyzed, 1);
  assert.equal(report.confirmed.length, 1);
  const exported = await call(`/sessions/${session.id}/export?format=json`);
  assert.equal(exported.confirmed[0].notes, "Smoke review");
  await stop();
  await launch();
  const reopened = await call(`/sessions/${session.id}/report`);
  assert.equal(reopened.confirmed.length, 1);
  assert.equal((await call("/rules"))[0].id, rule.id);
  await call(`/sessions/${session.id}`, "DELETE", undefined, 204);
  await call(`/rules/${rule.id}`, "DELETE", undefined, 204);
  console.info(
    "PASS: compiled startup/static page, bearer gate, rule/session/frame flow, idempotency, review/report/export, database restart persistence and deletion. No paid API calls.",
  );
} finally {
  await stop();
  const resolved = path.resolve(root),
    allowed = path.resolve(os.tmpdir()) + path.sep;
  if (
    !resolved.startsWith(allowed) ||
    !path.basename(resolved).startsWith("tradelens-smoke-")
  )
    throw new Error("Refusing unexpected cleanup path");
  fs.rmSync(resolved, { recursive: true, force: true });
}
