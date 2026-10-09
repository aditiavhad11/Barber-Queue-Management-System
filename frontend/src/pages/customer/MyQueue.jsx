import { useEffect, useMemo, useState } from "react";
import LiveWait from "../../components/common/LiveWait";
import AwaitingBookings from "../../components/common/AwaitingBookings";
import { Navigation, Plus, Star, MessageSquareWarning } from "lucide-react";
import { useOwner } from "../../hooks/useOwnerStore";
import { activeOf, etaFor } from "../../utils/ownerEta";
import { distanceKm, getCurrentLocation } from "../../utils/location";
import { Badge, Empty } from "../../components/common/ui";

const progress = ["Booked", "Waiting", "Your Turn", "In Service", "Completed"];
const activeStatuses = ["Waiting", "Your Turn", "In Service"];

export default function MyQueue() {
  const { customerQueues, setQueueStatus, addServiceToQueue } = useOwner();
  const [selectedId, setSelectedId] = useState(null);
  const [distance, setDistance] = useState(null);
  const [adding, setAdding] = useState(false);
  const [selectedServices, setSelectedServices] = useState([]);
  const [paying, setPaying] = useState(false);
  const [addServiceError, setAddServiceError] = useState("");

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

  if (!customerQueues.length)
    return (
      <>
        <AwaitingBookings />
        <Empty
          title="No queue bookings"
          text="Join a shop queue after payment to see your active tickets here."
        />
      </>
    );
  if (!selected) return null;

  const { shop, barber, entry } = selected;
  const services = entry.services?.length
    ? entry.services
    : [selected.service].filter(Boolean);
  const queue = shop.queues?.[selected.barberId] || [];
  const active = activeOf(queue);
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
  const addable = (shop.servicesList || []).filter(
    (s) => s.enabled !== false && !services.some((x) => x.id === s.id),
  );
  const findDistance = async () => {
    try {
      const loc = await getCurrentLocation();
      setDistance(distanceKm(loc, shop.location));
    } catch {
      setDistance(null);
    }
  };
  const cancel = () =>
    setQueueStatus(shop.id, selected.barberId, entry.id, "Cancelled");
  const addSelected = async () => {
    if (!selectedServices.length || paying) return;
    setPaying(true);
    setAddServiceError("");
    try {
      const added = addServiceToQueue({
        queueId: entry.id,
        serviceIds: selectedServices,
      });
      if (!added)
        throw new Error(
          "Could not add the selected service. Refresh the page and try again.",
        );
      setSelectedServices([]);
      setAdding(false);
    } catch (error) {
      setAddServiceError(error.message || "Could not add service.");
    } finally {
      setPaying(false);
    }
  };

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
          {entry.status === "Your Turn" && (
            <span className="text-sm text-gold">Please head to the shop.</span>
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
            <dd className="font-serif text-2xl">{serviceNames}</dd>
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

        {addable.length > 0 && activeStatuses.includes(entry.status) && (
          <div className="border-t border-khaki mt-10 pt-6">
            <button className="btn-ghost" onClick={() => setAdding(!adding)}>
              <Plus size={16} />
              Add Service
            </button>
            {adding && (
              <div className="mt-4 border border-khaki p-4 space-y-2">
                {addable.map((s) => (
                  <label
                    key={s.id}
                    className="flex justify-between border-b border-khaki py-3"
                  >
                    <span>
                      <input
                        type="checkbox"
                        className="mr-3"
                        checked={selectedServices.includes(s.id)}
                        onChange={(e) =>
                          setSelectedServices(
                            e.target.checked
                              ? [...selectedServices, s.id]
                              : selectedServices.filter((x) => x !== s.id),
                          )
                        }
                      />
                      {s.name}
                    </span>
                    <span>
                      ₹{s.price} · {s.duration} min
                    </span>
                  </label>
                ))}
                <button
                  type="button"
                  className="btn mt-3"
                  disabled={!selectedServices.length || paying}
                  onClick={addSelected}
                >
                  {paying
                    ? "Processing payment..."
                    : `Pay ₹${addable.filter((s) => selectedServices.includes(s.id)).reduce((n, s) => n + Number(s.price), 0)}`}
                </button>
                {addServiceError && (
                  <p className="text-sm text-rose mt-2">{addServiceError}</p>
                )}
              </div>
            )}
          </div>
        )}

        {activeStatuses.includes(entry.status) && (
          <div className="flex flex-wrap gap-3 mt-8">
            <button className="btn" onClick={findDistance}>
              <Navigation size={16} />
              Check distance
            </button>
            <a
              className="btn-ghost"
              target="_blank"
              rel="noreferrer"
              href={`https://maps.google.com/?q=${encodeURIComponent(shop.location?.confirmed ? `${shop.location.lat},${shop.location.lng}` : shop.address)}`}
            >
              <Navigation size={16} />
              Directions
            </a>
            <button
              className="btn-ghost !border-rose !text-rose hover:!bg-rose hover:!text-cream"
              onClick={cancel}
            >
              Cancel booking
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
