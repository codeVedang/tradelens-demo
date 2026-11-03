import "dotenv/config";
import { Store } from "../server/db.js";
import { demoAllowed, seedDemo } from "../server/accounts.js";
import { serverConfig } from "../server/config.js";

const config = serverConfig(process.env);
if (!demoAllowed(process.env, config.FRONTEND_ORIGIN))
  throw new Error(
    "Enable local demo login with ENABLE_DEMO_LOGIN=true before seeding.",
  );
const store = await Store.open(config.DATABASE_PATH);
try {
  const account = seedDemo(store);
  console.info(
    "Local demo credentials. Save privately. Running this command again rotates the password.",
  );
  console.info(account.email);
  console.info(account.password);
} finally {
  store.close();
}
