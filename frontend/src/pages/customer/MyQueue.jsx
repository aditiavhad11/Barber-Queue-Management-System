import { useEffect, useMemo, useRef, useState } from "react";
import LiveWait from "../../components/common/LiveWait";
import AwaitingBookings from "../../components/common/AwaitingBookings";
import { Navigation, Plus, Star, MessageSquareWarning } from "lucide-react";
import { useOwner } from "../../hooks/useOwnerStore";
import { activeOf, etaFor } from "../../utils/ownerEta";
import { distanceKm, getCurrentLocation } from "../../utils/location";
import { Badge, Empty } from "../../components/common/ui";
import { api } from "../../services/api";

const progress = ["Booked", "Waiting", "Your Turn", "In Service", "Completed"];
const activeStatuses = ["Waiting", "Your Turn", "In Service"];

export default function MyQueue() {
  const {
    customerQueues,
    setQueueStatus,
    queueAction,
    requestServiceEdit,
    refreshBookings,
    myBookings,
  } = useOwner();
  const [selectedId, setSelectedId] = useState(null);
  const [distance, setDistance] = useState(null);
  const [adding, setAdding] = useState(false);
  const [selectedServices, setSelectedServices] = useState([]);
  const [paying, setPaying] = useState(false);
  const [addServiceError, setAddServiceError] = useState("");
  const [serviceEdits, setServiceEdits] = useState([]);
  const [unavailableServices, setUnavailableServices] = useState([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const [payerName, setPayerName] = useState("");
  const [requestKey, setRequestKey] = useState("");
  const [serviceEditSuccess, setServiceEditSuccess] = useState("");
  const [swapTargetPosition, setSwapTargetPosition] = useState("");
  const handledClosureAction = useRef("");

  useEffect(() => {
    // A booking can be accepted while this page is mounting. Refresh once
    // immediately so the queue is visible without requiring a second visit.
    refreshBookings();
    // refreshBookings is a provider action whose identity changes with state;
    // this mount refresh must not become a render loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeBookings = useMemo(
    () => customerQueues.filter((q) => activeStatuses.includes(q.entry.status)),
    [customerQueues],
  );
  const selected =
    customerQueues.find((q) => q.entry.id === selectedId) ||
    activeBookings[0] ||
    customerQueues[0] ||
    null;

  useEffect(() => {
    if (!selectedId && activeBookings[0])
      setSelectedId(activeBookings[0].entry.id);
    if (selectedId && !customerQueues.some((q) => q.entry.id === selectedId))
      setSelectedId(activeBookings[0]?.entry.id || null);
  }, [activeBookings, customerQueues, selectedId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const bookingId = params.get("closure");
    const choice = params.get("choice");
    const target = customerQueues.find((q) => q.entry.id === bookingId);
    const action =
      choice === "wait"
        ? "closure_wait"
        : choice === "refund"
          ? "closure_refund"
          : "";
    if (!target || !action || target.entry.status !== "Emergency Closed")
      return;
    const key = `${bookingId}:${action}`;
    if (handledClosureAction.current === key) return;
    handledClosureAction.current = key;
    queueAction(target.shop.id, target.barberId, target.entry.id, action);
  }, [customerQueues, queueAction]);

  useEffect(() => {
    let cancelled = false;
    const loadEdits = async () => {
      try {
        const { data } = await api.get("/bookings/service-edits/mine", {
          toastOnError: false,
        });
        if (!cancelled) setServiceEdits(data || []);
      } catch {
        if (!cancelled) setServiceEdits([]);
      }
    };
    loadEdits();
    const timer = setInterval(loadEdits, 8000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!adding || !selected?.entry.bookingDate || !selected?.shop.id)
      return undefined;
    let cancelled = false;
    setAvailabilityError("");
    setAvailabilityLoading(true);
    setUnavailableServices([]);
    api
      .get("/shops/" + selected.shop.id + "/service-availability", {
        params: { date: selected.entry.bookingDate },
        toastOnError: false,
      })
      .then(({ data }) => {
        if (!cancelled)
          setUnavailableServices(
            (data || []).map((item) => String(item.serviceId)),
          );
      })
      .catch((error) => {
        if (!cancelled)
          setAvailabilityError(
            error.response?.data?.message ||
              "Could not check service availability.",
          );
      })
      .finally(() => {
        if (!cancelled) setAvailabilityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [adding, selected?.entry.bookingDate, selected?.shop.id]);

  const hasAcceptedBooking = (myBookings || []).some(
    (booking) =>
      booking.status === "accepted" &&
      !booking.isPrebooking &&
      ["Waiting", "Your Turn", "In Service"].includes(booking.queueStatus),
  );
  const hasPendingBooking = (myBookings || []).some(
    (booking) => booking.status === "payment_submitted",
  );

  if (!customerQueues.length)
    return (
      <>
        <AwaitingBookings />
        {hasAcceptedBooking ? (
          <div className="border border-brass bg-card p-6 text-center">
            <p className="label !text-gold-light">Queue booking</p>
            <h1 className="text-3xl mt-2">Loading your queue position...</h1>
            <p className="text-sm text-coffee/70 mt-2">
              Your payment is confirmed. We are syncing the live queue ticket.
            </p>
          </div>
        ) : hasPendingBooking ? (
          <div className="border border-brass bg-card p-6 text-center">
            <p className="label !text-gold-light">Booking received</p>
            <h1 className="text-3xl mt-2">Waiting for shop confirmation</h1>
            <p className="text-sm text-coffee/70 mt-2">
              Your payment was submitted. Your queue ticket will appear here
              as soon as the shop confirms it.
            </p>
          </div>
        ) : (
          <Empty
            title="No queue bookings"
            text="Join a shop queue after payment to see your active tickets here."
          />
        )}
      </>
    );
  if (!selected) return null;

  const { shop, barber, entry } = selected;
  const services = entry.services?.length
    ? entry.services
    : [selected.service].filter(Boolean);
  const queue = shop.queues?.[selected.barberId] || [];
  const active = activeOf(queue);
  const reorderableEntries = active.filter((item) =>
    ["Waiting", "Your Turn"].includes(item.status),
  );
  const index = active.findIndex((e) => e.id === entry.id);
  const position = index >= 0 ? index + 1 : null;
  const wait =
    entry.status === "Waiting" && index >= 0
      ? etaFor(shop.servicesList, queue, index)
      : 0;
  const serviceNames = services.map((s) => s.name).join(" + ");
  const statusIndex =
    entry.status === "Waiting"
      ? 1
      : entry.status === "Your Turn"
        ? 2
        : entry.status === "In Service"
          ? 3
          : entry.status === "Completed"
            ? 4
            : 0;
  const currentServiceIds = services.map((service) => String(service.id));
  const editableServices = (shop.servicesList || []).filter(
    (service) =>
      service.enabled !== false &&
      !unavailableServices.includes(String(service.id)),
  );
  const desiredServiceRows = (shop.servicesList || []).filter((service) =>
    selectedServices.includes(String(service.id)),
  );
  const currentServiceBase = services.reduce(
    (sum, service) => sum + Number(service.price || 0),
    0,
  );
  const desiredServiceBase = desiredServiceRows.reduce(
    (sum, service) => sum + Number(service.price || 0),
    0,
  );
  const servicePriceDelta =
    Math.round(
      (desiredServiceBase - currentServiceBase + Number.EPSILON) * 100,
    ) / 100;
  const proposedTotal = Math.max(
    0,
    Number(entry.paymentAmount || 0) + servicePriceDelta,
  );
  const pendingServiceEdit = serviceEdits.find(
    (edit) =>
      edit.bookingId === entry.bookingId &&
      ["payment_review", "refund_review"].includes(edit.status),
  );

  const findDistance = async () => {
    try {
      const loc = await getCurrentLocation();
      setDistance(distanceKm(loc, shop.location));
    } catch {
      setDistance(null);
    }
  };
  const cancel = () => {
    const ok = window.confirm(
      "Cancel this booking and remove yourself from the queue?",
    );
    if (!ok) return;
    setQueueStatus(shop.id, selected.barberId, entry.id, "Cancelled");
  };
  const submitServiceEdit = async () => {
    if (!selectedServices.length || paying || !entry.bookingId) return;
    if (servicePriceDelta > 0 && !payerName.trim()) {
      setAddServiceError(
        "Enter the payer name after paying the additional amount.",
      );
      return;
    }
    setPaying(true);
    setAddServiceError("");
    try {
      const key = requestKey || globalThis.crypto.randomUUID();
      setRequestKey(key);
      const result = await requestServiceEdit({
        bookingId: entry.bookingId,
        serviceIds: selectedServices,
        payerName,
        requestKey: key,
      });
      if (result.unchanged) await refreshBookings();
      if (result.edit)
        setServiceEdits((items) => [
          result.edit,
          ...items.filter((item) => item.id !== result.edit.id),
        ]);
      setServiceEditSuccess(
        servicePriceDelta > 0
          ? "Payment confirmed and services updated."
          : servicePriceDelta < 0
            ? "Refund and service change request sent to the shop."
            : "Services updated.",
      );
      setSelectedServices([]);
      setAdding(false);
      setPayerName("");
      setRequestKey("");
      await refreshBookings();
    } catch (error) {
      setAddServiceError(
        error.response?.data?.message ||
          error.message ||
          "Could not submit service edit.",
      );
    } finally {
      setPaying(false);
    }
  };
  const positionOptions = reorderableEntries
    .map((_, queueIndex) => queueIndex + 1)
    .filter((target) => target !== position);
  const swapTarget = positionOptions.includes(Number(swapTargetPosition))
    ? Number(swapTargetPosition)
    : positionOptions[0] || 0;

  return (
    <div className="fade max-w-5xl">
      <AwaitingBookings />
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <p className="label">My queue</p>
          <h1 className="text-5xl">Track your bookings</h1>
          <p className="text-coffee/70 mt-1">
            Each active ticket is tracked independently.
          </p>
        </div>
        <Badge tone="info">
          {activeBookings.length} active booking
          {activeBookings.length === 1 ? "" : "s"}
        </Badge>
      </div>

      <div className="space-y-2 mb-10">
        {customerQueues.map((q) => {
          const qActive = activeOf(q.shop.queues?.[q.barberId] || []);
          const pos = qActive.findIndex((e) => e.id === q.entry.id) + 1;
          const isActive = activeStatuses.includes(q.entry.status);
          return (
            <button
              key={q.entry.id}
              onClick={() => setSelectedId(q.entry.id)}
              className={`w-full text-left border p-4 flex flex-wrap items-center justify-between gap-3 ${selected.entry.id === q.entry.id ? "border-coffee bg-olive/10" : "border-khaki"}`}
            >
              <div>
                <span className="font-serif text-3xl">#{q.entry.token}</span>
                <span className="ml-4 font-medium">{q.shop.name}</span>
                <p className="text-sm text-coffee/65 mt-1">
                  {q.entry.beneficiary?.isSelf === false
                    ? `For ${q.entry.beneficiary.name} · Booked by ${q.entry.name}`
                    : "For myself"}{" "}
                  · {q.barber?.name || "Barber"}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm">
                  {isActive && pos ? `Position ${pos}` : q.entry.status}
                </span>
                <Badge
                  tone={
                    q.entry.status === "Completed"
                      ? "ok"
                      : q.entry.status === "Cancelled"
                        ? "alert"
                        : q.entry.status === "Your Turn"
                          ? "warn"
                          : "info"
                  }
                >
                  {q.entry.status}
                </Badge>
              </div>
            </button>
          );
        })}
      </div>

      <section>
        <p className="label">Token</p>
        <h2 className="text-7xl">#{entry.token}</h2>
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <Badge
            tone={
              entry.status === "In Service" || entry.status === "Completed"
                ? "ok"
                : entry.status === "Your Turn"
                  ? "warn"
                  : entry.status === "Cancelled"
                    ? "alert"
                    : "info"
            }
          >
            {entry.status}
          </Badge>
          {["Waiting", "Your Turn"].includes(entry.status) &&
            position === 1 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-gold">
                  You&apos;re next. Running late?
                </span>
                {positionOptions.length > 0 && (
                  <>
                    <label className="flex items-center gap-2 text-sm">
                      Move me to
                      <select
                        className="input !w-auto !py-1.5"
                        value={swapTarget}
                        onChange={(event) =>
                          setSwapTargetPosition(event.target.value)
                        }
                      >
                        {positionOptions.map((position) => (
                          <option key={position} value={position}>
                            Position {position}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="btn-ghost !py-1.5"
                      onClick={() =>
                        queueAction(
                          shop.id,
                          selected.barberId,
                          entry.id,
                          "swap",
                          swapTarget,
                        )
                      }
                    >
                      Update position
                    </button>
                  </>
                )}
                {positionOptions.length === 0 && (
                  <span className="text-sm text-coffee/65">
                    You are first in this barber&apos;s queue.
                  </span>
                )}
              </div>
            )}
          {entry.status === "In Service" && (
            <span className="text-sm text-olive">
              Your service is in progress.
            </span>
          )}
        </div>

        <div className="grid grid-cols-5 gap-1 mt-8">
          {progress.map((p, i) => (
            <div
              key={p}
              className={`h-1.5 ${i <= statusIndex ? "bg-olive" : "bg-khaki"}`}
            />
          ))}
        </div>
        <div className="grid grid-cols-5 gap-2 mt-2 text-[10px] text-coffee/60">
          {progress.map((p) => (
            <span key={p}>{p}</span>
          ))}
        </div>

        {activeStatuses.includes(entry.status) && (
          <p className="text-sm mt-4 font-medium">
            {position
              ? `Position ${position} · ${Math.max(position - 1, 0)} customer${Math.max(position - 1, 0) === 1 ? "" : "s"} ahead`
              : "Queue position is being updated."}
          </p>
        )}

        {entry.status === "Emergency Closed" && (
          <div className="border border-rose/30 bg-rose/10 p-5 mt-8">
            <p className="font-semibold text-rose">
              Your turn was cancelled due to an emergency closure
            </p>
            <p className="text-sm mt-1">
              The active queue is now empty. Choose whether to wait for
              reopening or request a refund for this booking.
            </p>
            {!entry.closureChoice && (
              <div className="flex flex-wrap gap-3 mt-4">
                <button
                  className="btn"
                  onClick={() =>
                    queueAction(
                      shop.id,
                      selected.barberId,
                      entry.id,
                      "closure_wait",
                    )
                  }
                >
                  Wait for reopening
                </button>
                <button
                  className="btn-ghost text-rose"
                  onClick={() =>
                    queueAction(
                      shop.id,
                      selected.barberId,
                      entry.id,
                      "closure_refund",
                    )
                  }
                >
                  Request refund
                </button>
              </div>
            )}
            {entry.closureChoice === "wait" && (
              <p className="text-sm mt-4">
                You chose to wait. Your ticket will resume when the shop
                reopens.
              </p>
            )}
            {entry.closureChoice === "refund" && (
              <p className="text-sm mt-4">
                Your refund request was sent to the shop.
              </p>
            )}
          </div>
        )}

        <dl className="grid md:grid-cols-2 gap-7 mt-8 text-sm">
          <div>
            <dt className="label">Booking for</dt>
            <dd className="font-serif text-2xl">
              {entry.beneficiary?.isSelf === false
                ? `${entry.beneficiary.name} · Booked by ${entry.name}`
                : entry.name}
            </dd>
          </div>
          <div>
            <dt className="label">Barber</dt>
            <dd className="font-serif text-2xl">{barber?.name || "Barber"}</dd>
          </div>
          <div>
            <dt className="label">Services</dt>
            <dd className="mt-2 space-y-1">
              {services.map((service) => (
                <div
                  key={service.id}
                  className="flex justify-between gap-3 text-sm"
                >
                  <span>
                    {service.name} · {service.duration} min
                  </span>
                  <span>₹{Number(service.price).toFixed(2)}</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-khaki pt-2 font-medium">
                <span>
                  Total ·{" "}
                  {entry.serviceDuration ||
                    services.reduce(
                      (sum, service) => sum + Number(service.duration || 0),
                      0,
                    )}{" "}
                  min
                </span>
                <span>₹{Number(entry.paymentAmount || 0).toFixed(2)}</span>
              </div>
            </dd>
          </div>
          <div>
            <dt className="label">Estimated wait</dt>
            <dd className="font-serif text-2xl">
              {entry.status === "Your Turn" || entry.status === "In Service" ? (
                "Now"
              ) : entry.status === "Waiting" ? (
                <LiveWait id={entry.id} minutes={wait} />
              ) : (
                "-"
              )}
            </dd>
          </div>
          <div>
            <dt className="label">Shop</dt>
            <dd className="font-serif text-2xl">{shop.name}</dd>
          </div>
          <div>
            <dt className="label">Status</dt>
            <dd className="font-serif text-2xl">{entry.status}</dd>
          </div>
          <div>
            <dt className="label">Location</dt>
            <dd className="font-serif text-2xl">{shop.address}</dd>
          </div>
          <div>
            <dt className="label">Distance</dt>
            <dd className="font-serif text-2xl">
              {distance != null ? `${distance} km` : "Not calculated"}
            </dd>
          </div>
        </dl>

        {entry.status === "In Service" && (
          <div className="border border-olive/40 bg-olive/10 p-5 mt-8">
            <p className="label">IN SERVICE</p>
            <p className="font-serif text-2xl mt-1">
              {barber?.name || "Your barber"} is serving you.
            </p>
            <p className="text-sm mt-2">
              {serviceNames} · {entry.serviceDuration} min total
            </p>
          </div>
        )}

        {entry.status === "Completed" && (
          <div className="border-t border-khaki mt-10 pt-7">
            <p className="label">Service completed</p>
            <p className="text-coffee/70 mt-1">
              You can now leave feedback or report an issue with this visit.
            </p>
            <div className="flex flex-wrap gap-3 mt-4">
              <a className="btn" href="/app/reviews">
                <Star size={16} />
                Review your visit
              </a>
              <a
                className="btn-ghost"
                href={`/app/complaints?shopId=${encodeURIComponent(shop.id)}&queueId=${encodeURIComponent(entry.id)}`}
              >
                <MessageSquareWarning size={16} />
                Report an issue
              </a>
            </div>
          </div>
        )}

        {serviceEdits
          .filter((edit) => edit.bookingId === entry.bookingId)
          .map((edit) => (
            <div key={edit.id} className="border border-khaki p-4 mt-5 text-sm">
              <b>Service edit · {edit.status.replaceAll("_", " ")}</b>
              <p className="mt-1">
                {edit.oldServices.map((service) => service.name).join(" + ")} →{" "}
                {edit.requestedServices
                  .map((service) => service.name)
                  .join(" + ")}
              </p>
              <p className="mt-1">
                Proposed total ₹{Number(edit.proposedTotal || 0).toFixed(2)} ·{" "}
                {edit.proposedDuration} min
              </p>
              {edit.status === "payment_review" && (
                <p className="text-coffee/70 mt-1">
                  Additional payment ₹{edit.amountDelta.toFixed(2)} submitted;
                  waiting for the shop to verify the UPI reference.
                </p>
              )}
              {edit.status === "refund_review" && (
                <p className="text-coffee/70 mt-1">
                  Refund of ₹{Math.abs(edit.amountDelta).toFixed(2)} requested;
                  the shop must process and confirm it before services change.
                </p>
              )}
              {edit.status === "applied" && (
                <p className="text-olive mt-1">
                  Updated services are reflected in your booking.
                </p>
              )}
              {edit.status === "rejected" && (
                <p className="text-rose mt-1">
                  The shop did not approve this edit. Contact the shop if you
                  sent an extra payment.
                </p>
              )}
            </div>
          ))}

        {["Waiting", "Your Turn"].includes(entry.status) &&
          entry.bookingId &&
          !pendingServiceEdit &&
          editableServices.length > 0 && (
            <div className="border-t border-khaki mt-10 pt-6">
              {!adding ? (
                <button
                  className="btn-ghost"
                  onClick={() => {
                    setSelectedServices(currentServiceIds);
                    setAddServiceError("");
                    setAdding(true);
                  }}
                >
                  <Plus size={16} /> Edit Services
                </button>
              ) : (
                <div className="mt-2 border border-khaki p-4 space-y-2">
                  <h3 className="text-xl">Edit services while waiting</h3>
                  <p className="text-sm text-coffee/70">
                    Keep at least one service. The shop and barber will verify
                    availability before applying your selection.
                  </p>
                  {availabilityLoading && (
                    <p className="text-sm text-coffee/70">
                      Checking service availability…
                    </p>
                  )}
                  {!availabilityLoading &&
                    !availabilityError &&
                    editableServices.map((service) => {
                      const id = String(service.id);
                      return (
                        <label
                          key={service.id}
                          className="flex justify-between gap-3 border-b border-khaki py-3"
                        >
                          <span>
                            <input
                              type="checkbox"
                              className="mr-3"
                              checked={selectedServices.includes(id)}
                              disabled={availabilityLoading}
                              onChange={(event) => {
                                setRequestKey("");
                                setSelectedServices((items) =>
                                  event.target.checked
                                    ? [...new Set([...items, id])]
                                    : items.filter((item) => item !== id),
                                );
                              }}
                            />
                            {service.name}
                          </span>
                          <span>
                            ₹{Number(service.price).toFixed(2)} ·{" "}
                            {service.duration} min
                          </span>
                        </label>
                      );
                    })}
                  {!availabilityLoading &&
                    !availabilityError &&
                    editableServices.length === 0 && (
                      <p className="text-sm text-coffee/70 py-3">
                        No services are available for this barber on the booking
                        date.
                      </p>
                    )}
                  <div className="flex justify-between text-sm pt-2">
                    <span>
                      Updated estimate ·{" "}
                      {desiredServiceRows.reduce(
                        (sum, service) => sum + Number(service.duration || 0),
                        0,
                      )}{" "}
                      min
                    </span>
                    <span>₹{proposedTotal.toFixed(2)}</span>
                  </div>
                  {servicePriceDelta > 0 && (
                    <div className="space-y-2 pt-2">
                      <p className="text-sm">
                        Pay the additional ₹{servicePriceDelta.toFixed(2)} using
                        the shop UPI QR.
                      </p>
                      {shop.upiQrUrl ? (
                        <img
                          src={shop.upiQrUrl}
                          alt={shop.name + " UPI QR"}
                          className="w-40 border border-khaki"
                        />
                      ) : (
                        <p className="text-rose text-sm">
                          This shop has no UPI QR configured.
                        </p>
                      )}
                      <input
                        className="input"
                        required
                        placeholder="Payer name"
                        value={payerName}
                        onChange={(event) => setPayerName(event.target.value)}
                      />
                    </div>
                  )}
                  {servicePriceDelta < 0 && (
                    <p className="text-sm pt-2">
                      You are requesting a ₹
                      {Math.abs(servicePriceDelta).toFixed(2)} refund. Services
                      remain unchanged until the shop processes the refund
                      outside this app and confirms it.
                    </p>
                  )}
                  {servicePriceDelta === 0 && (
                    <p className="text-sm pt-2">
                      There is no payment difference. Services update after the
                      change is saved.
                    </p>
                  )}
                  {availabilityError && (
                    <p className="text-sm text-rose" role="alert">
                      {availabilityError}
                    </p>
                  )}
                  {addServiceError && (
                    <p className="text-sm text-rose" role="alert">
                      {addServiceError}
                    </p>
                  )}
                  <div className="flex gap-2 pt-2">
                    {servicePriceDelta <= 0 && (
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={paying}
                        onClick={() => {
                          setAdding(false);
                          setAddServiceError("");
                          setSelectedServices([]);
                        }}
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      type="button"
                      className={`btn ${servicePriceDelta > 0 ? "w-full" : ""}`}
                      disabled={
                        !selectedServices.length ||
                        (selectedServices.length === currentServiceIds.length &&
                          currentServiceIds.every((id) =>
                            selectedServices.includes(id),
                          )) ||
                        paying ||
                        availabilityLoading ||
                        Boolean(availabilityError) ||
                        (servicePriceDelta > 0 && !shop.upiQrUrl)
                      }
                      onClick={submitServiceEdit}
                    >
                      {paying
                        ? "Confirming..."
                        : servicePriceDelta > 0
                          ? "I have paid"
                          : servicePriceDelta < 0
                            ? "Request refund & edit"
                            : "Save services"}
                    </button>
                  </div>
                </div>
              )}
              {!adding && serviceEditSuccess && (
                <p className="text-sm text-green-700 mt-3" role="status">
                  {serviceEditSuccess}
                </p>
              )}
            </div>
          )}

        {entry.status === "Waiting" && !pendingServiceEdit && (
          <div className="flex flex-wrap gap-3 mt-8">
            <button
              className="btn-ghost !border-rose !text-rose hover:!bg-rose hover:!text-cream"
              onClick={cancel}
            >
              Cancel booking
            </button>
          </div>
        )}
        {entry.status === "Waiting" && pendingServiceEdit && (
          <p className="text-sm text-coffee/70 mt-8">
            Resolve the pending service payment or refund before cancelling this
            booking.
          </p>
        )}
      </section>
    </div>
  );
}
