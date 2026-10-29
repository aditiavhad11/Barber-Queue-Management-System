import test from "node:test";
import assert from "node:assert/strict";
import { calculateOfferDiscount } from "../src/utils/offerDiscount.js";

test("percentage discounts use the eligible paid-service subtotal and honor the maximum cap", () => {
  assert.equal(calculateOfferDiscount({ eligibleSubtotal: 500, baseAmount: 500, discountType: "percentage", discountValue: 20 }), 100);
  assert.equal(calculateOfferDiscount({ eligibleSubtotal: 500, baseAmount: 700, discountType: "percentage", discountValue: 20, maximumDiscount: 75 }), 75);
});

test("fixed discounts are bounded by the eligible subtotal and total paid amount", () => {
  assert.equal(calculateOfferDiscount({ eligibleSubtotal: 80, baseAmount: 200, discountType: "fixed", discountValue: 100 }), 80);
  assert.equal(calculateOfferDiscount({ eligibleSubtotal: 200, baseAmount: 50, discountType: "fixed", discountValue: 100 }), 50);
});

test("invalid or non-positive configured discount values produce no discount", () => {
  assert.equal(calculateOfferDiscount({ eligibleSubtotal: 200, baseAmount: 200, discountType: "percentage", discountValue: 0 }), 0);
  assert.equal(calculateOfferDiscount({ eligibleSubtotal: 200, baseAmount: 200, discountType: "percentage", discountValue: "bad" }), 0);
});
