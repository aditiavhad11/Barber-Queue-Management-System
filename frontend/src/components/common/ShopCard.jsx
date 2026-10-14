import { useState } from "react";
import { Link } from "react-router-dom";
import { isShopOpenNow, getTemporaryClosure, formatDateDisplay } from "../../utils/closedDays";
import { MapPin, AlertCircle, Sparkles, X } from "lucide-react";
import { Rating, Badge, Empty } from "./ui";
import { fmtMin } from "../../utils/eta";
import { activeOf, etaFor } from "../../utils/ownerEta";
import { api } from "../../services/api";

const offerDate = (value) => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
const offerStatus = (status) => ({ active: "Active", scheduled: "Upcoming", paused: "Paused", expired: "Expired" }[status] || status);

export default function ShopCard({ shop }) {
  const [showOffers, setShowOffers] = useState(false);
  const [offers, setOffers] = useState([]);
  const [loadingOffers, setLoadingOffers] = useState(false);
  const [offersError, setOffersError] = useState("");
  const closure = getTemporaryClosure(shop);
  const list = (shop.servicesList || shop.services || []).filter(Boolean).map((x) => (typeof x === "object" ? x : null)).filter(Boolean);
  const min = list.length ? Math.min(...list.map((s) => s.price)) : 0;
  const bs = shop.barbersList || [];
  const waits = bs.map((b) => etaFor(list, shop.queues?.[b.id] || [], activeOf(shop.queues?.[b.id] || []).length));
  const wait = waits.length ? Math.min(...waits) : 0;
  const n = bs.reduce((t, b) => t + activeOf(shop.queues?.[b.id] || []).length, 0);
  const openOffers = async () => {
    setShowOffers(true); setLoadingOffers(true); setOffersError("");
    try {
      const { data } = await api.get(`/schemes/shop/${shop.id}`, { toastOnError: false });
      setOffers(Array.isArray(data) ? data : []);
    } catch (error) {
      setOffersError(error.response?.data?.message || "Could not load this shop's offers.");
    } finally { setLoadingOffers(false); }
  };
  const serviceNames = new Map(list.map((service) => [String(service.id), service.name]));
  const barberNames = new Map(bs.map((barber) => [String(barber.id), barber.name]));

  return (
    <article className="group h-full border border-khaki rounded-md overflow-hidden hover:border-coffee flex flex-col">
      <Link to={`/app/shops/${shop.id}`} className="block">
        <div className="aspect-[16/10] overflow-hidden bg-khaki">
          <img src={shop.image || shop.photos?.[0]?.url || "/img/shop-placeholder.svg"} alt={shop.name} loading="lazy" className={`w-full h-full object-cover ${isShopOpenNow(shop) ? "" : "grayscale"}`} />
        </div>
        <div className="p-5 pb-3">
          <div className="flex justify-between items-start gap-2"><h3 className="text-2xl leading-tight">{shop.name}</h3><Rating v={shop.rating || "New"} /></div>
          <p className="text-sm text-coffee/70 mt-1 flex items-center gap-1"><MapPin size={14} />{shop.address} · {shop.distanceKm ?? "-"} km</p>
          {closure.isClosed && <div className="mt-2 text-xs bg-rose/10 text-rose border border-rose/25 px-2.5 py-1.5 rounded flex items-start gap-1.5"><AlertCircle size={14} className="shrink-0 mt-0.5" /><span className="line-clamp-2">{closure.endDate ? `Closed until ${formatDateDisplay(closure.endDate)}` : "Temporarily closed"}{closure.reason ? ` · ${closure.reason}` : ""}</span></div>}
          <div className="flex flex-wrap gap-1.5 mt-3">{list.map((service) => <span key={service.id} className="text-xs border border-khaki rounded-md px-2 py-0.5">{service.name}</span>)}</div>
          <div className="flex justify-between items-center mt-4 pt-4 border-t border-khaki text-sm"><span>From ₹{min || "-"}</span><span className="text-coffee/70">{isShopOpenNow(shop) ? `${n} waiting · ~${fmtMin(wait)}` : ""}</span><Badge tone={isShopOpenNow(shop) ? "ok" : "alert"}>{closure.isClosed ? "Temporarily Closed" : isShopOpenNow(shop) ? "Open" : "Closed"}</Badge></div>
        </div>
      </Link>
      <div className="px-5 pb-5 mt-auto"><button type="button" className="btn-ghost w-full inline-flex justify-center items-center gap-2" onClick={openOffers}><Sparkles size={15} />View Offers</button></div>

      {showOffers && <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/70 p-0 md:p-6" onClick={() => setShowOffers(false)} role="presentation">
        <section role="dialog" aria-modal="true" aria-labelledby={`offers-title-${shop.id}`} className="bg-card w-full max-w-2xl border border-khaki p-5 md:p-7 max-h-[90vh] overflow-y-auto rounded-t-lg md:rounded-lg" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-start justify-between gap-3 mb-5"><div><p className="label">{shop.name}</p><h2 id={`offers-title-${shop.id}`} className="font-serif text-3xl">Schemes & Offers</h2></div><button className="btn-ghost" onClick={() => setShowOffers(false)} aria-label="Close offers"><X size={18} /></button></div>
          {loadingOffers ? <p className="py-10 text-center text-soft">Loading offers…</p> : offersError ? <p className="border border-rose/30 bg-rose/10 text-rose p-3 text-sm" role="alert">{offersError}</p> : offers.length === 0 ? <Empty title="No offers available" text="This shop has no published schemes right now." /> : <div className="space-y-4">{offers.map((offer) => <article key={offer.id} className="border border-khaki rounded-md overflow-hidden">{offer.imageUrl && <img src={offer.imageUrl} alt={`${offer.title} offer banner`} className="w-full max-h-56 object-cover" />}<div className="p-4 md:p-5"><div className="flex flex-wrap justify-between gap-2 items-start"><h3 className="font-serif text-2xl">{offer.title}</h3><Badge tone={offer.status === "active" ? "ok" : offer.status === "expired" ? "alert" : "warn"}>{offerStatus(offer.status)}</Badge></div><p className="mt-2 whitespace-pre-wrap">{offer.description}</p><p className="font-medium mt-3">{offer.discountType === "percentage" ? `${offer.discountValue}% off` : `₹${offer.discountValue.toFixed(2)} off`}</p><dl className="grid sm:grid-cols-2 gap-x-5 gap-y-2 text-sm mt-4"><div><dt className="label">Valid</dt><dd>{offerDate(offer.startsAt)} – {offerDate(offer.endsAt)}</dd></div><div><dt className="label">Promo code</dt><dd>{offer.promoCode || "Automatic when eligible"}</dd></div><div><dt className="label">Services</dt><dd>{offer.allServices ? "All shop services" : offer.serviceIds.map((serviceId) => serviceNames.get(serviceId) || "Unavailable service").join(", ")}</dd></div><div><dt className="label">Barbers</dt><dd>{offer.allBarbers ? "All barbers" : offer.barberIds.map((barberId) => barberNames.get(barberId) || "Unavailable barber").join(", ")}</dd></div>{offer.minimumAmount > 0 && <div><dt className="label">Minimum booking</dt><dd>₹{offer.minimumAmount.toFixed(2)}</dd></div>}{offer.maximumDiscount != null && <div><dt className="label">Maximum discount</dt><dd>₹{offer.maximumDiscount.toFixed(2)}</dd></div>}{offer.usageLimit != null && <div><dt className="label">Total uses</dt><dd>Limited to {offer.usageLimit}</dd></div>}{offer.perCustomerLimit != null && <div><dt className="label">Per customer</dt><dd>{offer.perCustomerLimit} use(s)</dd></div>}</dl>{offer.terms && <div className="border-t border-khaki mt-4 pt-3"><p className="label">Terms and conditions</p><p className="text-sm whitespace-pre-wrap">{offer.terms}</p></div>}</div></article>)}</div>}
        </section>
      </div>}
    </article>
  );
}
