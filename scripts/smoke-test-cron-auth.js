#!/usr/bin/env node
/**
 * Local smoke test for the /api/cron/* handler auth layer.
 *
 * Exercises each handler in-process with three mock req/res pairs:
 *   1. No Authorization header      -> expect 401
 *   2. Wrong CRON_SECRET             -> expect 401
 *   3. Correct Bearer CRON_SECRET    -> expect 200
 *
 * Case (3) runs the real job (sync or embed) via the same code path
 * the cron will use in production — so "passing" means both the auth
 * contract AND the happy-path reach a 200. For embed, this is quick
 * in steady state (hash gate makes it a no-op); for sync, this takes
 * ~50s on a warm catalogue.
 *
 * Usage:
 *   node scripts/smoke-test-cron-auth.js             # tests both routes
 *   node scripts/smoke-test-cron-auth.js sync        # only sync-laltex
 *   node scripts/smoke-test-cron-auth.js embed       # only embed-laltex
 *
 * Exits 0 iff every tested route's three cases pass.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const ROUTES = {
  sync:  { label: 'sync-laltex',  path: '../api/cron/sync-laltex.js' },
  embed: { label: 'embed-laltex', path: '../api/cron/embed-laltex.js' },
};

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

function shapeBodyForLog(body) {
  if (!body) return '(no body)';
  // runId present → job result; show compact summary.
  if (body.runId) {
    const keys = ['runId', 'status', 'fetched', 'considered', 'inserted', 'updated',
                  'embedRequested', 'embedSkipped', 'failed', 'tokensUsed', 'costUsd', 'durationMs'];
    const compact = {};
    for (const k of keys) if (k in body) compact[k] = body[k];
    return JSON.stringify(compact);
  }
  return JSON.stringify(body);
}

async function runCase(handler, label, authHeader, expectStatus) {
  const { req, res, getStatus, getBody } = mockReqRes(authHeader);
  console.log(`[smoke] case: ${label}`);
  await handler(req, res);
  const gotStatus = getStatus();
  const pass = gotStatus === expectStatus;
  console.log(`  expected status=${expectStatus}  got status=${gotStatus}  ${pass ? 'PASS' : 'FAIL'}`);
  const body = getBody();
  if (body) console.log(`  body: ${shapeBodyForLog(body)}`);
  return pass;
}

async function runRoute(routeKey) {
  const route = ROUTES[routeKey];
  if (!route) throw new Error(`unknown route "${routeKey}" — valid: ${Object.keys(ROUTES).join(', ')}`);

  console.log(`\n=== Route: ${route.label} ===`);
  const { default: handler } = await import(route.path);

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[smoke] CRON_SECRET missing from site/.env — cannot run cases 2/3');
    return false;
  }

  const results = [];
  results.push(await runCase(handler, 'no Authorization header', null, 401));
  results.push(await runCase(handler, 'wrong secret', 'Bearer wrong-secret-value', 401));
  results.push(await runCase(handler, 'correct Bearer CRON_SECRET', `Bearer ${secret}`, 200));

  const passed = results.filter(Boolean).length;
  console.log(`[smoke] ${route.label}: ${passed}/${results.length} cases passed`);
  return passed === results.length;
}

async function main() {
  const onlyRoute = process.argv[2];
  const keys = onlyRoute ? [onlyRoute] : Object.keys(ROUTES);

  let allPassed = true;
  for (const k of keys) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await runRoute(k);
    if (!ok) allPassed = false;
  }
  console.log(`\n[smoke] overall: ${allPassed ? 'PASS' : 'FAIL'}`);
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('[smoke] UNCAUGHT:', err);
  process.exit(1);
});
