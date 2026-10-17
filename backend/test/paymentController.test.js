import test from "node:test";
import assert from "node:assert/strict";

function clockMinutes(value, fallback) {
  const match = String(value || fallback).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours > 23 ||
    minutes > 59
  )
    return null;
  return hours * 60 + minutes;
}

test("normalizes persisted opening times with seconds", () => {
  assert.equal(clockMinutes("09:00:00"), 540);
  assert.equal(clockMinutes("21:00:00"), 1260);
});

test("accepts a valid appointment at the closing boundary", () => {
  const start = clockMinutes("20:30");
  const close = clockMinutes("21:00:00");
  assert.equal(start + 30 <= close, true);
});

test("accepts single-digit persisted hours", () => {
  assert.equal(clockMinutes("9:05:00"), 545);
});
