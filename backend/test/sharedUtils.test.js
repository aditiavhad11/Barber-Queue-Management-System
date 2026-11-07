import test from "node:test";
import assert from "node:assert/strict";
import { money } from "../src/utils/money.js";
import { parseJson, jsonArray, jsonIds, parseIds, parseObject } from "../src/utils/json.js";
import {
  SHOP_TIME_ZONE,
  todayIST,
  localDateKey,
  nowTimeIST,
  localTimeKey,
  clockMinutes,
  minutesBetween,
  minutesUntilAppointment,
  weekdayIST,
  isValidDateKey,
} from "../src/utils/time.js";

test("money utility rounds to 2 decimals accurately", () => {
  assert.equal(money(10.555), 10.56);
  assert.equal(money("12.34"), 12.34);
  assert.equal(money(100), 100);
  assert.equal(money(0), 0);
  assert.equal(money(10.124), 10.12);
  assert.equal(money(10.125), 10.13);
});

test("json parse helpers handle valid, empty, and invalid inputs gracefully", () => {
  // parseJson
  assert.deepEqual(parseJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJson(null, { default: true }), { default: true });
  assert.deepEqual(parseJson("", {}), {});
  assert.deepEqual(parseJson("invalid json", { fallback: 1 }), { fallback: 1 });
  assert.deepEqual(parseJson({ already: "object" }), { already: "object" });

  // jsonArray / jsonIds / parseIds
  assert.deepEqual(jsonArray('["1", "2", 3]'), ["1", "2", "3"]);
  assert.deepEqual(jsonArray([1, 2, 3]), ["1", "2", "3"]);
  assert.deepEqual(jsonArray(null), []);
  assert.deepEqual(jsonArray(""), []);
  assert.deepEqual(jsonArray("not an array"), []);
  assert.deepEqual(jsonIds('["10"]'), ["10"]);
  assert.deepEqual(parseIds('["20"]'), ["20"]);

  // parseObject
  assert.deepEqual(parseObject('{"serviceId": 2}'), { serviceId: 2 });
  assert.deepEqual(parseObject('["not", "an", "object"]', {}), {});
  assert.deepEqual(parseObject(null, {}), {});
  assert.deepEqual(parseObject({ direct: true }), { direct: true });
});

test("time utility formats IST date and time correctly", () => {
  // Fixed timestamp: 2026-11-07 14:30:00 UTC = 2026-11-07 20:00:00 IST (+05:30)
  const utcDate = new Date("2026-11-07T14:30:00Z");
  assert.equal(todayIST(utcDate), "2026-11-07");
  assert.equal(localDateKey(utcDate), "2026-11-07");
  assert.equal(nowTimeIST(utcDate), "20:00");
  assert.equal(localTimeKey(utcDate), "20:00");

  // Late night UTC that crosses over into next day IST:
  // 2026-11-07 22:00:00 UTC = 2026-11-08 03:30:00 IST
  const lateDate = new Date("2026-11-07T22:00:00Z");
  assert.equal(todayIST(lateDate), "2026-11-08");
  assert.equal(nowTimeIST(lateDate), "03:30");

  assert.equal(weekdayIST("2026-11-07"), "Sat");
  assert.equal(weekdayIST("2026-11-08"), "Sun");
});

test("clockMinutes and minutesBetween calculate accurate minute values", () => {
  assert.equal(clockMinutes("09:00:00"), 540);
  assert.equal(clockMinutes("21:00"), 1260);
  assert.equal(clockMinutes("9:05"), 545);
  assert.equal(clockMinutes("invalid"), null);

  assert.equal(minutesBetween("09:00", "09:30"), 30);
  assert.equal(minutesBetween("10:00", "09:30"), -30);

  const start = new Date("2026-11-07T10:00:00Z");
  const end = new Date("2026-11-07T10:45:00Z");
  assert.equal(minutesBetween(start, end), 45);

  const now = new Date("2026-10-17T10:00:00+05:30");
  assert.equal(minutesUntilAppointment("2026-10-17", "10:30:00", now), 30);
});

test("isValidDateKey accurately checks date format and validity", () => {
  assert.equal(isValidDateKey("2026-11-07"), true);
  assert.equal(isValidDateKey("2026-02-29"), false); // 2026 is not a leap year
  assert.equal(isValidDateKey("2026-13-01"), false);
  assert.equal(isValidDateKey("invalid"), false);
  assert.equal(isValidDateKey(""), false);
});

