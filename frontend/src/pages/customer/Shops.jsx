import { useEffect, useMemo, useState } from "react";
import { Search, MapPinOff } from "lucide-react";
import ShopCard from "../../components/common/ShopCard";
import { Empty } from "../../components/common/ui";
import { useOwner } from "../../hooks/useOwnerStore";
import { distanceKm, getCurrentLocation } from "../../utils/location";
import { isShopOpenNow } from "../../utils/closedDays";

export default function Shops() {
  const { shops } = useOwner();
  const [f, setF] = useState({ q: "", dist: 0, min: "", max: "", rating: 0, open: false, svc: "" });
  const [userLoc, setUserLoc] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("customerLocation") || "null");
    } catch {
      return null;
    }
  });
  const [loc, setLoc] = useState(true);
  const [visibleCount, setVisibleCount] = useState(12);

  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    getCurrentLocation()
      .then((user) => {
        setLoc(true);
        setUserLoc(user);
        localStorage.setItem("customerLocation", JSON.stringify(user));
      })
      .catch(() => setLoc(false));
  }, []);

  const withDistance = shops.map((s) => ({
    ...s,
    distanceKm: (() => {
      try {
        if (!userLoc || !s.location) return null;
        const distance = distanceKm(userLoc, s.location);
        return Number.isFinite(distance) ? distance : null;
      } catch {
        return null;
      }
    })(),
  }));

  const serviceOptions = useMemo(
    () => [...new Map(shops.flatMap((s) => s.servicesList || []).map((s) => [s.id, s])).values()],
    [shops],
  );

  const rows = withDistance
    .filter((s) => s.status === "approved" && s.active)
    .filter((s) => {
      const list = s.servicesList || [];
      const prices = list.map((x) => Number(x.price)).filter((x) => Number.isFinite(x));
      const matchesDistance =
        !f.dist ||
        (s.distanceKm !== null && s.distanceKm !== undefined && s.distanceKm <= Number(f.dist));

      return (
        s.name.toLowerCase().includes(f.q.toLowerCase()) &&
        matchesDistance &&
        (s.rating ?? 0) >= f.rating &&
        (!f.open || isShopOpenNow(s)) &&
        (!f.svc || list.some((x) => x.id === f.svc)) &&
        (!f.min || (prices.length && Math.max(...prices) >= Number(f.min))) &&
        (!f.max || (prices.length && Math.min(...prices) <= Number(f.max)))
      );
    });

  const showMoreMode = rows.length >= 50;
  const displayedRows = showMoreMode ? rows.slice(0, visibleCount) : rows;

  return (
    <div className="fade">
      <h1 className="text-5xl mb-6">Find a shop</h1>

      {!loc && (
        <div className="border border-rose text-rose p-3 mb-4 text-sm flex gap-2 items-center">
          <MapPinOff size={16} />
          Location permission is off. Distances are approximate.
        </div>
      )}

      <div className="relative mb-4">
        <Search size={18} className="absolute left-4 top-3.5 text-coffee/50" />
        <input
          className="input pl-11"
          placeholder="Search shops"
          value={f.q}
          onChange={(e) => set("q", e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-8 text-sm">
        <select className="input min-w-0" value={f.dist} onChange={(e) => set("dist", Number(e.target.value))}>
          <option value={0}>Any distance</option>
          {[1, 1.5, 2, 2.5, 3, 4, 5].map((d) => (
            <option key={d} value={d}>Within {d} km</option>
          ))}
        </select>

        <select className="input" value={f.svc} onChange={(e) => set("svc", e.target.value)}>
          <option value="">Any service</option>
          {serviceOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <select className="input" value={f.rating} onChange={(e) => set("rating", Number(e.target.value))}>
          <option value={0}>Any rating</option>
          <option value={4}>4.0+</option>
          <option value={4.5}>4.5+</option>
        </select>

        <input
          className="input"
          type="number"
          min="0"
          placeholder="Min ₹"
          value={f.min}
          onChange={(e) => set("min", e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))}
        />

        <input
          className="input"
          type="number"
          min="0"
          placeholder="Max ₹"
          value={f.max}
          onChange={(e) => set("max", e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))}
        />

        <label className="flex items-center gap-2">
          <input type="checkbox" className="accent-[#B39A6A]" checked={f.open} onChange={(e) => set("open", e.target.checked)} />
          Open now
        </label>
      </div>

      {rows.length === 0 ? (
        <Empty
          title="No shops found"
          text="Only admin-approved shops are visible to customers. Try widening distance or budget."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-6">
            {displayedRows.map((s) => <ShopCard key={s.id} shop={s} />)}
          </div>

          {showMoreMode && displayedRows.length < rows.length && (
            <div className="flex justify-center mt-8">
              <button className="btn" onClick={() => setVisibleCount((n) => n + 12)}>
                Show more
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
