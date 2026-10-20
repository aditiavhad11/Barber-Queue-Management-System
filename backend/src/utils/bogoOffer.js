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
  return [...requiredServiceIds.map(String), String(rewardServiceId)].every((id) => supported.has(id));
}
