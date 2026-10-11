import { Link, useParams } from "react-router-dom";
import {
  ALL_DAYS,
  scheduleOf,
  isShopOpenNow,
  getTemporaryClosure,
  formatDateDisplay,
} from "../../utils/closedDays";
import { to12Hour } from "../../utils/time";
const fmt12 = (v) => {
  const t = to12Hour(v);
  return `${t.time} ${t.period}`;
};
import { Clock, MapPin, ExternalLink, AlertTriangle } from "lucide-react";
import { useOwner } from "../../hooks/useOwnerStore";
import { activeOf, etaFor } from "../../utils/ownerEta";
import { Badge, Rating, Empty } from "../../components/common/ui";
import { useEffect, useState } from "react";
import { distanceKm, getCurrentLocation } from "../../utils/location";
export default function ShopDetail() {
  const { id } = useParams();
  const { shops } = useOwner();
  const [distance, setDistance] = useState(null);
  const shop = shops.find(
    (s) => s.id === id && s.status === "approved" && s.active,
  );
  const closure = getTemporaryClosure(shop);
  useEffect(() => {
    if (!shop?.location) return;
    getCurrentLocation()
      .then((loc) => setDistance(distanceKm(loc, shop.location)))
      .catch(() => {});
  }, [shop?.id]);
  if (!shop)
    return <Empty title="Shop not found" text="It may not be available." />;
  const bs = shop.barbersList || [],
    list = shop.servicesList || [],
    reviews = shop.reviewsList || [],
    hours =
      typeof shop.hours === "string"
        ? shop.hours
        : `${shop.hours?.open || ""} - ${shop.hours?.close || ""}`;
  return (
    <div className="fade">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 bg-khaki">
        {(shop.photos || []).map((p) => (
          <img
            key={p.id}
            src={p.url}
            alt="Shop"
            className="w-full aspect-[4/3] object-cover"
          />
        ))}
      </div>
      <div className="flex flex-wrap justify-between gap-3 mt-6">
        <div>
          <h1 className="text-5xl">{shop.name}</h1>
          <p className="text-coffee/70 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span className="flex gap-1 items-center">
              <MapPin size={14} />
              {shop.address}
            </span>
            <span className="flex gap-1 items-center">
              <Clock size={14} />
              {hours}
            </span>
            <Rating
              v={`${shop.rating || "New"}${shop.reviews ? ` (${shop.reviews})` : ""}`}
            />
          </p>
          <p className="text-sm text-coffee/70 mt-2">{shop.description}</p>
        </div>
        <Badge
          tone={
            closure.isClosed ? "alert" : isShopOpenNow(shop) ? "ok" : "alert"
          }
        >
          {closure.isClosed
            ? "Temporarily Closed"
            : isShopOpenNow(shop)
              ? "Open now"
              : "Closed"}
        </Badge>
      </div>
      {closure.isClosed && (
        <div className="mt-4 p-4 border border-rose/30 bg-rose/10 rounded-md">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-rose shrink-0 mt-0.5" size={20} />
            <div>
              <div className="font-semibold text-rose text-base">
                Temporarily Closed for Emergency
              </div>
              <p className="text-sm text-coffee/90 mt-1">
                This shop is closed from {formatDateDisplay(closure.startDate)}{" "}
                until{" "}
                <span className="font-semibold">
                  {formatDateDisplay(closure.endDate) || "further notice"}
                </span>
                .
              </p>
              {closure.reason ? (
                <p className="text-sm text-coffee/80 mt-1 italic">
                  Reason: &ldquo;{closure.reason}&rdquo;
                </p>
              ) : null}
              <p className="text-xs text-coffee/60 mt-2">
                Queue bookings are currently disabled. Regular service will
                resume after this closure period.
              </p>
            </div>
          </div>
        </div>
      )}
      {shop.location?.confirmed && (
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <p className="text-xs text-coffee/60">
            {distance != null
              ? `Distance: ${distance} km`
              : "Exact location available"}
          </p>
          <a
            className="btn-ghost !py-2 !px-4 text-xs"
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${shop.location.lat},${shop.location.lng}`)}`}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={14} />
            Open in Google Maps
          </a>
        </div>
      )}
      <iframe
        title="map"
        className="w-full h-48 mt-6 border border-khaki grayscale"
        src={`https://maps.google.com/maps?q=${encodeURIComponent(`${shop.location?.lat || ""},${shop.location?.lng || ""} ${shop.address}`)}&output=embed`}
      />
      <h2 className="text-3xl mt-12 mb-3">Opening hours & availability</h2>
      <div className="border-y border-khaki py-4 text-sm">
        <div className="space-y-1">
          {ALL_DAYS.map((d) => {
            const e = scheduleOf(shop)[d];
            const shifts =
              e.shifts && e.shifts.length
                ? e.shifts
                : [{ open: e.open, close: e.close }];
            return (
              <div
                key={d}
                className="flex justify-between items-start max-w-sm py-1 border-b border-khaki/30 last:border-0"
              >
                <b className="w-12 shrink-0">{d}</b>
                <div className="text-right flex-1">
                  {e.closed ? (
                    <span className="text-rose font-medium">Closed</span>
                  ) : (
                    shifts.map((s, idx) => (
                      <div key={idx} className="text-xs">
                        {fmt12(s.open)} - {fmt12(s.close)}
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-coffee/70">{shop.availability?.note}</p>
      </div>
      <h2 className="text-3xl mt-12 mb-3">Services</h2>
      <div className="border-t border-khaki">
        {list.map((s) => (
          <div
            key={s.id}
            className="flex justify-between py-4 border-b border-khaki"
          >
            <span className="font-medium">{s.name}</span>
            <span className="text-sm flex gap-6">
              <span>₹{s.price}</span>
              <span>{s.duration} min</span>
              <Badge tone={s.enabled === false ? "alert" : "ok"}>
                {s.enabled === false ? "Unavailable" : "Available"}
              </Badge>
            </span>
          </div>
        ))}
      </div>
      <h2 className="text-3xl mt-12 mb-3">Barbers</h2>
      <div className="grid md:grid-cols-2 gap-4">
        {bs.map((b) => {
          const q = activeOf(shop.queues?.[b.id] || []);
          const wait = etaFor(list, shop.queues?.[b.id] || [], q.length);
          return (
            <div key={b.id} className="border border-khaki p-4 flex gap-4">
              <img
                src={b.photo || ""}
                alt=""
                className="w-16 h-16 object-cover rounded-full bg-khaki"
              />
              <div className="text-sm flex-1">
                <div className="flex justify-between">
                  <b className="text-base">{b.name}</b>
                  <Badge
                    tone={
                      b.status === "Available"
                        ? "ok"
                        : b.status === "On Break"
                          ? "warn"
                          : "alert"
                    }
                  >
                    {b.status}
                  </Badge>
                </div>
                <p>
                  {b.gender} {b.experience ? `· ${b.experience} yrs` : ""}{" "}
                  {b.rating ? (
                    <>
                      · <Rating v={b.rating} />
                    </>
                  ) : (
                    ""
                  )}
                </p>
                <p className="text-coffee/70">{b.specialization}</p>
                <p className="text-coffee/70">
                  {b.services
                    .map((x) => list.find((s) => s.id === x)?.name)
                    .filter(Boolean)
                    .join(", ")}
                </p>
                <p className="mt-1">
                  {q.length} in queue · ~{wait} min
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <h2 className="text-3xl mt-12 mb-3">Policies</h2>
      <div className="border-t border-khaki">
        {Object.entries(shop.policy || {}).map(([k, v]) => (
          <div key={k} className="py-3 border-b border-khaki">
            <b>{k}</b>
            <p className="text-sm text-coffee/75">{v}</p>
          </div>
        ))}
      </div>
      <h2 className="text-3xl mt-12 mb-3">Reviews</h2>
      {!reviews.length ? (
        <p className="text-sm text-coffee/60 border-y border-khaki py-4">
          No reviews yet.
        </p>
      ) : (
        reviews.map((r) => (
          <div key={r.id} className="py-3 border-b border-khaki">
            <b>{r.customer}</b> <Rating v={r.rating} />
            <p className="text-sm text-coffee/80">{r.text}</p>
            <p className="text-xs text-coffee/60 mt-1">
              {r.service} with {r.barber} · {r.date}
            </p>
          </div>
        ))
      )}
      <div className="sticky bottom-20 md:bottom-4 mt-10 flex justify-end">
        {closure.isClosed ? (
          <button className="btn opacity-60 cursor-not-allowed" disabled>
            Temporarily closed{" "}
            {closure.endDate ? `until ${formatDateDisplay(closure.endDate)}` : ""}
          </button>
        ) : isShopOpenNow(shop) ? (
          <Link to={`/app/book/${shop.id}`} className="btn shadow-lg">
            Join the queue
          </Link>
        ) : (
          <button className="btn" disabled>
            Shop closed
          </button>
        )}
      </div>
    </div>
  );
}
