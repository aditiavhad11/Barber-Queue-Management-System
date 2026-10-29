const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export function calculateOfferDiscount({ eligibleSubtotal, baseAmount, discountType, discountValue, maximumDiscount = null }) {
  const subtotal = Math.max(0, Number(eligibleSubtotal) || 0);
  const base = Math.max(0, Number(baseAmount) || 0);
  const value = Number(discountValue);
  if (!Number.isFinite(value) || value <= 0) return 0;
  let discount = discountType === "percentage"
    ? money((subtotal * value) / 100)
    : Math.min(subtotal, value);
  if (maximumDiscount != null) discount = Math.min(discount, Number(maximumDiscount));
  return money(Math.min(discount, subtotal, base));
}
