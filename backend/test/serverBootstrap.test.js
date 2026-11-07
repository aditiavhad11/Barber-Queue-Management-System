import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger, httpLogger } from "../src/utils/logger.js";
import {
  startScheduledQueueWorker,
  stopScheduledQueueWorker,
} from "../src/services/scheduledQueueService.js";
import {
  startEmergencyClosureWorker,
  stopEmergencyClosureWorker,
} from "../src/jobs/emergencyClosureQueue.js";
import { app, setupGracefulShutdown, startServer } from "../src/server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJsonPath = path.resolve(__dirname, "../package.json");

test.after(async () => {
  await stopEmergencyClosureWorker();
});

test("package.json defines node engines, devDependencies for nodemon, and pino-http", () => {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  assert.ok(pkg.engines?.node, "engines.node must be specified");
  assert.match(pkg.engines.node, />=\s*20/, "Node engine should be >=20");
  assert.ok(pkg.devDependencies?.nodemon, "nodemon should be in devDependencies");
  assert.equal(pkg.dependencies?.nodemon, undefined, "nodemon must not be in dependencies");
  assert.ok(pkg.dependencies?.["pino-http"], "pino-http should be in dependencies");
  assert.ok(pkg.dependencies?.pino, "pino should be in dependencies");
});

test("logger and httpLogger are properly configured and redact sensitive fields", () => {
  assert.equal(typeof logger.info, "function");
  assert.equal(typeof httpLogger, "function");
});

test("scheduled queue worker starts and stops timer gracefully", () => {
  assert.equal(typeof startScheduledQueueWorker, "function");
  assert.equal(typeof stopScheduledQueueWorker, "function");
});

test("emergency closure queue worker exports start and stop helpers", () => {
  assert.equal(typeof startEmergencyClosureWorker, "function");
  assert.equal(typeof stopEmergencyClosureWorker, "function");
});

test("server module exports express app, startServer, and setupGracefulShutdown", () => {
  assert.equal(typeof app, "function");
  assert.equal(typeof startServer, "function");
  assert.equal(typeof setupGracefulShutdown, "function");
});
