// Loads the monorepo .env before any test module so Prisma sees DATABASE_URL.
import { env } from "../src/env.js";
env();
