import "dotenv/config";
import fs from "node:fs";
import sharp from "sharp";
import { createProvider } from "../server/providers.js";
import { providerFailure } from "../server/provider-errors.js";
import { analysisSchema } from "../shared/schema.js";
// The flag is deliberate: status checks and application startup never spend money.
if (!process.argv.includes("--allow-paid")) {
  console.info(
    "No API request made. This command sends one synthetic image (or --image path) to your configured model and may incur charges. Run npm.cmd run ai:check -- --allow-paid to opt in.",
  );
  process.exit(0);
}
if (process.env.AI_PROVIDER !== "openai") {
  console.error(
    "Set AI_PROVIDER=openai in backend .env first. No API request made.",
  );
  process.exit(1);
}
const imageArg = process.argv.indexOf("--image");
let raw: Buffer;
if (imageArg >= 0) {
  const file = process.argv[imageArg + 1];
  if (!file) throw new Error("--image requires a local path");
  const stat = fs.statSync(file);
  if (stat.size > 10 * 1024 * 1024)
    throw new Error("Input image exceeds 10 MB");
  raw = await sharp(fs.readFileSync(file), { limitInputPixels: 16000000 })
    .resize({
      width: 1280,
      height: 1280,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 75 })
    .toBuffer();
} else
  raw = await sharp(
    Buffer.from(
      '<svg width="800" height="400" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="400" fill="white"/><text x="30" y="80" font-size="30">SYNTHETIC COACH CONNECTION TEST</text><text x="30" y="150" font-size="26">Checklist incomplete. Risk not shown.</text><text x="30" y="220" font-size="26">No real trades or account information.</text></svg>',
    ),
  )
    .jpeg()
    .toBuffer();
if (raw.length > 512000) throw new Error("Prepared image exceeds 500 KB");
const controller = new AbortController(),
  timer = setTimeout(
    () => controller.abort(),
    Number(process.env.AI_TIMEOUT_MS || 60000),
  ),
  started = Date.now();
try {
  const provider = createProvider({ ...process.env, AI_MAX_RETRIES: "0" });
  const output = analysisSchema.parse(
    await provider.analyze({
      image: "data:image/jpeg;base64," + raw.toString("base64"),
      timestampSeconds: 0,
      rules: [],
      scenario: "normal",
      signal: controller.signal,
    }),
  );
  console.info(
    JSON.stringify({
      ok: true,
      provider: provider.mode,
      model: provider.model,
      latencyMs: Date.now() - started,
      structuredResponseValidated: true,
      observations: output.observations.length,
      accuracyVerified: false,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      error: providerFailure(error).message,
      latencyMs: Date.now() - started,
    }),
  );
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
}
