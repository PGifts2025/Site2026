#!/usr/bin/env node
/**
 * apply-migration.js — apply a single .sql migration file to the live
 * Supabase DB via the Management API.
 *
 * Usage:
 *   node scripts/apply-migration.js supabase/migrations/<file>.sql
 *
 * Auth: SUPABASE_ACCESS_TOKEN (PAT) from site/.env. Matches the
 * Management API pattern used by sync-laltex-product.js (session 1).
 * See CLAUDE.md §27.2 — Management API + PAT is the right tool for
 * DDL / single-shot SQL; PostgREST + service_role is for bulk DML.
 *
 * Exit codes: 0 ok / 1 anything else.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const PROJECT_REF = 'cbcevjhvgmxrxeeyldza';
const MGMT_SQL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

async function main() {
  const sqlPath = process.argv[2];
  if (!sqlPath) {
    console.error('Usage: node scripts/apply-migration.js <path/to/migration.sql>');
    process.exit(1);
  }
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    console.error('[migrate] SUPABASE_ACCESS_TOKEN missing from site/.env');
    process.exit(1);
  }

  const absPath = path.isAbsolute(sqlPath) ? sqlPath : path.join(process.cwd(), sqlPath);
  const sql = await fs.readFile(absPath, 'utf8');
  console.log(`[migrate] applying ${path.basename(absPath)} (${sql.length} bytes)`);

  const resp = await fetch(MGMT_SQL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  const text = await resp.text();
  if (!resp.ok) {
    console.error(`[migrate] FAILED: HTTP ${resp.status}`);
    console.error(text);
    process.exit(1);
  }
  console.log('[migrate] OK');
  if (text && text !== '[]') console.log(text);
}

main().catch((err) => {
  console.error('[migrate] UNCAUGHT:', err);
  process.exit(1);
});
