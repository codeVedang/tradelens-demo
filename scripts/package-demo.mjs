import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url))),
  destination = path.join(
    root,
    "release",
    `tradelens-demo-source-${Date.now()}`,
  );
const directories = ["src", "server", "shared", "scripts", "tests"];
const files = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.server.json",
  "vite.config.ts",
  "index.html",
  ".gitignore",
  ".env.example",
  "README.md",
  "render.yaml",
  "Dockerfile",
  ".dockerignore",
  "docs/HOSTED_DEMO.md",
  "docs/API.md",
  "docs/TESTING.md",
  "docs/DEPLOYMENT.md",
  "docs/IMPLEMENTATION_REPORT.md",
  "PROJECT_STATUS.md",
];
fs.mkdirSync(path.join(root, "release"), { recursive: true });
fs.mkdirSync(destination);
const included = [];
function copy(relative) {
  const source = path.join(root, relative),
    stat = fs.lstatSync(source);
  if (stat.isSymbolicLink())
    throw new Error("Source packaging refuses symbolic links");
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(source))
      copy(path.join(relative, entry));
    return;
  }
  if (
    !/\.(tsx?|mjs|json|jpg|svg|css|html|md|yaml)$/.test(relative) &&
    !files.includes(relative)
  )
    throw new Error("Unexpected source file type");
  if (stat.size > 2 * 1024 * 1024)
    throw new Error("Unexpected large source file");
  if (
    !relative.endsWith(".jpg") &&
    /sk-(?:proj-)?[A-Za-z0-9_-]{30,}/.test(fs.readFileSync(source, "utf8"))
  )
    throw new Error("Potential secret detected; source packaging stopped");
  const target = path.join(destination, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  included.push(relative.replaceAll("\\", "/"));
}
for (const dir of directories) copy(dir);
for (const file of files) copy(file);
fs.writeFileSync(
  path.join(destination, "SOURCE_MANIFEST.json"),
  JSON.stringify(
    {
      description:
        "Deployment source only. No .env, personal data, node_modules, Git history or recordings.",
      files: included,
    },
    null,
    2,
  ),
);
console.info(
  `Sanitized demo source: ${destination}\n${included.length} source files. Upload these contents to a dedicated private GitHub repository; do not upload the workspace drive root.`,
);
fs.writeFileSync(path.join(root, "release", "LATEST-DEMO.txt"), destination);
