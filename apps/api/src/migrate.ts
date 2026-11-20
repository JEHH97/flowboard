import { pool } from "./db/index.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const migration = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../migrations/0001_init.sql",
);
await pool.query(await readFile(migration, "utf8"));
await pool.end();
console.log("Database migration applied.");
