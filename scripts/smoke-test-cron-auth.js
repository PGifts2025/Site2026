#!/usr/bin/env node
/**
 * Local smoke test for the /api/cron/sync-laltex handler auth layer.
 *
 * Exercises the handler in-process with three mock req/res pairs:
 *   1. No Authorization header      -> expect 401
 *   2. Wrong CRON_SECRET             -> expect 401
 *   3. Correct Bearer CRON_SECRET    -> expect 200
 *
 * Does NOT run the full sync — case (3) completes a real sync via
 * the same code path as the CLI, which is what we actually want
 * from a smoke test (prove the handler can reach a 200 response).
 *
 * Usage:
 *   node scripts/smoke-test-cron-auth.js
 *
 * Exits 0 iff all three assertions pass.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function mockReqRes(authHeader) {
  const headers = {};
  if (authHeader != null) headers.authorization = authHeader;

  let statusCode = null;
  let body = null;

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
    end() { return this; },
  };

  return { req: { headers }, res, getStatus: () => statusCode, getBody: () => body };
}

async function runCase(label, authHeader, expectStatus) {
  // Fresh import-per-case is overkill; the handler has no module state
  // we need to reset. Static import once.
  const { default: handler } = await import('../api/cron/sync-laltex.js');
  const { req, res, getStatus, getBody } = mockReqRes(authHeader);
  console.log(`[smoke] case: ${label}`);
  await handler(req, res);
  const gotStatus = getStatus();
  const gotBody = getBody();
  const pass = gotStatus === expectStatus;
  console.log(`  expected status=${expectStatus}  got status=${gotStatus}  ${pass ? 'PASS' : 'FAIL'}`);
  if (gotBody) {
    // Don't log full sync result (can be huge). Show shape.
    if (gotBody.runId) {
      console.log(`  body: { runId: "${gotBody.runId}", status: "${gotBody.status}", fetched: ${gotBody.fetched}, inserted: ${gotBody.inserted}, updated: ${gotBody.updated}, failed: ${gotBody.failed}, durationMs: ${gotBody.durationMs} }`);
    } else {
      console.log(`  body: ${JSON.stringify(gotBody)}`);
    }
  }
  return pass;
}

async function main() {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[smoke] CRON_SECRET missing from site/.env — cannot run cases 2/3');
    process.exit(1);
  }

  const results = [];
  results.push(await runCase('no Authorization header', null, 401));
  results.push(await runCase('wrong secret', 'Bearer wrong-secret-value', 401));
  results.push(await runCase('correct Bearer CRON_SECRET', `Bearer ${secret}`, 200));

  const passed = results.filter(Boolean).length;
  console.log(`\n[smoke] ${passed}/${results.length} cases passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error('[smoke] UNCAUGHT:', err);
  process.exit(1);
});
