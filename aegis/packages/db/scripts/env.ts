import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// Load the monorepo root .env, then the package-local one if present.
const here = dirname(fileURLToPath(import.meta.url));
config({ path: join(here, "..", "..", "..", ".env") });
config();
