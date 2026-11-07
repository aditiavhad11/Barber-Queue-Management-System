import { calculateBogoReward, barberCanFulfillBogo, findBogoServiceOverlap, normalizeBogoRewardSelection } from "../utils/bogoOffer.js";
import { hasActiveNewCustomerOfferReservation, hasSuccessfulCompletedBooking, isOfferValueWithinCap, NEW_CUSTOMER_RESERVATION_MINUTES } from "../utils/offerEligibility.js";
import { isWithinHappyHour } from "../utils/happyHour.js";
import { calculateOfferDiscount } from "../utils/offerDiscount.js";
import { jsonIds } from "../utils/json.js";
import { money } from "../utils/money.js";

/**
 * Evaluate which scheme/offer (if any) applies to a booking.
 *
 * @param {import('mysql2/promise').Connection} connection  - DB connection (may be transactional)
 * @param {object} params
 * @returns {Promise<object>} Scheme evaluation result
 */
export async function evaluateScheme(
  connection,
  {
    shopId,
    barberId,
    serviceIds,
    serviceQuantities,
    services,
    customerId,
    bookingDate,
    scheduledTime = null,
    promoCode,
    bogoOfferId,
    rewardServiceQuantities = {},
    schemeId,
    lock = false,
  },
) {
  const code = String(promoCode || "")
    .trim()
    .toUpperCase();
  if (rewardServiceQuantities != null && (typeof rewardServiceQuantities !== "object" || Array.isArray(rewardServiceQuantities)))
    throw Object.assign(new Error("Free reward selections must be provided as service quantities."), { status: 400 });
  const hasRewardSelection = Object.keys(rewardServiceQuantities || {}).length > 0;
  const evaluationNow = new Date();
  let sql = `SELECT * FROM schemes WHERE shop_id=? AND status='active'
    AND starts_at<=UTC_TIMESTAMP() AND ends_at>=UTC_TIMESTAMP()`;
  const params = [shopId];
  if (schemeId) {
    sql += " AND id=?";
    params.push(schemeId);
  } else if (code) {
    sql += " AND UPPER(promo_code)=?";
    params.push(code);
  } else sql += " AND promo_code IS NULL";
  if (bogoOfferId && !schemeId) {
    sql += " AND id=?";
    params.push(bogoOfferId);
  }
  sql += lock ? " FOR UPDATE" : "";
  const [candidates] = await connection.query(sql, params);
  if (!candidates.length && code)
    throw Object.assign(
      new Error("This promo code is not active or valid for this booking."),
      { status: 400 },
    );
  if (schemeId && !candidates.length)
    throw Object.assign(
      new Error("This offer is no longer valid. Request a new payment quote."),
      { status: 409 },
    );
  if (bogoOfferId && !candidates.length)
    throw Object.assign(new Error("This BOGO offer is no longer eligible. Refresh the booking and choose rewards again."), { status: 409 });

  const serviceById = new Map(
    services.map((service) => [String(service.id), service]),
  );
  let customerHasCompletedBooking = false;
  let customerHasNewCustomerReservation = false;
  if (candidates.some((offer) => Boolean(offer.new_customer_only))) {
    const [completedRows] = await connection.query(
      `SELECT status,queue_status FROM payment_bookings
       WHERE customer_id=? AND status IN ('accepted','paid') AND queue_status='Completed' LIMIT 1`,
      [customerId],
    );
    customerHasCompletedBooking = hasSuccessfulCompletedBooking(completedRows);
    if (!customerHasCompletedBooking) {
      const [reservationRows] = await connection.query(
        `SELECT status,queue_status FROM payment_bookings
         WHERE customer_id=? AND (
           (status='payment_submitted' AND created_at > (NOW() - INTERVAL ${NEW_CUSTOMER_RESERVATION_MINUTES} MINUTE))
           OR (status IN ('accepted','paid') AND COALESCE(queue_status,'') NOT IN ('Cancelled','No Show'))
         )
           AND scheme_id IN (SELECT id FROM schemes WHERE new_customer_only=1) LIMIT 1`,
        [customerId],
      );
      customerHasNewCustomerReservation = hasActiveNewCustomerOfferReservation(reservationRows);
    }
  }
  const baseAmount = money(services.reduce((sum, service) => sum + Number(service.price) * serviceQuantities[String(service.id)], 0));
  let bestAutomatic = null;
  let ineligibleBogoBarber = false;
  const offerMessages = [];
  for (const offer of candidates) {
    if (bogoOfferId && offer.offer_type !== 'bogo') throw Object.assign(new Error('The selected offer is not a BOGO offer.'), { status: 400 });
    if (offer.happy_hour_start_time != null || offer.happy_hour_end_time != null) {
      const happyHourDays = jsonIds(offer.happy_hour_days_json);
      if (!isWithinHappyHour({
        startTime: offer.happy_hour_start_time,
        endTime: offer.happy_hour_end_time,
        days: happyHourDays,
        bookingDate,
        scheduledTime,
        now: evaluationNow,
      })) {
        const dayText = happyHourDays.length ? ` on ${happyHourDays.join(", ")}` : "";
        const message = `${offer.title} is available from ${String(offer.happy_hour_start_time || "").slice(0, 5)} to ${String(offer.happy_hour_end_time || "").slice(0, 5)}${dayText} in shop local time (end time excluded).`;
        if (code || schemeId || bogoOfferId) throw Object.assign(new Error(message), { status: 400 });
        offerMessages.push(`${message} It was not applied to this booking.`);
        continue;
      }
    }
    if (offer.new_customer_only && (customerHasCompletedBooking || customerHasNewCustomerReservation)) {
      const message = customerHasCompletedBooking
        ? "This new-customer offer is only available before your first completed booking."
        : "A new-customer offer is already reserved by another pending booking.";
      if (code || schemeId || bogoOfferId) throw Object.assign(new Error(message), { status: 403 });
      offerMessages.push(`${offer.title} was not applied: ${message}`);
      continue;
    }
    const eligibleServiceIds = offer.all_services
      ? serviceIds
      : jsonIds(offer.service_ids_json).filter((id) => serviceById.has(id));
    if (!eligibleServiceIds.length) {
      if (code || schemeId || bogoOfferId)
        throw Object.assign(
          new Error("This offer does not apply to the selected services."),
          { status: 400 },
        );
      if (offer.offer_type === "bogo") offerMessages.push(`${offer.title} was not applied: select the required purchased services shown in the offer details.`);
      continue;
    }
    if (
      !offer.all_barbers &&
      !jsonIds(offer.barber_ids_json).includes(String(barberId))
    ) {
      if (offer.offer_type === "bogo") {
        const requiredIds = jsonIds(offer.service_ids_json);
        const requiredQuantities = typeof offer.required_service_quantities_json === "string"
          ? JSON.parse(offer.required_service_quantities_json || "{}")
          : offer.required_service_quantities_json || {};
        const qualifies = requiredIds.length > 0 && requiredIds.every((id) =>
          serviceById.has(id) && Number(serviceQuantities[id] || 0) >= Number(requiredQuantities[id] || 0),
        );
        if (qualifies) throw Object.assign(new Error("This BOGO offer is not available with the selected barber. Choose an eligible barber or change the selected services."), { status: 400 });
      }
      if (code || schemeId || bogoOfferId)
        throw Object.assign(
          new Error("This offer does not apply to the selected barber."),
          { status: 400 },
        );
      if (offer.offer_type === "bogo") offerMessages.push(`${offer.title} was not applied: it is not available with the selected barber.`);
      continue;
    }
    if (baseAmount < Number(offer.minimum_amount || 0)) {
      if (code || schemeId || bogoOfferId)
        throw Object.assign(
          new Error(
            `This offer requires a minimum booking amount of ₹${Number(offer.minimum_amount).toFixed(2)}.`,
          ),
          { status: 400 },
        );
      if (offer.offer_type === "bogo") offerMessages.push(`${offer.title} was not applied: the booking does not meet its minimum amount of ₹${Number(offer.minimum_amount).toFixed(2)}.`);
      continue;
    }
    const [useRows] = await connection.query(
      `SELECT COUNT(*) AS uses,COALESCE(SUM(customer_id=?),0) AS customer_uses
       FROM payment_bookings WHERE scheme_id=? AND (
         (status='payment_submitted' AND created_at > (NOW() - INTERVAL ${NEW_CUSTOMER_RESERVATION_MINUTES} MINUTE))
         OR (status IN ('accepted','paid') AND COALESCE(queue_status,'') NOT IN ('Cancelled','No Show'))
       )`,
      [customerId, offer.id],
    );
    const uses = Number(useRows[0]?.uses || 0);
    const customerUses = Number(useRows[0]?.customer_uses || 0);
    if (
      (offer.usage_limit != null && uses >= Number(offer.usage_limit)) ||
      (offer.per_customer_limit != null &&
        customerUses >= Number(offer.per_customer_limit))
    ) {
      if (code || schemeId || bogoOfferId)
        throw Object.assign(
          new Error("This offer has reached its redemption limit."),
          { status: 409 },
        );
      if (offer.offer_type === "bogo") offerMessages.push(`${offer.title} was not applied because its redemption limit has been reached.`);
      continue;
    }
    const eligibleSubtotal = money(eligibleServiceIds.reduce((sum, id) => sum + Number(serviceById.get(id).price) * serviceQuantities[id], 0));
    if (offer.offer_type === "bogo") {
      const requiredIds = jsonIds(offer.service_ids_json);
      const configuredRewardIds = jsonIds(offer.reward_service_ids_json);
      if (findBogoServiceOverlap(requiredIds, [...configuredRewardIds, ...(offer.reward_service_id ? [String(offer.reward_service_id)] : [])]))
        throw Object.assign(new Error("This BOGO offer has a service configured as both paid and free."), { status: 400 });
      const requiredQuantities = typeof offer.required_service_quantities_json === "string"
        ? JSON.parse(offer.required_service_quantities_json || "{}")
        : offer.required_service_quantities_json || {};
      const allRequiredSelected = requiredIds.length > 0 && requiredIds.every((id) => serviceById.has(id));
      if (!allRequiredSelected) {
        if (code || schemeId || bogoOfferId) throw Object.assign(new Error("Select all required services for this offer."), { status: 400 });
        offerMessages.push(`${offer.title} was not applied: select all of its required services and quantities.`);
        continue;
      }
      const requiredQuantitiesMet = requiredIds.every((id) => Number(serviceQuantities[id] || 0) >= Number(requiredQuantities[id] || 0));
      if (!requiredQuantitiesMet) {
        if (code || schemeId || bogoOfferId) throw Object.assign(new Error("The selected paid service quantities do not meet this BOGO offer's requirements."), { status: 400 });
        offerMessages.push(`${offer.title} was not applied: increase the required paid service quantities.`);
        continue;
      }
      let freeServiceQuantities;
      let rewardTargets;
      if (configuredRewardIds.length) {
        const selection = normalizeBogoRewardSelection(rewardServiceQuantities, configuredRewardIds, Number(offer.max_reward_count || 1));
        if (!selection) {
          if (code || schemeId || bogoOfferId) throw Object.assign(new Error(`Choose between 1 and ${Number(offer.max_reward_count || 1)} valid free rewards for this offer.`), { status: 400 });
          offerMessages.push(`${offer.title}: choose free reward(s) to apply this offer.`);
          continue;
        }
        freeServiceQuantities = selection.quantities;
        const rewardIds = Object.keys(freeServiceQuantities);
        const [rows] = await connection.query(
          `SELECT id,name,price,duration_minutes FROM services WHERE shop_id=? AND enabled=1 AND id IN (${rewardIds.map(() => "?").join(",")})`,
          [shopId, ...rewardIds],
        );
        if (rows.length !== rewardIds.length) throw Object.assign(new Error("One or more selected free rewards are no longer active in this shop."), { status: 400 });
        rewardTargets = rows;
      } else {
        if (hasRewardSelection) throw Object.assign(new Error("This existing offer does not allow reward selection."), { status: 400 });
        const [rewardRows] = await connection.query(
          "SELECT id,name,price,duration_minutes FROM services WHERE shop_id=? AND id=? AND enabled=1 LIMIT 1",
          [shopId, offer.reward_service_id],
        );
        const legacyReward = rewardRows[0];
        const reward = legacyReward ? calculateBogoReward(requiredIds.map((id) => serviceById.get(id)), serviceQuantities, requiredQuantities, Number(offer.free_quantity || 0), legacyReward) : null;
        if (!reward) {
          if (code || schemeId || bogoOfferId) throw Object.assign(new Error("The required services, quantities, or reward service are no longer valid for this offer."), { status: 400 });
          offerMessages.push(`${offer.title} was not applied because its required quantities or configured reward service are unavailable.`);
          continue;
        }
        freeServiceQuantities = { [reward.serviceId]: reward.quantity };
        rewardTargets = [legacyReward];
      }
      const rewardIds = Object.keys(freeServiceQuantities);
      const rewardsById = new Map(rewardTargets.map((reward) => [String(reward.id), reward]));
      const rewardCount = Object.values(freeServiceQuantities).reduce((sum, quantity) => sum + Number(quantity), 0);
      const discount = money(rewardIds.reduce((sum, id) => sum + Number(rewardsById.get(id).price) * Number(freeServiceQuantities[id]), 0));
      if (!isOfferValueWithinCap(discount, offer.maximum_discount)) {
        const message = `The selected BOGO rewards exceed this offer's maximum reward value of ₹${Number(offer.maximum_discount).toFixed(2)}.`;
        if (code || schemeId || bogoOfferId) throw Object.assign(new Error(message), { status: 400 });
        offerMessages.push(`${offer.title} was not applied: ${message}`);
        continue;
      }
      const rewardDuration = rewardIds.reduce((sum, id) => sum + Number(rewardsById.get(id).duration_minutes) * Number(freeServiceQuantities[id]), 0);
      const rewardNames = rewardIds.map((id) => ({ id, name: rewardsById.get(id).name, quantity: Number(freeServiceQuantities[id]) }));
      const eligible = {
        schemeId: offer.id, discountAmount: discount, originalAmount: money(baseAmount + discount),
        discountedSubtotal: baseAmount, freeServiceQuantities,
        rewardServiceQuantities: configuredRewardIds.length ? freeServiceQuantities : {},
        duration: services.reduce((sum, service) => sum + Number(service.duration_minutes) * serviceQuantities[String(service.id)], 0) + rewardDuration,
        promoCode: offer.promo_code || "",
        scheme: { id: offer.id, title: offer.title, offerType: "bogo", requiredServices: requiredIds.map((id) => ({ id, name: serviceById.get(id).name, quantity: Number(requiredQuantities[id]) })), buyQuantity: Object.values(requiredQuantities).reduce((sum, qty) => sum + Number(qty), 0), freeQuantity: rewardCount, maxRewardCount: Number(offer.max_reward_count || offer.free_quantity || 1), rewardServiceId: rewardIds[0], rewardServiceName: rewardsById.get(rewardIds[0])?.name, rewardServices: rewardNames },
      };
      const [barberCanReward] = await connection.query(
        `SELECT service_id FROM barber_services WHERE barber_id=? AND service_id IN (${[...requiredIds, ...rewardIds].map(() => "?").join(",")})`,
        [barberId, ...requiredIds, ...rewardIds],
      );
      if (!barberCanFulfillBogo(barberCanReward.map((row) => row.service_id), requiredIds, rewardIds)) {
        if (code || schemeId || bogoOfferId) throw Object.assign(new Error(`The selected barber cannot provide all required services for ${offer.title}, including the selected free reward(s). Choose another barber or change the selected services.`), { status: 400 });
        ineligibleBogoBarber = true;
        continue;
      }
      const [unavailableReward] = await connection.query(
        `SELECT service_id FROM service_unavailability WHERE shop_id=? AND service_id IN (${rewardIds.map(() => "?").join(",")}) AND unavailable_date=? LIMIT 1`,
        [shopId, ...rewardIds, bookingDate],
      );
      if (unavailableReward.length) {
        if (code || schemeId || bogoOfferId) throw Object.assign(new Error("One or more selected free services are unavailable on the selected date."), { status: 409 });
        offerMessages.push(`${offer.title} was not applied because one or more selected rewards are unavailable on the selected date.`);
        continue;
      }
      if (code || schemeId || bogoOfferId) return eligible;
      if (!bestAutomatic || eligible.discountAmount > bestAutomatic.discountAmount) bestAutomatic = eligible;
      continue;
    }
    if (hasRewardSelection) throw Object.assign(new Error("Free rewards can only be selected for an eligible BOGO offer."), { status: 400 });
    const discount = calculateOfferDiscount({
      eligibleSubtotal,
      baseAmount,
      discountType: offer.discount_type,
      discountValue: offer.discount_value,
      maximumDiscount: offer.maximum_discount,
    });
    if (discount >= baseAmount) {
      if (code || schemeId || bogoOfferId)
        throw Object.assign(
          new Error("This offer cannot reduce the booking to a zero payment."),
          { status: 400 },
        );
      continue;
    }
    if (discount <= 0) {
      if (code || schemeId || bogoOfferId)
        throw Object.assign(
          new Error(
            "This offer does not provide a discount for the selected services.",
          ),
          { status: 400 },
        );
      continue;
    }
    const eligible = {
      schemeId: offer.id,
      discountAmount: discount,
      originalAmount: baseAmount,
      discountedSubtotal: money(baseAmount - discount),
      promoCode: offer.promo_code || "",
      scheme: {
        id: offer.id,
        title: offer.title,
        offerType: "discount",
        discountType: offer.discount_type,
        discountValue: Number(offer.discount_value),
      },
    };
    if (code || schemeId || bogoOfferId) return eligible;
    if (
      !bestAutomatic ||
      eligible.discountAmount > bestAutomatic.discountAmount
    )
      bestAutomatic = eligible;
  }
  if (bestAutomatic) {
    if (hasRewardSelection && bestAutomatic.scheme?.offerType !== "bogo") throw Object.assign(new Error("Free rewards can only be selected for an eligible BOGO offer."), { status: 400 });
    return { ...bestAutomatic, offerMessages };
  }
  if (ineligibleBogoBarber) throw Object.assign(new Error("The selected barber cannot provide the free service for this BOGO offer. Choose an eligible barber or change the selected services."), { status: 400 });
  if (hasRewardSelection) throw Object.assign(new Error("Free rewards can only be selected for an eligible BOGO offer."), { status: 400 });
  return {
    schemeId: null,
    discountAmount: 0,
    originalAmount: baseAmount,
    discountedSubtotal: baseAmount,
    freeServiceQuantities: {},
    promoCode: "",
    scheme: null,
    offerMessages,
  };
}

