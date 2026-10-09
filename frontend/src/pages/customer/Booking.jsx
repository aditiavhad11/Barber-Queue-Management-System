import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useOwner } from "../../hooks/useOwnerStore";
import { api } from "../../services/api";
import { Badge, Rating } from "../../components/common/ui";
import { activeOf, etaFor } from "../../utils/ownerEta";

const steps = ["Service", "Barber", "Review", "Policies", "Payment"];

const EMAIL_REGEX = /^[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

export default function Booking() {
  const { id } = useParams();
  const nav = useNavigate();
  const { shops, customerQueues, customer } = useOwner();
  const shop = shops.find((s) => s.id === id && s.status === "approved" && s.active);

  const [step, setStep] = useState(0);
  const [sids, setSids] = useState([]);
  const [bid, setBid] = useState(null);
  const [agree, setAgree] = useState(false);
  const [forWhom, setForWhom] = useState("self");
  const [friend, setFriend] = useState({ name: "", mobile: "", email: "" });

  const [quote, setQuote] = useState(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [payerName, setPayerName] = useState("");

  const activeSelfBooking = customerQueues?.find(
    (q) => q.entry.customerId === customer?.id && ["Waiting", "Your Turn", "In Service"].includes(q.entry.status),
  );

  const selected = (shop?.servicesList || []).filter((s) => sids.includes(s.id));
  const total = selected.reduce((n, s) => n + Number(s.price || 0), 0);
  const duration = selected.reduce((n, s) => n + Number(s.duration || 0), 0);
  const shopBarbers = (shop?.barbersList || []).filter(
    (b) => !sids.length || sids.every((sid) => b.services?.includes(sid)),
  );
  const solo = shopBarbers.length === 1;
  const barber = shopBarbers.find((b) => b.id === (solo ? shopBarbers[0]?.id : bid));
  const wait = barber
    ? etaFor(shop?.servicesList || [], shop?.queues?.[barber.id] || [], activeOf(shop?.queues?.[barber.id] || []).length)
    : 0;

  const beneficiaryBody = () => (
    forWhom === "self"
      ? { isSelf: true }
      : { isSelf: false, name: friend.name, mobile: friend.mobile, email: friend.email }
  );

  const loadQuote = async () => {
    if (!shop || !barber || !sids.length || quoteBusy) return;
    setQuoteBusy(true);
    setPaymentError("");
    try {
      const { data } = await api.post("/bookings/payment-quote", {
        shopId: id,
        serviceIds: sids,
        barberId: barber.id,
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
      setPaymentError(data?.message || "This shop cannot prepare the payment right now.");
    } finally {
      setQuoteBusy(false);
    }
  };

  useEffect(() => {
    if (step === 4) {
      setPayerName(customer?.name || "");
      loadQuote();
    }
  }, [step, id, barber?.id, sids.join(","), forWhom, friend.name, friend.mobile, friend.email]);

  const toggleService = (sid) => {
    setQuote(null);
    setPaymentError("");
    setSids((prev) => (prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]));
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
        barberId: barber.id,
        beneficiary: beneficiaryBody(),
        payerName: payerName.trim(),
        quoteToken: quote.quoteToken,
      });

      nav(`/app/queue/payment/${data.booking.id}`);
    } catch (error) {
      const data = error.response?.data;
      if ((error.response?.status === 409 || error.response?.status === 429) && data?.bookingId) {
        nav(`/app/queue/payment/${data.bookingId}`);
        return;
      }
      setPaymentError(data?.message || "Payment submission could not be created. Please try again.");
    } finally {
      setSubmitBusy(false);
    }
  };

  const canNext = [
    sids.length > 0,
    !!barber && barber.status === "Available",
    true,
    agree,
  ][step];

  if (!shop) return <div className="fade">Shop is no longer available.</div>;

  return (
    <div className="fade max-w-3xl">
      <p className="label">{shop.name}</p>
      <h1 className="text-5xl mb-6">Join the queue</h1>

      <ol className="flex gap-4 text-xs mb-8 overflow-x-auto">
        {steps.map((s, i) => (
          <li key={s} className={`pb-1 border-b-2 whitespace-nowrap ${i === step ? "border-brass" : "border-transparent text-coffee/50"}`}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="space-y-5">
          <div className="border-t border-khaki">
            {shop.servicesList.filter((s) => s.enabled !== false).map((s) => (
              <button
                key={s.id}
                onClick={() => toggleService(s.id)}
                className={`w-full flex justify-between items-center py-4 px-3 border-b border-khaki text-left ${sids.includes(s.id) ? "bg-olive/15" : ""}`}
              >
                <span className="flex gap-3 items-start">
                  <span className={`mt-1 w-4 h-4 border grid place-items-center text-xs ${sids.includes(s.id) ? "bg-olive text-[#1C1713] border-coffee" : "border-coffee/40"}`}>
                    {sids.includes(s.id) ? "✓" : ""}
                  </span>
                  <span>
                    <b>{s.name}</b><br />
                    <span className="text-sm text-coffee/70">{s.duration} min</span>
                  </span>
                </span>
                <span>₹{s.price}</span>
              </button>
            ))}
          </div>

          {selected.length > 0 && (
            <div className="border border-khaki p-4">
              <p className="label">Selected services</p>
              <div className="space-y-1 mt-2">
                {selected.map((s) => (
                  <div key={s.id} className="flex justify-between text-sm">
                    <span>{s.name}</span><span>₹{s.price} · {s.duration} min</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-khaki mt-3 pt-3 flex justify-between">
                <b>Total</b><b>₹{total} · {duration} min</b>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          {shopBarbers.length === 0 ? (
            <p>No barber offers all selected services right now.</p>
          ) : shopBarbers.map((b) => {
            const off = b.status !== "Available";
            const q = activeOf(shop.queues?.[b.id] || []);
            const bwait = etaFor(shop.servicesList, shop.queues?.[b.id] || [], q.length);
            return (
              <button
                key={b.id}
                disabled={off}
                onClick={() => setBid(b.id)}
                className={`w-full flex gap-4 items-center border p-4 text-left ${bid === b.id ? "border-coffee bg-olive/15" : "border-khaki"} disabled:opacity-50`}
              >
                <img src={b.photo || "/img/barber-placeholder.svg"} alt="" className="w-14 h-14 rounded-full object-cover bg-khaki" />
                <div className="flex-1 text-sm">
                  <b className="text-base">{b.name}</b> {b.rating ? <Rating v={b.rating} /> : null}<br />
                  {off ? b.status : `${q.length} ahead · ~${bwait} min`}
                </div>
                <Badge tone={off ? "warn" : "ok"}>{b.status}</Badge>
              </button>
            );
          })}
        </div>
      )}

      {step === 2 && barber && (
        <div className="border border-khaki p-6 space-y-2">
          {activeSelfBooking && forWhom === "self" && (
            <div className="border border-brass/40 bg-brass/10 p-3 text-sm mb-3">
              You already have an active queue booking at <b>{activeSelfBooking.shop.name}</b> (#{activeSelfBooking.entry.token}).
            </div>
          )}
          <Row k="Services" v={selected.map((s) => `${s.name} · ${s.duration} min`).join(", ")} />
          <Row k="Barber" v={barber.name} />
          <Row k="Customers ahead" v={activeOf(shop.queues?.[barber.id] || []).length} />
          <Row k="Estimated wait" v={`${wait} min`} />
          <Row k="Total" v={`₹${total}`} />

          <div className="border-t border-khaki mt-4 pt-4">
            <p className="label mb-2">Booking for</p>
            <div className="flex gap-2">
              <button type="button" className={`btn-ghost ${forWhom === "self" ? "!bg-olive !text-[#1C1713]" : ""}`} onClick={() => setForWhom("self")}>Myself</button>
              <button type="button" className={`btn-ghost ${forWhom === "friend" ? "!bg-olive !text-[#1C1713]" : ""}`} onClick={() => setForWhom("friend")}>Someone else</button>
            </div>
            {forWhom === "friend" && (
              <div className="grid md:grid-cols-2 gap-3 mt-3">
                <input className="input" placeholder="Person's name" value={friend.name} onChange={(e) => setFriend({ ...friend, name: e.target.value })} />
                <input className="input" placeholder="Mobile number" value={friend.mobile} onChange={(e) => setFriend({ ...friend, mobile: e.target.value })} />
                <input className="input md:col-span-2" type="email" pattern="^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$" placeholder="Person's email" value={friend.email} onChange={(e) => setFriend({ ...friend, email: e.target.value })} />
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
                <b>{k} policy</b><p className="text-sm text-coffee/75">{v}</p>
              </div>
            ))}
          </div>
          <label className="flex gap-2 mt-4 text-sm">
            <input type="checkbox" className="accent-[#B39A6A]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            I have read and agree to this shop's policies.
          </label>
        </div>
      )}

      {step === 4 && (
        <div className="border border-khaki bg-card p-6 md:p-8">
          {quoteBusy ? (
            <div className="py-12 text-center text-soft">
              <span className="pay-spinner pay-spinner-lg inline-block" />
              <p className="mt-4">Checking payment amount...</p>
            </div>
          ) : !shop.upiQrUrl ? (
            <div className="py-12 text-center">
              <p className="font-serif text-3xl">This shop can't take bookings yet.</p>
              <p className="text-sm text-soft mt-2">The shop owner must upload the original UPI QR image.</p>
            </div>
          ) : quote ? (
            <div className="space-y-6">
              <div>
                <p className="label">UPI payment</p>
                <h2 className="font-serif text-5xl mt-2">Send ₹{Number(quote.amount).toFixed(2)}</h2>
                <p className="text-sm text-soft mt-2">Scan this QR and pay the exact amount.</p>
              </div>

              <div className="flex justify-center border border-khaki bg-white p-4">
                <img src={quote.qrUrl} alt={`${shop.name} UPI QR`} className="w-64 h-64 object-contain" />
              </div>

              <label className="block">
                <span className="label">Who is paying? (your name or a friend's)</span>
                <input
                  className="input mt-2"
                  placeholder={customer?.name || "Name"}
                  value={payerName}
                  onChange={(e) => setPayerName(e.target.value.slice(0, 120))}
                />
              </label>

              <p className="text-sm text-soft">Press the button only after you have completed the payment.</p>

              <button
                type="button"
                className="btn w-full !py-4 text-lg"
                disabled={submitBusy || (forWhom === "self" && !!activeSelfBooking)}
                onClick={submitPayment}
              >
                {submitBusy ? <><span className="pay-spinner" />Submitting...</> : "I have paid"}
              </button>

              {paymentError && <p className="text-rose text-sm" role="alert">{paymentError}</p>}
            </div>
          ) : (
            <div className="py-10 text-center">
              <p className="text-soft">{paymentError || "Payment could not be prepared."}</p>
              <button type="button" className="btn mt-4" onClick={loadQuote}>Try again</button>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between mt-8">
        {step > 0 ? <button className="btn-ghost" onClick={back}>Back</button> : <span />}
        {step < 4 && (
          <button
            className="btn"
            disabled={!canNext || (step === 2 && forWhom === "friend" && !friend.name.trim())}
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
    <span className="text-coffee/60">{k}</span><b className="text-right">{v}</b>
  </div>
);
