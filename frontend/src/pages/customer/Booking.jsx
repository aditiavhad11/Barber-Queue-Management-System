import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useOwner } from "../../hooks/useOwnerStore";
import { api } from "../../services/api";
import { Badge, Rating } from "../../components/common/ui";
import SearchableServiceSelector from "../../components/common/SearchableServiceSelector";
import { activeOf, etaFor } from "../../utils/ownerEta";
import {
  isShopOpenNow,
  getTemporaryClosure,
  formatDateDisplay,
  getTimeSlotSuggestions,
  scheduleOf,
  normalizeDayShifts,
} from "../../utils/closedDays";
import { AlertTriangle, X } from "lucide-react";
import {
  isValidEmail,
  isValidPhone,
  isValidName,
} from "../../utils/validators";

const steps = ["Service", "Barber", "Review", "Policies", "Payment"];
const bookingToday = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year").value}-${parts.find((part) => part.type === "month").value}-${parts.find((part) => part.type === "day").value}`;
};
const formatOfferTime = (value) => {
  if (!value) return "";
  const [hour, minute] = String(value).slice(0, 5).split(":").map(Number);
  return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, "0")}` : ""} ${hour >= 12 ? "PM" : "AM"}`;
};
const WEEKDAY_NAMES = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };


export default function Booking() {
  const { id } = useParams();
  const nav = useNavigate();
  const { shops, customerQueues, customer } = useOwner();
  const shop = shops.find(
    (s) => s.id === id && s.status === "approved" && s.active,
  );

  const [step, setStep] = useState(0);
  const [sids, setSids] = useState([]);
  const [serviceQuantities, setServiceQuantities] = useState({});
  const [selectedBogoOfferId, setSelectedBogoOfferId] = useState("");
  const [rewardServiceQuantities, setRewardServiceQuantities] = useState({});
  const [bid, setBid] = useState(null);
  const [agree, setAgree] = useState(false);
  const [forWhom, setForWhom] = useState("self");
  const [friend, setFriend] = useState({ name: "", mobile: "", email: "" });

  const [quote, setQuote] = useState(null);
  const quoteRequestId = useRef(0);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [appliedPromoCode, setAppliedPromoCode] = useState("");
  const [submitBusy, setSubmitBusy] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [payerName, setPayerName] = useState("");
  const [bookingDate, setBookingDate] = useState(bookingToday());
  const [scheduledTime, setScheduledTime] = useState("");
  const [dateRestrictions, setDateRestrictions] = useState([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(true);
  const [availabilityError, setAvailabilityError] = useState("");
  const [publicOffers, setPublicOffers] = useState([]);

  const activeSelfBooking = customerQueues?.find(
    (q) =>
      q.entry.customerId === customer?.id &&
      ["Waiting", "Your Turn", "In Service"].includes(q.entry.status),
  );

  const selected = (shop?.servicesList || []).filter((s) =>
    sids.includes(s.id),
  );
  const unavailableByService = new Map(
    dateRestrictions.map((restriction) => [restriction.serviceId, restriction]),
  );
  const blockedSelection = selected.some((service) =>
    unavailableByService.has(service.id),
  );
  const total = selected.reduce((n, s) => n + Number(s.price || 0) * Number(serviceQuantities[s.id] || 1), 0);
  const duration = selected.reduce((n, s) => n + Number(s.duration || 0) * Number(serviceQuantities[s.id] || 1), 0);
  const applicableBogoOffers = publicOffers.filter((offer) => {
    if (offer.newCustomerOnly && offer.customerEligible === false) return false;
    const requiredIds = (offer.serviceIds || []).map(String);
    const rewardIds = (offer.rewardServiceIds?.length ? offer.rewardServiceIds : offer.rewardServiceId ? [offer.rewardServiceId] : []).map(String);
    const hasAvailableReward = rewardIds.some((rewardId) => shop?.servicesList?.some((service) => String(service.id) === rewardId && service.enabled !== false));
    return offer.offerType === "bogo" && requiredIds.length > 0 &&
      hasAvailableReward &&
      total >= Number(offer.minimumAmount || 0) &&
      requiredIds.every((sid) => sids.includes(sid) && Number(serviceQuantities[sid] || 1) >= Number(offer.requiredQuantities?.[sid] || 1));
  }).filter((offer) => !offer.promoCode
    ? !appliedPromoCode
    : String(offer.promoCode).toUpperCase() === appliedPromoCode);
  const activeBogoOffer = applicableBogoOffers.find((offer) => String(offer.id) === String(selectedBogoOfferId)) || applicableBogoOffers[0] || null;
  const activeRewardIds = (activeBogoOffer?.rewardServiceIds?.length
    ? activeBogoOffer.rewardServiceIds.map(String)
    : activeBogoOffer?.rewardServiceId ? [String(activeBogoOffer.rewardServiceId)] : [])
    .filter((rewardId) => shop?.servicesList?.some((service) => String(service.id) === rewardId && service.enabled !== false));
  const selectedRewards = activeBogoOffer?.rewardSelectionEnabled
    ? Object.fromEntries(Object.entries(rewardServiceQuantities).filter(([sid]) => activeRewardIds.includes(sid)))
    : {};
  const selectedRewardCount = Object.values(selectedRewards).reduce((sum, quantity) => sum + Number(quantity || 0), 0);
  const rewardLimit = Number(activeBogoOffer?.maxRewardCount || activeBogoOffer?.freeQuantity || 1);
  const serviceEligibleBarbers = (shop?.barbersList || []).filter(
    (b) => !sids.length || sids.every((sid) => (b.services || []).map(String).includes(sid)),
  );
  const shopBarbers = serviceEligibleBarbers.filter((barber) =>
    !activeBogoOffer ||
      ((activeBogoOffer.allBarbers || (activeBogoOffer.barberIds || []).map(String).includes(String(barber.id))) &&
      (activeBogoOffer.rewardSelectionEnabled
        ? (Object.keys(selectedRewards).length ? Object.keys(selectedRewards).every((sid) => (barber.services || []).map(String).includes(sid)) : activeRewardIds.some((sid) => (barber.services || []).map(String).includes(sid)))
        : activeRewardIds.every((sid) => (barber.services || []).map(String).includes(sid)))),
  );
  const solo = shopBarbers.length === 1 && !activeBogoOffer;
  const barber = shopBarbers.find(
    (b) => b.id === (solo ? shopBarbers[0]?.id : bid),
  );
  const wait = barber
    ? etaFor(
        shop?.servicesList || [],
        shop?.queues?.[barber.id] || [],
        activeOf(shop?.queues?.[barber.id] || []).length,
      )
    : 0;

  const beneficiaryBody = () =>
    forWhom === "self"
      ? { isSelf: true }
      : {
          isSelf: false,
          name: friend.name,
          mobile: friend.mobile,
          email: friend.email,
        };

  const loadQuote = async (code = appliedPromoCode) => {
    if (!shop || !barber || !sids.length || blockedSelection)
      return;
    const requestId = ++quoteRequestId.current;
    setQuoteBusy(true);
    setPaymentError("");
    try {
      const { data } = await api.post("/bookings/payment-quote", {
        shopId: id,
        serviceIds: sids,
        serviceQuantities,
        barberId: barber.id,
        bookingDate,
        scheduledTime: bookingDate === bookingToday() ? scheduledTime : "",
        promoCode: activeBogoOffer?.rewardSelectionEnabled && selectedRewardCount === 0 ? "" : code,
        bogoOfferId: activeBogoOffer?.rewardSelectionEnabled && selectedRewardCount > 0 ? activeBogoOffer.id : undefined,
        rewardServiceQuantities: selectedRewards,
        beneficiary: beneficiaryBody(),
      });
      if (requestId === quoteRequestId.current) setQuote(data);
    } catch (error) {
      const data = error.response?.data;
      if (requestId !== quoteRequestId.current) return;
      if (error.response?.status === 409 && data?.bookingId) {
        nav(`/app/queue/payment/${data.bookingId}`);
        return;
      }
      setQuote(null);
      setPaymentError(
        data?.message || "This shop cannot prepare the payment right now.",
      );
    } finally {
      if (requestId === quoteRequestId.current) setQuoteBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (!shop?.id || !bookingDate) return undefined;
    api
      .get(`/shops/${shop.id}/service-availability`, {
        params: { date: bookingDate },
      })
      .then(({ data }) => {
        if (!cancelled) setDateRestrictions(Array.isArray(data) ? data : []);
      })
      .catch((error) => {
        if (!cancelled)
          setAvailabilityError(
            error.response?.data?.message ||
              "Could not check service availability for this date.",
          );
      })
      .finally(() => {
        if (!cancelled) setAvailabilityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shop?.id, bookingDate]);

  useEffect(() => {
    let cancelled = false;
    if (!shop?.id) return undefined;
    api.get(`/schemes/shop/${shop.id}`, { toastOnError: false })
      .then(({ data }) => { if (!cancelled) setPublicOffers((Array.isArray(data) ? data : []).filter((offer) => offer.status === "active")); })
      .catch(() => { if (!cancelled) setPublicOffers([]); });
    return () => { cancelled = true; };
  }, [shop?.id]);

  useEffect(() => {
    if (step === 4) {
      setPayerName(customer?.name || "");
      loadQuote();
    }
  }, [
    step,
    id,
    barber?.id,
    sids.join(","),
    JSON.stringify(serviceQuantities),
    activeBogoOffer?.id,
    JSON.stringify(selectedRewards),
    forWhom,
    friend.name,
    friend.mobile,
    friend.email,
    bookingDate,
    scheduledTime,
    blockedSelection,
    appliedPromoCode,
  ]);

  const toggleService = (sid) => {
    setQuote(null);
    setPaymentError("");
    setRewardServiceQuantities({});
    setSelectedBogoOfferId("");
    setSids((prev) =>
      prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid],
    );
    setBid(null);
  };

  const changeRewardSelection = (serviceId, selected) => {
    setQuote(null);
    setRewardServiceQuantities((current) => {
      const next = { ...current };
      const currentCount = Object.keys(current).length;
      if (!selected) delete next[serviceId];
      else {
        if (currentCount >= rewardLimit || current[serviceId]) return current;
        next[serviceId] = 1;
      }
      return next;
    });
  };

  const next = () => setStep(step === 0 && solo ? 2 : step + 1);
  const back = () => setStep(step === 2 && solo ? 0 : step - 1);

  const submitPayment = async () => {
    if (submitBusy || quoteBusy || !quote?.amount || !barber) return;
    if (forWhom === "self" && activeSelfBooking) {
      setPaymentError("You already have an active queue booking for yourself.");
      return;
    }

    setSubmitBusy(true);
    setPaymentError("");

    try {
      const { data } = await api.post("/bookings/payment-submit", {
        shopId: id,
        serviceIds: sids,
        serviceQuantities,
        barberId: barber.id,
        bookingDate,
        scheduledTime: bookingDate === bookingToday() ? scheduledTime : "",
        beneficiary: beneficiaryBody(),
        payerName: payerName.trim(),
        quoteToken: quote.quoteToken,
      });

      nav(`/app/queue/payment/${data.booking.id}`);
    } catch (error) {
      const data = error.response?.data;
      if (
        (error.response?.status === 409 || error.response?.status === 429) &&
        data?.bookingId
      ) {
        nav(`/app/queue/payment/${data.bookingId}`);
        return;
      }
      setPaymentError(
        data?.message ||
          "Payment submission could not be created. Please try again.",
      );
    } finally {
      setSubmitBusy(false);
    }
  };

  const friendValid =
    forWhom !== "friend" ||
    (isValidName(friend.name) &&
      isValidPhone(friend.mobile) &&
      (friend.email === "" || isValidEmail(friend.email)));

  const canNext = [
    sids.length > 0 &&
      !!bookingDate &&
      !blockedSelection &&
      !availabilityLoading &&
      !availabilityError,
    !!barber && barber.status === "Available",
    friendValid,
    agree,
  ][step];

  const bogoRewardSelector = applicableBogoOffers.length > 0 && <section className="border border-khaki p-4 space-y-3"><p className="label">Choose BOGO rewards</p>{applicableBogoOffers.length > 1 && <div className="space-y-2">{applicableBogoOffers.map((offer) => <label key={offer.id} className="flex gap-2 text-sm"><input type="radio" name="booking-bogo-offer" checked={String(activeBogoOffer?.id) === String(offer.id)} onChange={() => { setSelectedBogoOfferId(String(offer.id)); setRewardServiceQuantities({}); setQuote(null); }} />{offer.title}</label>)}</div>}{activeBogoOffer?.rewardSelectionEnabled ? <><p className="text-sm">Select up to {rewardLimit} different reward services. Each selected service is free once.</p><SearchableServiceSelector services={shop.servicesList.filter((service) => activeRewardIds.includes(String(service.id)))} selectedIds={Object.keys(selectedRewards)} label="Search free reward services" onSelect={(service) => changeRewardSelection(String(service.id), true)} onRemove={(service) => changeRewardSelection(String(service.id), false)} disabled={(service) => dateRestrictions.some((restriction) => String(restriction.serviceId) === String(service.id)) || selectedRewardCount >= rewardLimit} selectedContent={(service) => <><b>{service.name}</b> · ₹{Number(service.price).toFixed(2)} <b className="text-olive">FREE</b></>} /><p className="text-xs text-soft">Selected {selectedRewardCount} of {rewardLimit} allowed.</p></> : <p className="text-sm">This existing BOGO offer applies its configured reward automatically.</p>}</section>;
  if (!shop) return <div className="fade">Shop is no longer available.</div>;

  const closure = getTemporaryClosure(shop);
  if (closure.isClosed) {
    return (
      <div className="fade max-w-xl mx-auto py-12">
        <div className="border border-rose/30 bg-rose/10 p-6 rounded-md">
          <div className="flex items-start gap-4">
            <AlertTriangle className="text-rose shrink-0 mt-0.5" size={24} />
            <div>
              <h2 className="font-semibold text-rose text-xl">
                Shop is Temporarily Closed
              </h2>
              <p className="text-sm text-coffee/90 mt-2">
                <b>{shop.name}</b> is temporarily closed from{" "}
                {formatDateDisplay(closure.startDate)} until{" "}
                <span className="font-semibold">
                  {formatDateDisplay(closure.endDate) || "further notice"}
                </span>
                .
              </p>
              {closure.reason ? (
                <div className="text-sm text-coffee/80 mt-3 p-3 rounded bg-white/40 border border-khaki">
                  <b>Reason:</b> &ldquo;{closure.reason}&rdquo;
                </div>
              ) : null}
              <p className="text-xs text-coffee/60 mt-3">
                Queue bookings are disabled during this closure period. Please
                check back later or book with another barber shop.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  to={`/app/shops/${shop.id}`}
                  className="btn-ghost !text-xs !py-2"
                >
                  View shop details
                </Link>
                <Link to="/app/shops" className="btn !text-xs !py-2">
                  Find other barbers
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isShopOpenNow(shop)) {
    return (
      <div className="fade max-w-xl mx-auto py-12">
        <div className="border border-khaki p-6 rounded-md">
          <h2 className="font-semibold text-xl">Shop is currently closed</h2>
          <p className="text-sm text-coffee/70 mt-2">
            The owner needs to open the shop before new bookings can be made.
            Please check again during the regular or flexible hours.
          </p>
          <Link to={`/app/shops/${shop.id}`} className="btn mt-5 inline-block">
            Back to shop
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="fade max-w-3xl">
      <p className="label">{shop.name}</p>
      <h1 className="text-5xl mb-6">Join the queue</h1>

      <ol className="flex gap-4 text-xs mb-8 overflow-x-auto">
        {steps.map((s, i) => (
          <li
            key={s}
            className={`pb-1 border-b-2 whitespace-nowrap ${i === step ? "border-brass" : "border-transparent text-coffee/50"}`}
          >
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="space-y-5">
          <label className="block max-w-xs">
            <span className="label">Booking date</span>
            <input
              className="input mt-2"
              type="date"
              min={bookingToday()}
              value={bookingDate}
              onChange={(e) => {
                setBookingDate(e.target.value);
                if (e.target.value !== bookingToday()) setScheduledTime("");
                setDateRestrictions([]);
                setAvailabilityLoading(true);
                setAvailabilityError("");
                setQuote(null);
                setPaymentError("");
              }}
            />
          </label>
          {publicOffers.length > 0 && <section className="border border-khaki p-4 space-y-2"><p className="label">Available offers</p>{publicOffers.map((offer) => { const rewardIds = offer.rewardServiceIds?.length ? offer.rewardServiceIds : offer.rewardServiceId ? [offer.rewardServiceId] : []; const dayNames = (offer.happyHourDays || []).map((day) => WEEKDAY_NAMES[day]).filter(Boolean); return <div key={offer.id} className={`text-sm ${offer.newCustomerOnly && offer.customerEligible === false ? "opacity-60" : ""}`} aria-disabled={offer.newCustomerOnly && offer.customerEligible === false}><b>{offer.title}</b>{offer.offerType === "bogo" ? <p>Buy {offer.serviceIds.map((serviceId) => `${offer.requiredQuantities?.[serviceId] || 1} × ${shop.servicesList.find((service) => String(service.id) === String(serviceId))?.name || "service"}`).join(" + ")} · {offer.rewardSelectionEnabled ? `Choose up to ${offer.maxRewardCount || 1} free reward(s): ${rewardIds.map((rewardId) => shop.servicesList.find((service) => String(service.id) === String(rewardId))?.name || "reward service").join(", ")}` : `Get ${offer.freeQuantity} × ${shop.servicesList.find((service) => String(service.id) === String(offer.rewardServiceId))?.name || "reward service"} free`}</p> : <p>{offer.discountType === "percentage" ? `${offer.discountValue}% off` : `₹${Number(offer.discountValue).toFixed(2)} off`} {offer.promoCode ? `· Code ${offer.promoCode}` : "· Automatically applied when eligible"}</p>}{offer.happyHourEnabled && <p className="text-brass">Happy Hour · {offer.offerType === "bogo" ? "BOGO reward" : offer.discountType === "percentage" ? `${offer.discountValue}% off` : `₹${Number(offer.discountValue).toFixed(2)} off`} available {formatOfferTime(offer.happyHourStartTime)}–{formatOfferTime(offer.happyHourEndTime)}{dayNames.length ? ` on ${dayNames.join(", ")}` : " every day"} (shop local time; end time excluded).</p>}{offer.newCustomerOnly && <p className={offer.customerEligible ? "text-olive" : "text-soft"}>{offer.customerEligible ? "New-customer offer · You’re eligible before your first completed booking." : offer.eligibilityMessage || "New-customer offer is not currently available."}</p>}</div>; })}</section>}
          {availabilityLoading && (
            <p className="text-sm text-coffee/70">
              Checking service availability...
            </p>
          )}
          <SmartTimeSlotPicker
            shop={shop}
            bookingDate={bookingDate}
            bookingToday={bookingToday}
            scheduledTime={scheduledTime}
            shopQueues={shop.queues || {}}
            setScheduledTime={(t) => { setScheduledTime(t); setQuote(null); setPaymentError(""); }}
            setBookingDate={(d) => {
              setBookingDate(d);
              setDateRestrictions([]);
              setAvailabilityLoading(true);
              setAvailabilityError("");
              setQuote(null);
              setPaymentError("");
            }}
          />
          {availabilityError && (
            <p className="text-sm text-rose" role="alert">
              {availabilityError}
            </p>
          )}
          <SearchableServiceSelector services={shop.servicesList} selectedIds={sids} label="Paid services" placeholder="Search or select a service..." noMatchesText="No matching services found." showSelected={false} onSelect={(service) => toggleService(service.id)} disabled={(service) => unavailableByService.has(service.id)} suggestionContent={(service) => <>{service.name}{unavailableByService.has(service.id) && <span className="block text-rose">Unavailable on {formatDateDisplay(bookingDate, true)}{unavailableByService.get(service.id)?.reason ? `: ${unavailableByService.get(service.id).reason}` : ""}</span>}</>} />

          {selected.length > 0 && (
            <div className="border border-khaki p-4">
              <p className="label">Selected services</p>
              <div className="space-y-1 mt-2">
                {selected.map((s) => (
                  <div key={s.id} className="flex justify-between items-center gap-3 text-sm border-b last:border-0 border-khaki py-2">
                    <span><b>{s.name}</b><span className="block text-xs text-soft">₹{s.price} · {s.duration} min</span></span>
                    <button type="button" className="btn-ghost !px-2 !py-1" aria-label={`Remove ${s.name}`} onClick={() => toggleService(s.id)}><X size={15} /></button>
                  </div>
                ))}
              </div>
              <div className="space-y-1 mt-2">{selected.map((s) => <div key={`qty-${s.id}`} className="flex justify-between items-center text-xs"><span>{s.name}: {serviceQuantities[s.id] || 1} unit(s)</span><span className="flex gap-1"><button type="button" className="btn-ghost !px-2 !py-1" onClick={() => { setServiceQuantities((q) => ({ ...q, [s.id]: Math.max(1, (q[s.id] || 1) - 1) })); setQuote(null); }}>−</button><button type="button" className="btn-ghost !px-2 !py-1" disabled={(serviceQuantities[s.id] || 1) >= 20} onClick={() => { setServiceQuantities((q) => ({ ...q, [s.id]: (q[s.id] || 1) + 1 })); setQuote(null); }}>+</button></span></div>)}</div>
              <div className="border-t border-khaki mt-3 pt-3 flex justify-between">
                <b>Total</b>
                <b>
                  ₹{total} · {duration} min
                </b>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          {shopBarbers.length === 0 ? (
            <p>{applicableBogoOffers.length
              ? "No available barber can provide all selected services and the free reward service for this BOGO offer. Choose different services or ask the shop about availability."
              : "No barber offers all selected services right now."}</p>
          ) : (
            shopBarbers.map((b) => {
              const off = b.status !== "Available";
              const q = activeOf(shop.queues?.[b.id] || []);
              const bwait = etaFor(
                shop.servicesList,
                shop.queues?.[b.id] || [],
                q.length,
              );
              return (
                <button
                  key={b.id}
                  disabled={off}
                  onClick={() => setBid(b.id)}
                  className={`w-full flex gap-4 items-center border p-4 text-left ${bid === b.id ? "border-coffee bg-olive/15" : "border-khaki"} disabled:opacity-50`}
                >
                  <img
                    src={b.photo || "/img/barber-placeholder.svg"}
                    alt=""
                    className="w-14 h-14 rounded-full object-cover bg-khaki"
                  />
                  <div className="flex-1 text-sm">
                    <b className="text-base">{b.name}</b>{" "}
                    {b.rating ? <Rating v={b.rating} /> : null}
                    <br />
                    {off ? b.status : `${q.length} ahead · ~${bwait} min`}
                  </div>
                  <Badge tone={off ? "warn" : "ok"}>{b.status}</Badge>
                </button>
              );
            })
          )}
          {bogoRewardSelector}
        </div>
      )}

      {step === 2 && barber && (
        <div className="border border-khaki p-6 space-y-2">
          {activeSelfBooking && forWhom === "self" && (
            <div className="border border-brass/40 bg-brass/10 p-3 text-sm mb-3">
              You already have an active queue booking at{" "}
              <b>{activeSelfBooking.shop.name}</b> (#
              {activeSelfBooking.entry.token}).
            </div>
          )}
          <Row
            k="Services"
            v={selected.map((s) => `${s.name} · ${s.duration} min`).join(", ")}
          />
          {activeBogoOffer?.rewardSelectionEnabled && selectedRewardCount > 0 && <Row k="Free rewards" v={Object.entries(selectedRewards).map(([serviceId, quantity]) => `${shop.servicesList.find((service) => String(service.id) === serviceId)?.name || "Service"} × ${quantity} · FREE`).join(", ")} />}
          <Row k="Barber" v={barber.name} />
          <Row k="Booking date" v={formatDateDisplay(bookingDate, true)} />
          <Row
            k="Customers ahead"
            v={activeOf(shop.queues?.[barber.id] || []).length}
          />
          <Row k="Estimated wait" v={`${wait} min`} />
          <Row k="Total" v={`₹${total}`} />

          <div className="border-t border-khaki mt-4 pt-4">
            <p className="label mb-2">Booking for</p>
            <div className="flex gap-2">
              <button
                type="button"
                className={`btn-ghost ${forWhom === "self" ? "bg-khaki !text-[#1C1713]" : ""}`}
                onClick={() => setForWhom("self")}
              >
                Myself
              </button>
              <button
                type="button"
                className={`btn-ghost ${forWhom === "friend" ? "!bg-olive !text-[#1C1713]" : ""}`}
                onClick={() => setForWhom("friend")}
              >
                Someone else
              </button>
            </div>
            {forWhom === "friend" && (
              <div className="grid md:grid-cols-2 gap-3 mt-3">
                <div>
                  <input
                    className={`input ${
                      friend.name && !isValidName(friend.name)
                        ? "!border-rose"
                        : ""
                    }`}
                    placeholder="Person's name *"
                    value={friend.name}
                    onChange={(e) =>
                      setFriend({ ...friend, name: e.target.value })
                    }
                  />
                  {friend.name && !isValidName(friend.name) && (
                    <p className="text-xs text-rose mt-1">
                      Enter a valid name (2–60 alphabetic characters).
                    </p>
                  )}
                </div>
                <div>
                  <input
                    className={`input ${
                      friend.mobile && !isValidPhone(friend.mobile)
                        ? "!border-rose"
                        : ""
                    }`}
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="Mobile number (10 digits) *"
                    value={friend.mobile}
                    onChange={(e) =>
                      setFriend({
                        ...friend,
                        mobile: e.target.value.replace(/\D/g, ""),
                      })
                    }
                  />
                  {friend.mobile && !isValidPhone(friend.mobile) && (
                    <p className="text-xs text-rose mt-1">
                      Enter a valid 10-digit Indian mobile number.
                    </p>
                  )}
                </div>
                <div className="md:col-span-2">
                  <input
                    className={`input ${
                      friend.email && !isValidEmail(friend.email)
                        ? "!border-rose"
                        : ""
                    }`}
                    type="email"
                    placeholder="Person's email (optional)"
                    value={friend.email}
                    onChange={(e) =>
                      setFriend({ ...friend, email: e.target.value })
                    }
                  />
                  {friend.email && !isValidEmail(friend.email) && (
                    <p className="text-xs text-rose mt-1">
                      Enter a valid email address.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <div className="border-t border-khaki">
            {Object.entries(shop.policy || {}).map(([k, v]) => (
              <div key={k} className="py-3 border-b border-khaki">
                <b>{k} policy</b>
                <p className="text-sm text-coffee/75">{v}</p>
              </div>
            ))}
          </div>
          <label className="flex gap-2 mt-4 text-sm">
            <input
              type="checkbox"
              className="accent-[#B39A6A]"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
            />
            I have read and agree to this shop's policies.
          </label>
        </div>
      )}

      {step === 4 && (
        <div className="border border-khaki bg-card p-6 md:p-8">
          <div className="border border-khaki p-4 mb-5 space-y-2">
            <label className="block"><span className="label">Promo code (optional)</span><input className="input mt-1 uppercase" maxLength={32} value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} placeholder="Enter offer code" /></label>
            <div className="flex flex-wrap items-center gap-3"><button type="button" className="btn-ghost" disabled={quoteBusy} onClick={() => { const code = promoCode.trim().toUpperCase(); setAppliedPromoCode(code); setSelectedBogoOfferId(""); setRewardServiceQuantities({}); setQuote(null); if (code === appliedPromoCode) loadQuote(code); }}>Apply code</button><p className="text-xs text-soft">Eligible offers without a promo code are checked automatically.</p></div>
            {activeBogoOffer?.rewardSelectionEnabled && appliedPromoCode && selectedRewardCount === 0 && <p className="text-sm text-amber-800" role="status">Go back to the Barber step to choose free rewards for this BOGO code, then continue to payment.</p>}
            {quote?.scheme && <p className="text-sm text-olive" role="status">{quote.scheme.offerType === "bogo" ? `${quote.scheme.title}: Buy ${quote.scheme.requiredServices.map((item) => `${item.quantity} × ${item.name}`).join(" + ")} · Free rewards: ${(quote.scheme.rewardServices || []).map((item) => `${item.quantity} × ${item.name}`).join(", ")}.` : `${quote.scheme.title} is confirmed for this booking.`}</p>}
            {(quote?.offerMessages || []).map((message, index) => <p key={`offer-message-${index}`} className="text-sm text-amber-800" role="status">{message}</p>)}
          </div>
          {quoteBusy ? (
            <div className="py-12 text-center text-soft">
              <span className="pay-spinner pay-spinner-lg inline-block" />
              <p className="mt-4">Checking payment amount...</p>
            </div>
          ) : !shop.upiQrUrl ? (
            <div className="py-12 text-center">
              <p className="font-serif text-3xl">
                This shop can't take bookings yet.
              </p>
              <p className="text-sm text-soft mt-2">
                The shop owner must upload the original UPI QR image.
              </p>
            </div>
          ) : quote ? (
            <div className="space-y-6">
              <div className="border border-khaki p-4 space-y-1 text-sm" aria-label="Read-only booking summary">
                <p className="label">Booking summary</p>
                {selected.map((service) => {
                  const quantity = Number(serviceQuantities[service.id] || 1);
                  return <div key={service.id} className="flex justify-between gap-3"><span>{service.name} × {quantity}</span><span>₹{(Number(service.price) * quantity).toFixed(2)}</span></div>;
                })}
                {Object.entries(quote.freeServiceQuantities || {}).map(([serviceId, quantity]) => {
                  const service = shop.servicesList.find((item) => String(item.id) === serviceId);
                  return service && <div key={`free-${serviceId}`} className="flex justify-between gap-3 text-olive"><span>{service.name} × {quantity} · FREE</span><span>₹0.00</span></div>;
                })}
              </div>
              {Number(quote.discountAmount) > 0 && <div className="border border-olive/30 bg-olive/10 p-4 space-y-1 text-sm"><div className="flex justify-between"><span>Original price</span><span>₹{Number(quote.originalAmount).toFixed(2)}</span></div><div className="flex justify-between"><span>{quote.scheme?.title || "Offer discount"}</span><span>−₹{Number(quote.discountAmount).toFixed(2)}</span></div>{Number(quote.amount) > Number(quote.originalAmount) - Number(quote.discountAmount) && <div className="flex justify-between"><span>UPI payment reference adjustment</span><span>+₹{(Number(quote.amount) - Number(quote.originalAmount) + Number(quote.discountAmount)).toFixed(2)}</span></div>}<div className="flex justify-between border-t border-olive/20 pt-2 font-medium"><span>Final payable amount</span><span>₹{Number(quote.amount).toFixed(2)}</span></div></div>}
              <div>
                <p className="label">UPI payment</p>
                <h2 className="font-serif text-5xl mt-2">
                  Send ₹{Number(quote.amount).toFixed(2)}
                </h2>
                <p className="text-sm text-soft mt-2">
                  Scan this QR and pay the exact amount.
                </p>
              </div>

              <div className="flex justify-center border border-khaki bg-white p-4">
                <img
                  src={quote.qrUrl}
                  alt={`${shop.name} UPI QR`}
                  className="w-64 h-64 object-contain"
                />
              </div>

              <label className="block">
                <span className="label">
                  Who is paying? (your name or a friend's)
                </span>
                <input
                  className="input mt-2"
                  placeholder={customer?.name || "Name"}
                  value={payerName}
                  onChange={(e) => setPayerName(e.target.value.slice(0, 120))}
                />
              </label>

              <p className="text-sm text-soft">
                Press the button only after you have completed the payment.
              </p>

              <button
                type="button"
                className="btn w-full !py-4 text-lg"
                disabled={
                  submitBusy || promoCode.trim().toUpperCase() !== appliedPromoCode || (forWhom === "self" && !!activeSelfBooking)
                }
                onClick={submitPayment}
              >
                {submitBusy ? (
                  <>
                    <span className="pay-spinner" />
                    Submitting...
                  </>
                ) : (
                  promoCode.trim().toUpperCase() !== appliedPromoCode ? "Apply the code to continue" : "I have paid"
                )}
              </button>

              {paymentError && (
                <p className="text-rose text-sm" role="alert">
                  {paymentError}
                </p>
              )}
            </div>
          ) : (
            <div className="py-10 text-center">
              <p className="text-soft">
                {paymentError || "Payment could not be prepared."}
              </p>
              <button type="button" className="btn mt-4" onClick={loadQuote}>
                Try again
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between mt-8">
        {step > 0 ? (
          <button className="btn-ghost" onClick={back}>
            Back
          </button>
        ) : (
          <span />
        )}
        {step < 4 && (
          <button
            className="btn"
            disabled={
              !canNext ||
              (step === 2 && forWhom === "friend" && !friend.name.trim())
            }
            onClick={next}
          >
            Continue
          </button>
        )}
      </div>
    </div>
  );
}

const Row = ({ k, v }) => (
  <div className="flex justify-between gap-6">
    <span className="text-coffee/60">{k}</span>
    <b className="text-right">{v}</b>
  </div>
);

// ---------------------------------------------------------------------------
// SmartTimeSlotPicker
// Lets the customer pick an appointment time, and if the chosen time is outside
// the shop's shift hours it shows Before / After / Tomorrow suggestions.
// ---------------------------------------------------------------------------
const JS_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmt12(time) {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  const period = h < 12 ? "AM" : "PM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${period}`;
}

function SmartTimeSlotPicker({ shop, bookingDate, bookingToday, scheduledTime, shopQueues, setScheduledTime, setBookingDate }) {
  const isToday = bookingDate === bookingToday();
  const minTime = isToday
    ? new Date(Date.now() + 60 * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : "00:00";

  // Total active queue across ALL barbers at this shop
  const totalActiveQueue = useMemo(() => {
    if (!shopQueues) return 0;
    const ACTIVE = ["Waiting", "Your Turn", "In Service"];
    return Object.values(shopQueues).reduce(
      (sum, entries) => sum + (Array.isArray(entries) ? entries.filter((e) => ACTIVE.includes(e.status)).length : 0),
      0,
    );
  }, [shopQueues]);
  const queueIsEmpty = totalActiveQueue === 0;

  // ── Queue-clear time suggestion ──────────────────────────────────────────
  // Find the EARLIEST time any barber becomes free (min ETA across all barbers).
  // If that estimated free-slot falls within an open shift on the booking date,
  // offer it as a "Today ~X PM · Queue clears" one-click button.
  const queueClearSuggestion = useMemo(() => {
    if (!shop || !shopQueues || !bookingDate) return null;
    const services = shop.servicesList || [];

    // Compute per-barber total ETA in minutes
    const etaList = Object.values(shopQueues).map((entries) => {
      const active = activeOf(entries || []);
      if (!active.length) return 0;
      return etaFor(services, entries, active.length);
    }).filter((eta) => eta > 0);

    // No one in queue – nothing to compute
    if (!etaList.length) return null;

    // Earliest a barber becomes free
    const minEtaMinutes = Math.min(...etaList);

    // Compute clock time: now + minEta
    const nowIST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const freeMinutesTotal = nowIST.getHours() * 60 + nowIST.getMinutes() + minEtaMinutes;
    const freeH = Math.floor(freeMinutesTotal / 60) % 24;
    const freeM = freeMinutesTotal % 60;
    const freeTime = `${String(freeH).padStart(2, "0")}:${String(freeM).padStart(2, "0")}`;

    // Only relevant when booking date is today
    const today = bookingToday();
    if (bookingDate !== today) return null;

    // Check that freeTime falls within one of today's shifts on the booking date
    const sched = scheduleOf(shop);
    const [y, mo, d] = bookingDate.split("-").map(Number);
    const jsDate = new Date(y, mo - 1, d);
    const wd = JS_DAYS[jsDate.getDay()];
    const dayObj = sched[wd];
    if (!dayObj || dayObj.closed) return null;
    const shifts = normalizeDayShifts(dayObj).sort((a, b) => a.open.localeCompare(b.open));
    const withinShift = shifts.some((s) => freeTime >= s.open && freeTime < s.close);
    if (!withinShift) return null;

    return {
      time: freeTime,
      label: fmt12(freeTime),
      etaMinutes: minEtaMinutes,
    };
  }, [shop, shopQueues, bookingDate]);

  const suggestions = useMemo(
    () => (scheduledTime ? getTimeSlotSuggestions(shop, bookingDate, scheduledTime) : null),
    [shop, bookingDate, scheduledTime],
  );

  // Build today's shift display for context
  const todayShifts = useMemo(() => {
    if (!shop) return [];
    const sched = scheduleOf(shop);
    const [y, mo, d] = bookingDate.split("-").map(Number);
    const jsDate = new Date(y, mo - 1, d);
    const wd = JS_DAYS[jsDate.getDay()];
    const dayObj = sched[wd];
    if (!dayObj || dayObj.closed) return [];
    return normalizeDayShifts(dayObj).sort((a, b) => a.open.localeCompare(b.open));
  }, [shop, bookingDate]);

  const isOutside = suggestions && !suggestions.isInsideShift && !suggestions.dayIsClosed;
  const isDayClosed = suggestions?.dayIsClosed;

  return (
    <div className="space-y-3 max-w-sm">
      <label className="block">
        <span className="label">Appointment time (optional)</span>
        <div className="flex gap-2 items-center mt-2">
          <input
            className={`input flex-1 ${
              isOutside || isDayClosed ? "!border-rose" : scheduledTime ? "!border-olive" : ""
            }`}
            type="time"
            min={minTime}
            value={scheduledTime}
            onChange={(e) => setScheduledTime(e.target.value)}
          />
          {scheduledTime && (
            <button
              type="button"
              className="btn-ghost !py-2 !px-3 text-xs"
              onClick={() => setScheduledTime("")}
              title="Clear time"
            >
              ✕
            </button>
          )}
        </div>
        {!scheduledTime && (
          <span className="text-xs text-coffee/60">Leave blank to join the normal queue.</span>
        )}
        {scheduledTime && todayShifts.length > 0 && (
          <span className="text-xs text-coffee/60">
            Shop hours: {todayShifts.map((s) => `${fmt12(s.open)} – ${fmt12(s.close)}`).join(", ")}
          </span>
        )}
      </label>

      {/* ── Out-of-hours warning & suggestions ── */}
      {scheduledTime && (isOutside || isDayClosed) && (
        <div className="border border-amber-400/60 bg-amber-50/80 rounded-lg p-3 space-y-2.5">
          <p className="text-sm font-semibold text-amber-800 flex items-center gap-1.5">
            <span>⚠️</span>
            {isDayClosed
              ? `The shop is closed on this day.`
              : `${fmt12(scheduledTime)} is outside the shop's open hours.`}
          </p>

          {todayShifts.length > 0 && (
            <p className="text-xs text-amber-700">
              Open shifts: {todayShifts.map((s) => `${fmt12(s.open)} – ${fmt12(s.close)}`).join(" · ")}
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {/* Before – end of previous shift */}
            {suggestions?.closestBefore && (
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-amber-400 bg-white text-amber-800 font-medium hover:bg-amber-100 transition-colors shadow-sm"
                onClick={() => setScheduledTime(suggestions.closestBefore.time)}
              >
                <span>◀</span>
                Before: {suggestions.closestBefore.label}
              </button>
            )}

            {/* After – open of next shift today */}
            {suggestions?.closestAfter && !isDayClosed && (
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-amber-400 bg-white text-amber-800 font-medium hover:bg-amber-100 transition-colors shadow-sm"
                onClick={() => setScheduledTime(suggestions.closestAfter.time)}
              >
                <span>▶</span>
                After: {suggestions.closestAfter.label}
              </button>
            )}

            {/* Queue-clear time – come today when first barber is free */}
            {queueClearSuggestion && (
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-olive/50 bg-olive/10 text-olive font-medium hover:bg-olive/20 transition-colors shadow-sm"
                onClick={() => setScheduledTime(queueClearSuggestion.time)}
              >
                <span>🕐</span>
                <span>Today ~{queueClearSuggestion.label} · Queue clears</span>
                <span className="ml-1 px-1.5 py-0.5 rounded bg-olive/20 text-olive text-[10px] font-semibold">~{queueClearSuggestion.etaMinutes} min</span>
              </button>
            )}

            {/* Previous open day – badge shows queue state + estimated free time */}
            {suggestions?.prevDay && (
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-coffee/40 bg-white text-coffee font-medium hover:bg-khaki/40 transition-colors shadow-sm"
                onClick={() => {
                  setBookingDate(suggestions.prevDay.date);
                  setScheduledTime(suggestions.prevDay.time);
                }}
              >
                <span>⬅️</span>
                <span>Earlier ({suggestions.prevDay.dayName}): {suggestions.prevDay.label}</span>
                {queueIsEmpty ? (
                  <span className="ml-1 px-1.5 py-0.5 rounded bg-olive/20 text-olive text-[10px] font-semibold">Queue empty</span>
                ) : queueClearSuggestion ? (
                  <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-semibold">~{queueClearSuggestion.label} free today</span>
                ) : (
                  <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-semibold">{totalActiveQueue} in queue</span>
                )}
              </button>
            )}

            {/* Tomorrow – fresh day, queue always resets; show today's clear time if busy */}
            {suggestions?.tomorrow && (
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-coffee/40 bg-white text-coffee font-medium hover:bg-khaki/40 transition-colors shadow-sm"
                onClick={() => {
                  setBookingDate(suggestions.tomorrow.date);
                  setScheduledTime(suggestions.tomorrow.time);
                }}
              >
                <span>📅</span>
                <span>Tomorrow ({suggestions.tomorrow.dayName}): {suggestions.tomorrow.label}</span>
                {/* Tomorrow always starts fresh — but hint when queue clears today */}
                {!queueIsEmpty && queueClearSuggestion ? (
                  <>
                    <span className="ml-1 px-1.5 py-0.5 rounded bg-olive/20 text-olive text-[10px] font-semibold">Fresh start</span>
                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-semibold">or today ~{queueClearSuggestion.label}</span>
                  </>
                ) : !queueIsEmpty ? (
                  <>
                    <span className="ml-1 px-1.5 py-0.5 rounded bg-olive/20 text-olive text-[10px] font-semibold">Fresh start</span>
                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-semibold">{totalActiveQueue} in queue now</span>
                  </>
                ) : (
                  <span className="ml-1 px-1.5 py-0.5 rounded bg-olive/20 text-olive text-[10px] font-semibold">Fresh start</span>
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Inside shift confirmation ── */}
      {scheduledTime && suggestions?.isInsideShift && (
        <div className="flex items-center gap-2 text-xs text-olive font-medium">
          <span>✅</span>
          <span>{fmt12(scheduledTime)} is within shop hours.</span>
        </div>
      )}
    </div>
  );
}
