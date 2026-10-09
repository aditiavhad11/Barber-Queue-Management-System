import { Link } from "react-router-dom";
import { Search, Ticket, Star } from "lucide-react";
import ShopCard from "../../components/common/ShopCard";
import LiveWait from "../../components/common/LiveWait";
import { useOwner } from "../../hooks/useOwnerStore";
import { activeOf, etaFor } from "../../utils/ownerEta";
import { fmtMin } from "../../utils/eta";
const DONE = ["Cancelled", "Completed", "Skipped", "No Show"];
export default function Home() {
  const { shops, customerQueue } = useOwner();
  const live = shops.filter((s) => s.status === "approved" && s.active);
  const q = customerQueue;
  const showQ = q && !DONE.includes(q.entry.status);
  const active = q ? activeOf(q.shop.queues?.[q.barberId] || []) : [];
  const index = q ? active.findIndex((e) => e.id === q.entry.id) : -1;
  const wait =
    q && q.entry.status === "Waiting"
      ? etaFor(q.shop.servicesList, q.shop.queues?.[q.barberId] || [], index)
      : 0;
  const available = live
    .flatMap((s) =>
      (s.barbersList || [])
        .filter((b) => b.status === "Available")
        .map((b) => ({
          s,
          b,
          wait: etaFor(
            s.servicesList,
            s.queues?.[b.id] || [],
            activeOf(s.queues?.[b.id] || []).length,
          ),
        })),
    )
    .sort((a, b) => a.wait - b.wait)
    .slice(0, 3);
  const actions = [
    ["/app/shops", "Find a barber", Search],
    ["/app/queue", "My queue", Ticket],
    ["/app/reviews", "Reviews", Star],
  ];
  return (
    <div className="fade">
      {showQ && (
        <Link
          to="/app/queue"
          className="block bg-side text-cream p-6 md:p-8 rounded-md border border-brass"
        >
          <p className="label !text-brass">Your active queue</p>
          <div className="flex flex-wrap items-end justify-between gap-4 mt-2">
            <div>
              <div className="font-serif text-5xl">#{q.entry.token}</div>
              <p className="text-cream/70 text-sm mt-1">
                {q.shop.name} · {q.service.name} with {q.barber.name}
              </p>
            </div>
            <div className="text-right">
              <div className="font-serif text-3xl">
                {Math.max(index, 0)} ahead
              </div>
              <p className="text-cream/70 text-sm mt-1">
                {q.entry.status === "Waiting" ? (
                  <>
                    About <LiveWait id={q.entry.id} minutes={wait} />
                  </>
                ) : (
                  q.entry.status
                )}
              </p>
            </div>
          </div>
        </Link>
      )}
      <div className={`grid grid-cols-3 gap-3 ${showQ ? "mt-6" : ""}`}>
        {actions.map(([to, l, I]) => (
          <Link
            key={to}
            to={to}
            className="bg-card border border-khaki rounded-md p-4 flex flex-col items-center gap-2 text-sm text-center hover:border-gold"
          >
            <I size={20} />
            {l}
          </Link>
        ))}
      </div>
      <h2 className="text-3xl mt-10 mb-5">Nearby shops</h2>
      {live.length ? (
        <div className="grid grid-cols-2 gap-6">
          {live.slice(0, 4).map((s) => (
            <ShopCard key={s.id} shop={s} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-coffee/60">No shops available yet.</p>
      )}
      <h2 className="text-3xl mt-12 mb-5">Barbers with the shortest wait</h2>
      <div className="border-t border-khaki">
        {available.map(({ s, b, wait }) => (
          <Link
            key={b.id}
            to={`/app/shops/${s.id}`}
            className="flex items-center gap-4 py-4 border-b border-khaki"
          >
            <img
              src={b.photo || ""}
              alt=""
              className="w-12 h-12 object-cover rounded-full bg-khaki"
            />
            <div className="flex-1 min-w-0">
              <div className="font-medium">{b.name}</div>
              <div className="text-sm text-coffee/70 truncate">
                {b.specialization} · {s.name}
              </div>
            </div>
            <span className="text-sm">{fmtMin(wait)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
