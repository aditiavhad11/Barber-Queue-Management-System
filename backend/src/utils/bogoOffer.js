export function calculateBogoReward(eligibleServices, quantities, requiredQuantities, freeQuantity, rewardService) {
  const free = Number(freeQuantity);
  const ids = eligibleServices.map((service) => String(service.id));
  if (!Number.isInteger(free) || free < 1 || !ids.length || ids.some((id) => !Number.isInteger(Number(requiredQuantities?.[id])) || Number(requiredQuantities[id]) < 1)) return null;
  const groups = Math.min(...ids.map((id) => Math.floor(Number(quantities[id] || 0) / Number(requiredQuantities[id]))));
  const rewardCount = groups * free;
  const reward = rewardService;
  if (!rewardCount || !reward) return null;
  return { serviceId: String(reward.id), quantity: rewardCount, service: reward, groups };
}

export function barberCanFulfillBogo(barberServiceIds, requiredServiceIds, rewardServiceId) {
  const supported = new Set((barberServiceIds || []).map(String));
  const rewards = Array.isArray(rewardServiceId) ? rewardServiceId.map(String) : [String(rewardServiceId)];
  return [...requiredServiceIds.map(String), ...rewards].every((id) => supported.has(id));
}

export function normalizeBogoRewardSelection(raw, allowedIds, maxRewardCount) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const allowed = new Set(allowedIds.map(String));
  const entries = Object.entries(raw);
  if (!entries.length) return null;
  const quantities = {};
  for (const [id, value] of entries) {
    const quantity = Number(value);
    if (!allowed.has(String(id)) || quantity !== 1) return null;
    quantities[String(id)] = quantity;
  }
  const count = Object.values(quantities).reduce((sum, quantity) => sum + quantity, 0);
  if (count < 1 || count > Number(maxRewardCount)) return null;
  return { quantities, count };
}

export function findBogoServiceOverlap(requiredServiceIds, rewardServiceIds) {
  const required = new Set((requiredServiceIds || []).map(String));
  return (rewardServiceIds || []).map(String).find((id) => required.has(id)) || null;
}
