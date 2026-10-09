import { useState } from "react";
import { useOwner } from "../../hooks/useOwnerStore";
import {
  PageHead,
  StatusBadge,
  Modal,
  Empty,
} from "../../components/common/ui";
import { activeOf, etaFor, durOf } from "../../utils/ownerEta";
import { fmtMin } from "../../utils/eta";
const ARR = {
  ontime: "Arrives on time",
  late: "Late (grace period active)",
  none: "Has not arrived",
};
const RULE = {
  Skip: "Grace period",
  "No Show": "No-show",
  Cancel: "Cancellation",
};
export default function Queue() {
  const {
    barbers,
    queues,
    services,
    shop,
    up,
    setQueueStatus,
    contactCustomer,
    pendingBookings,
    acceptBooking,
    declineBooking,
  } = useOwner();
  const [busyId, setBusyId] = useState(null);
  const [declining, setDeclining] = useState(null);
  const [declineReason, setDeclineReason] = useState("");
  const [payError, setPayError] = useState("");
  const awaiting = (pendingBookings || []).filter((b) => b.shopId === shop?.id);
  const [ask, setAsk] = useState(null);
  const [msg, setMsg] = useState(null);
  const [message, setMessage] = useState(
    "Your turn is coming up. Please head to the shop.",
  );
  const [sending, setSending] = useState(false);
  const accept = async (b) => {
    setBusyId(b.id);
    setPayError("");
    try {
      await acceptBooking(b);
    } catch (e) {
      setPayError(
        e.response?.data?.message ||
          e.message ||
          "Could not accept this booking.",
      );
    } finally {
      setBusyId(null);
    }
  };
  const refuse = async () => {
    const b = declining;
    setBusyId(b.id);
    setPayError("");
    try {
      await declineBooking(b, declineReason);
      setDeclining(null);
      setDeclineReason("");
    } catch (e) {
      setPayError(
        e.response?.data?.message ||
          e.message ||
          "Could not decline this booking.",
      );
      setDeclining(null);
    } finally {
      setBusyId(null);
    }
  };
  const patch = (bid, id, ch) =>
    up("queues", (q) => ({
      ...q,
      [bid]: q[bid].map((e) => (e.id === id ? { ...e, ...ch } : e)),
    }));
  const act = (bid, e, a) => {
    if (a === "Call") return setQueueStatus(shop.id, bid, e.id, "Your Turn");
    if (a === "Start") return setQueueStatus(shop.id, bid, e.id, "In Service");
    if (a === "Complete")
      return setQueueStatus(shop.id, bid, e.id, "Completed");
    setAsk({ bid, e, a });
  };
  const confirm = () => {
    const { bid, e, a } = ask;
    setQueueStatus(
      shop.id,
      bid,
      e.id,
      a === "Skip" ? "Skipped" : a === "No Show" ? "No Show" : "Cancelled",
    );
    setAsk(null);
  };
  const send = async () => {
    if (!msg || !message.trim()) return;
    setSending(true);
    try {
      await contactCustomer({ shopId: shop.id, queueId: msg.id, message });
      setMsg(null);
    } catch (e) {
      window.alert(e.message);
    } finally {
      setSending(false);
    }
  };
  if (!barbers.length)
    return (
      <>
        <PageHead title="Queue" />
        <Empty
          title="No barbers"
          text="Add a barber to start managing queues."
        />
      </>
    );
  return (
    <>
      <PageHead
        title="Queue"
        sub="Each barber has an independent queue. Position 1 is automatically marked Your Turn. Skipped customers move to the end of the queue."
      />
      {(awaiting.length > 0 || payError) && (
        <section className="border border-brass bg-card p-5 mb-10">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-2xl">Payments awaiting your confirmation</h2>
            <span className="text-sm text-soft">{awaiting.length} waiting</span>
          </div>
          <p className="text-sm text-soft mt-1">
            These customers say they paid the exact amount shown on your QR.
            Check your UPI app, then accept or decline. Only ACCEPT adds a
            customer to the queue.
          </p>
          {payError && (
            <p className="text-rose text-sm mt-3" role="alert">
              {payError}
            </p>
          )}
          {awaiting.map((b) => (
            <div
              key={b.id}
              className="py-4 border-t border-khaki mt-4 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="text-sm">
                <b className="text-base">
                  {b.beneficiary?.isSelf === false
                    ? b.beneficiary.name
                    : b.customerName}
                </b>
                {b.beneficiary?.isSelf === false && (
                  <span className="text-xs ml-2 text-soft">
                    Booked by {b.customerName}
                  </span>
                )}
                <p className="text-soft mt-1">
                  {b.services.map((x) => x.name).join(" + ")} with{" "}
                  {b.barberName} · {b.durationMinutes} min · ₹{b.amount}
                </p>
                <p className="text-xs text-hint mt-1">
                  Submitted{" "}
                  {b.paymentSubmittedAt
                    ? new Date(b.paymentSubmittedAt).toLocaleTimeString(
                        "en-IN",
                        { hour: "numeric", minute: "2-digit" },
                      )
                    : new Date(b.createdAt).toLocaleTimeString("en-IN", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}{" "}
                  · Payer: {b.payerName || b.customerName}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  className="btn !py-2"
                  disabled={busyId === b.id}
                  onClick={() => accept(b)}
                >
                  {busyId === b.id ? "Working" : "Accept"}
                </button>
                <button
                  className="btn-ghost !py-2"
                  disabled={busyId === b.id}
                  onClick={() => {
                    setDeclining(b);
                    setDeclineReason("");
                  }}
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <div className="grid xl:grid-cols-2 gap-10">
        {barbers.map((b) => {
          const list = activeOf(queues[b.id] || []);
          const hasSvc = list.some((e) => e.status === "In Service");
          const firstWaiting = list.find((e) => e.status === "Waiting");
          return (
            <section key={b.id}>
              <div className="flex items-center justify-between border-b border-coffee pb-2">
                <h2 className="text-3xl uppercase tracking-wide">{b.name}</h2>
                <span className="text-sm flex items-center gap-2">
                  <StatusBadge s={b.status} />
                  {list.length} active
                </span>
              </div>
              {list.length === 0 ? (
                <p className="py-8 text-sm text-coffee/60">
                  No active queue for {b.name}.
                </p>
              ) : (
                list.map((e, i) => {
                  const wait = etaFor(services, queues[b.id] || [], i);
                  const d = durOf(services, e.service);
                  const svcNames =
                    e.services?.map((x) => x.name).join(" + ") ||
                    services.find((s) => s.id === e.service)?.name;
                  const totalDur = e.serviceDuration || d;
                  return (
                    <div key={e.id} className="py-4 border-b border-khaki">
                      <div className="flex flex-wrap justify-between gap-2">
                        <div>
                          <span className="font-serif text-3xl mr-3">
                            #{e.token}
                          </span>
                          <b>
                            {e.beneficiary?.isSelf === false
                              ? e.beneficiary.name
                              : e.name}
                          </b>
                          {e.beneficiary?.isSelf === false && (
                            <span className="text-xs ml-2 text-coffee/60">
                              Booked by {e.name}
                            </span>
                          )}
                          <p className="text-sm text-coffee/70">
                            {svcNames} · {totalDur} min · Position {i + 1} · {i}{" "}
                            ahead
                          </p>
                        </div>
                        <div className="text-right text-sm">
                          <StatusBadge s={e.status} />
                          <p className="mt-1">
                            {e.status === "In Service" ||
                            e.status === "Your Turn"
                              ? "Now"
                              : `Wait ${fmtMin(wait)}`}
                          </p>
                        </div>
                      </div>
                      {e.status === "Your Turn" && (
                        <div className="mt-3 bg-brass/10 p-3 text-sm">
                          <div className="flex flex-wrap gap-2 mb-2">
                            {Object.entries(ARR).map(([k, v]) => (
                              <button
                                key={k}
                                onClick={() =>
                                  patch(b.id, e.id, { arrival: k })
                                }
                                className={`px-2 py-1 border text-xs ${e.arrival === k ? "border-coffee bg-olive text-cream" : "border-khaki"}`}
                              >
                                {v}
                              </button>
                            ))}
                          </div>
                          {e.arrival === "late" && (
                            <p>
                              Grace period:{" "}
                              {shop.policy?.["Grace period"] ||
                                "Follow the shop's grace-period policy."}{" "}
                              You can wait, skip or cancel.
                            </p>
                          )}
                          {e.arrival === "none" && (
                            <p>
                              Not arrived. Consider the no-show policy before
                              acting.
                            </p>
                          )}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2 mt-3">
                        {e.status === "Waiting" &&
                          e.id === firstWaiting?.id && (
                            <button
                              className="btn !py-2"
                              onClick={() => act(b.id, e, "Call")}
                            >
                              Call customer
                            </button>
                          )}
                        {e.status === "Your Turn" && (
                          <>
                            <button
                              className="btn !py-2"
                              onClick={() => act(b.id, e, "Start")}
                              disabled={hasSvc}
                            >
                              Start service
                            </button>
                            <button
                              className="btn-ghost !py-2"
                              onClick={() => act(b.id, e, "No Show")}
                            >
                              No show
                            </button>
                          </>
                        )}
                        {e.status === "In Service" && (
                          <button
                            className="btn !py-2"
                            onClick={() => act(b.id, e, "Complete")}
                          >
                            Complete service
                          </button>
                        )}
                        {e.status !== "In Service" && (
                          <>
                            <button
                              className="btn-ghost !py-2"
                              onClick={() => act(b.id, e, "Skip")}
                            >
                              Skip to end
                            </button>
                            <button
                              className="btn-ghost !py-2 !border-rose !text-rose hover:!bg-rose hover:!text-cream"
                              onClick={() => act(b.id, e, "Cancel")}
                            >
                              Cancel
                            </button>
                          </>
                        )}
                        <button
                          className="text-sm underline px-2"
                          onClick={() => {
                            setMsg(e);
                            setMessage(
                              "Your turn is coming up. Please head to the shop.",
                            );
                          }}
                        >
                          Contact customer
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </section>
          );
        })}
      </div>
      {ask && (
        <Modal
          title={`${ask.a === "No Show" ? "Mark as no-show" : ask.a === "Skip" ? "Move customer to end?" : ask.a} #${ask.e.token}?`}
          onClose={() => setAsk(null)}
          actions={
            <button className="btn !bg-rose" onClick={confirm}>
              Confirm
            </button>
          }
        >
          <p>
            {ask.e.beneficiary?.isSelf === false
              ? ask.e.beneficiary.name
              : ask.e.name}
            's queue entry will be updated.
          </p>
          <div className="border-l-2 border-brass pl-3">
            <b>{RULE[ask.a] || "Queue policy"} policy</b>
            <p>
              {shop.policy?.[RULE[ask.a]] ||
                "Apply the shop's configured policy."}
            </p>
          </div>
        </Modal>
      )}
      {declining && (
        <Modal
          title="Payment not received?"
          onClose={() => setDeclining(null)}
          actions={
            <button
              className="btn !bg-rose"
              disabled={busyId === declining.id}
              onClick={refuse}
            >
              {busyId === declining.id ? "Working" : "Decline booking"}
            </button>
          }
        >
          <p>
            Check your UPI app for ₹{declining.amount}. If the payment is not
            visible, decline this booking. The customer will be blocked from
            rebooking this shop for 30 minutes.
          </p>
          <input
            className="input"
            placeholder="Reason (optional)"
            value={declineReason}
            onChange={(e) => setDeclineReason(e.target.value)}
          />
        </Modal>
      )}
      {msg && (
        <Modal
          title="Contact customer"
          onClose={() => setMsg(null)}
          actions={
            <button className="btn" disabled={sending} onClick={send}>
              {sending ? "Sending..." : "Send"}
            </button>
          }
        >
          <p>
            Send a formal queue update to the booking recipient's email. The
            recipient's email and mobile number stay private.
          </p>
          <textarea
            className="input mt-3"
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <p className="text-xs text-coffee/60 mt-2">
            The email includes the token, shop, barber, services and current
            status automatically.
          </p>
        </Modal>
      )}
    </>
  );
}
