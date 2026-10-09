import { Link } from "react-router-dom";
import { isShopOpenNow } from "../../utils/closedDays";
import { MapPin } from "lucide-react";
import { Rating, Badge } from "./ui";
import { fmtMin } from "../../utils/eta";
import { activeOf, etaFor } from "../../utils/ownerEta";
export default function ShopCard({ shop }) {
  const list = (shop.servicesList || shop.services || []).filter(Boolean).map((x) => typeof x === "object" ? x : null).filter(Boolean);
  const min = list.length ? Math.min(...list.map((s) => s.price)) : 0;
  const bs = shop.barbersList || [];
  const waits = bs.map((b) => etaFor(list, shop.queues?.[b.id] || [], activeOf(shop.queues?.[b.id] || []).length));
  const wait = waits.length ? Math.min(...waits) : 0;
  const n = bs.reduce((t, b) => t + activeOf(shop.queues?.[b.id] || []).length, 0);
  return <Link to={`/app/shops/${shop.id}`} className="group block h-full border border-khaki rounded-md overflow-hidden hover:border-coffee">
    <div className="aspect-[16/10] overflow-hidden bg-khaki"><img src={shop.image || shop.photos?.[0]?.url || "/img/shop-placeholder.svg"} alt={shop.name} loading="lazy" className={`w-full h-full object-cover ${isShopOpenNow(shop) ? "" : "grayscale"}`} /></div>
    <div className="p-5 h-full flex flex-col"><div className="flex justify-between items-start gap-2"><h3 className="text-2xl leading-tight">{shop.name}</h3><Rating v={shop.rating || "New"} /></div>
      <p className="text-sm text-coffee/70 mt-1 flex items-center gap-1"><MapPin size={14} />{shop.address} · {shop.distanceKm ?? "-"} km</p>
      <div className="flex flex-wrap gap-1.5 mt-3">{list.map((s) => <span key={s.id} className="text-xs border border-khaki rounded-md px-2 py-0.5">{s.name}</span>)}</div>
      <div className="flex justify-between items-center mt-auto pt-4 border-t border-khaki text-sm"><span>From ₹{min || "-"}</span><span className="text-coffee/70">{isShopOpenNow(shop) ? `${n} waiting · ~${fmtMin(wait)}` : ""}</span><Badge tone={isShopOpenNow(shop) ? "ok" : "alert"}>{isShopOpenNow(shop) ? "Open" : "Closed"}</Badge></div></div></Link>;
}
