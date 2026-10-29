import test from "node:test";
import assert from "node:assert/strict";
import { calculateBogoReward, barberCanFulfillBogo, normalizeBogoRewardSelection, findBogoServiceOverlap } from "../src/utils/bogoOffer.js";

test("rejects an exact service ID used as both qualifying and reward service", () => {
  assert.equal(findBogoServiceOverlap(["beard", "cut"], ["spa", "beard"]), "beard");
  assert.equal(findBogoServiceOverlap([1], ["1"]), "1");
  assert.equal(findBogoServiceOverlap(["beard trim"], ["beard"]), null);
  assert.equal(findBogoServiceOverlap(["cut"], ["spa"]), null);
});

test("BOGO barber eligibility requires every paid service and the free reward", () => {
  assert.equal(barberCanFulfillBogo(["cut", "beard", "trim"], ["cut", "beard"], "trim"), true);
  assert.equal(barberCanFulfillBogo(["cut", "beard", "trim", "spa"], ["cut", "beard"], ["trim", "spa"]), true);
  assert.equal(barberCanFulfillBogo(["cut", "beard"], ["cut", "beard"], "trim"), false);
  assert.equal(barberCanFulfillBogo(["cut", "trim"], ["cut", "beard"], "trim"), false);
});

test("accepts multiple configured reward selections within the independent cap", () => {
  assert.deepEqual(normalizeBogoRewardSelection({ spa: 1, massage: 1, hairwash: 1 }, ["spa", "massage", "hairwash"], 3), {
    quantities: { spa: 1, massage: 1, hairwash: 1 }, count: 3,
  });
  assert.equal(normalizeBogoRewardSelection({ spa: 1 }, ["spa"], 1).count, 1);
  assert.equal(normalizeBogoRewardSelection({ spa: 1, massage: 1 }, ["spa", "massage"], 2).count, 2);
});

test("rejects rewards outside the configured list and selections above the cap", () => {
  assert.equal(normalizeBogoRewardSelection({ other: 1 }, ["spa"], 3), null);
  assert.equal(normalizeBogoRewardSelection({ spa: 2, massage: 2 }, ["spa", "massage"], 3), null);
  assert.equal(normalizeBogoRewardSelection({ spa: 2 }, ["spa"], 3), null);
  assert.equal(normalizeBogoRewardSelection([{ serviceId: "spa" }], ["spa"], 3), null);
});

test("repeats rewards for complete required service groups", () => {
  const services = [{ id: "haircut", price: 200 }, { id: "beard", price: 80 }, { id: "spa", price: 400 }];
  assert.deepEqual(calculateBogoReward(services.slice(0, 2), { haircut: 2, beard: 2 }, { haircut: 1, beard: 1 }, 1, services[2]), {
    serviceId: "spa", quantity: 2, service: services[2], groups: 2,
  });
});

test("requires every selected service and its configured quantity", () => {
  const services = [{ id: "haircut", price: 200 }, { id: "beard", price: 80 }, { id: "spa", price: 400 }];
  assert.equal(calculateBogoReward(services.slice(0, 2), { haircut: 2 }, { haircut: 1, beard: 1 }, 1, services[2]), null);
  assert.equal(calculateBogoReward(services.slice(0, 2), { haircut: 2, beard: 1 }, { haircut: 1, beard: 1 }, 1, services[2]).quantity, 1);
});

test("uses the owner-configured reward even when it was not purchased", () => {
  const eligible = [
    { id: "haircut", price: 200 },
    { id: "spa", price: 300 },
    { id: "beard", price: 100 },
  ];
  const reward = calculateBogoReward(eligible.slice(0, 2), { haircut: 1, spa: 1 }, { haircut: 1, spa: 1 }, 1, eligible[2]);
  assert.equal(reward.serviceId, "beard");
  assert.equal(reward.quantity, 1);
});
