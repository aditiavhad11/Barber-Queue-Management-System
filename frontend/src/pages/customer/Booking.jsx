import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useOwner } from "../../hooks/useOwnerStore";
import { api } from "../../services/api";
import { Badge, Rating } from "../../components/common/ui";
import { activeOf, etaFor } from "../../utils/ownerEta";
import {
  isShopOpenNow,
  getTemporaryClosure,
  formatDateDisplay,
} from "../../utils/closedDays";
import { AlertTriangle } from "lucide-react";
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
  const [bid, setBid] = useState(null);
  const [agree, setAgree] = useState(false);
  const [forWhom, setForWhom] = useState("self");
  const [friend, setFriend] = useState({ name: "", mobile: "", email: "" });

  const [quote, setQuote] = useState(null);
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
    const requiredIds = (offer.serviceIds || []).map(String);
    return offer.offerType === "bogo" && !offer.promoCode && requiredIds.length > 0 &&
      total >= Number(offer.minimumAmount || 0) &&
      requiredIds.every((sid) => sids.includes(sid) && Number(serviceQuantities[sid] || 1) >= Number(offer.requiredQuantities?.[sid] || 1));
  });
  const serviceEligibleBarbers = (shop?.barbersList || []).filter(
    (b) => !sids.length || sids.every((sid) => (b.services || []).map(String).includes(sid)),
  );
  const shopBarbers = serviceEligibleBarbers.filter((barber) =>
    !applicableBogoOffers.length || applicableBogoOffers.some((offer) =>
      (offer.allBarbers || (offer.barberIds || []).map(String).includes(String(barber.id))) &&
      (barber.services || []).map(String).includes(String(offer.rewardServiceId)),
    ),
  );
  const solo = shopBarbers.length === 1 && applicableBogoOffers.length === 0;
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
    if (!shop || !barber || !sids.length || blockedSelection || quoteBusy)
      return;
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
        promoCode: code,
        beneficiary: beneficiaryBody(),
      });
      setQuote(data);
    } catch (error) {
      const data = error.response?.data;
      if (error.response?.status === 409 && data?.bookingId) {
        nav(`/app/queue/payment/${data.bookingId}`);
        return;
      }
      setQuote(null);
      setPaymentError(
        data?.message || "This shop cannot prepare the payment right now.",
      );
    } finally {
      setQuoteBusy(false);
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
    setSids((prev) =>
      prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid],
    );
    setBid(null);
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
          {publicOffers.length > 0 && <section className="border border-khaki p-4 space-y-2"><p className="label">Available offers</p>{publicOffers.map((offer) => <div key={offer.id} className="text-sm"><b>{offer.title}</b>{offer.offerType === "bogo" ? <p>Buy {offer.serviceIds.map((serviceId) => `${offer.requiredQuantities?.[serviceId] || 1} × ${shop.servicesList.find((service) => String(service.id) === String(serviceId))?.name || "service"}`).join(" + ")} · Get {offer.freeQuantity} × {shop.servicesList.find((service) => String(service.id) === String(offer.rewardServiceId))?.name || "reward service"} free.</p> : <p>{offer.discountType === "percentage" ? `${offer.discountValue}% off` : `₹${Number(offer.discountValue).toFixed(2)} off`} {offer.promoCode ? `· Code ${offer.promoCode}` : "· Automatically applied when eligible"}</p>}</div>)}</section>}
          {availabilityLoading && (
            <p className="text-sm text-coffee/70">
              Checking service availability...
            </p>
          )}
          {bookingDate === bookingToday() && (
            <label className="block max-w-xs">
              <span className="label">Same-day appointment time (optional)</span>
              <input
                className="input mt-2"
                type="time"
                min={new Date(Date.now() + 60 * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                value={scheduledTime}
                onChange={(e) => {
                  setScheduledTime(e.target.value);
                  setQuote(null);
                  setPaymentError("");
                }}
              />
              <span className="text-xs text-coffee/60">Leave blank to join the normal queue.</span>
            </label>
          )}
          {availabilityError && (
            <p className="text-sm text-rose" role="alert">
              {availabilityError}
            </p>
          )}
          <div className="border-t border-khaki">
            {shop.servicesList
              .filter((s) => s.enabled !== false)
              .map((s) => {
                const restriction = unavailableByService.get(s.id);
                const isSelected = sids.includes(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => toggleService(s.id)}
                    disabled={!!restriction && !isSelected}
                    className={`w-full flex justify-between items-center py-4 px-3 border-b border-khaki text-left disabled:opacity-70 ${isSelected ? "bg-olive/15" : ""}`}
                  >
                    <span className="flex gap-3 items-start">
                      <span
                        className={`mt-1 w-4 h-4 border grid place-items-center text-xs ${sids.includes(s.id) ? "bg-olive text-[#1C1713] border-coffee" : "border-coffee/40"}`}
                      >
                        {sids.includes(s.id) ? "✓" : ""}
                      </span>
                      <span>
                        <b>{s.name}</b>
                        <br />
                        <span className="text-sm text-coffee/70">
                          {s.duration} min
                        </span>
                        {restriction && (
                          <span className="block text-sm text-rose mt-1">
                            {s.name} is unavailable on{" "}
                            {formatDateDisplay(bookingDate, true)}.
                            {restriction.reason
                              ? ` Reason: ${restriction.reason}`
                              : ""}
                          </span>
                        )}
                      </span>
                    </span>
                    <span>₹{s.price}</span>
                  </button>
                );
              })}
          </div>

          {selected.length > 0 && (
            <div className="border border-khaki p-4">
              <p className="label">Selected services</p>
              <div className="space-y-1 mt-2">
                {selected.map((s) => (
                  <div key={s.id} className="flex justify-between text-sm">
                    <span>{s.name}</span>
                    <span>
                      ₹{s.price} · {s.duration} min
                    </span>
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
            <div className="flex flex-wrap items-center gap-3"><button type="button" className="btn-ghost" disabled={quoteBusy} onClick={() => { const code = promoCode.trim().toUpperCase(); setAppliedPromoCode(code); setQuote(null); if (code === appliedPromoCode) loadQuote(code); }}>Apply code</button><p className="text-xs text-soft">Eligible offers without a promo code are checked automatically.</p></div>
            {quote?.scheme && <p className="text-sm text-olive" role="status">{quote.scheme.offerType === "bogo" ? `${quote.scheme.title}: Buy ${quote.scheme.requiredServices.map((item) => `${item.quantity} × ${item.name}`).join(" + ")} · Get ${quote.scheme.freeQuantity} × ${quote.scheme.rewardServiceName} free.` : `${quote.scheme.title} is confirmed for this booking.`}</p>}
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
              {quote.scheme?.offerType === "bogo" && <div className="border border-khaki p-4 space-y-1 text-sm"><p className="label">BOGO booking items</p>{selected.map((service) => <div key={service.id} className="flex justify-between"><span>{service.name} × {serviceQuantities[service.id] || 1}</span><span>₹{(Number(service.price) * Number(serviceQuantities[service.id] || 1)).toFixed(2)}</span></div>)}{Object.entries(quote.freeServiceQuantities || {}).map(([serviceId, quantity]) => { const service = shop.servicesList.find((item) => String(item.id) === serviceId); return service && <div key={`free-${serviceId}`} className="flex justify-between text-olive"><span>{service.name} × {quantity} · FREE</span><span>₹0.00</span></div>; })}</div>}
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
