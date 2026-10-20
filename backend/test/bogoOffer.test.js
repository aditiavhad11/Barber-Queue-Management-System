import test from "node:test";
import assert from "node:assert/strict";
import { calculateBogoReward, barberCanFulfillBogo } from "../src/utils/bogoOffer.js";

test("BOGO barber eligibility requires every paid service and the free reward", () => {
  assert.equal(barberCanFulfillBogo(["cut", "beard", "trim"], ["cut", "beard"], "trim"), true);
  assert.equal(barberCanFulfillBogo(["cut", "beard"], ["cut", "beard"], "trim"), false);
  assert.equal(barberCanFulfillBogo(["cut", "trim"], ["cut", "beard"], "trim"), false);
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
