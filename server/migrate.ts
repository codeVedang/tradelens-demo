import "dotenv/config";
import { Store } from "./db.js";
const store = await Store.open(
  process.env.DATABASE_PATH ?? "data/coach.sqlite",
);
store.save();
store.close();
console.info(
  "SQLite schema v2 initialized; existing v1 files are backed up before migration.",
);
