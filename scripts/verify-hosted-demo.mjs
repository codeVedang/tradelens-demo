import assert from "node:assert/strict";

const origin = new URL(process.argv[2]);
assert.equal(origin.protocol, "https:", "Use the deployed HTTPS URL");
const request = (path, options = {}) =>
  fetch(new URL(path, origin), { signal: AbortSignal.timeout(30000), ...options });

const home = await request("/");
assert.equal(home.status, 200);
assert.match(await home.text(), /Tradzyn/);
assert.equal((await request("/api/health")).status, 200);
assert.equal((await request("/api/public/plan")).status, 200);
assert.equal((await request("/api/journal")).status, 401);
const protectedPage = await request("/app", { redirect: "manual" });
assert.equal(protectedPage.status, 302);
assert.equal(protectedPage.headers.get("location"), "/login");
console.info("PASS: hosted landing, health, pricing, and account protection.");
