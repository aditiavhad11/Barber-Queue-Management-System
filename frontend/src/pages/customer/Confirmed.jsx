import { Link, useLocation, Navigate } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { useOwner } from "../../hooks/useOwnerStore";
import LiveWait from "../../components/common/LiveWait";
import { activeOf, etaFor } from "../../utils/ownerEta";
export default function Confirmed() {
  const { state } = useLocation(); const { customerQueue } = useOwner(); if (!state && !customerQueue) return <Navigate to="/app" />;
  const q = customerQueue; if (!q) return <Navigate to="/app/queue" />;
  const active = activeOf(q.shop.queues?.[q.barberId] || []), index = active.findIndex((e) => e.id === q.entry.id), wait = q.entry.status === "In Service" || q.entry.status === "Your Turn" ? 0 : etaFor(q.shop.servicesList, q.shop.queues?.[q.barberId] || [], Math.max(index, 0));
  return <div className="fade max-w-xl mx-auto bg-side text-cream p-8 md:p-12 text-center"><CheckCircle2 className="mx-auto text-brass" size={36} /><p className="label !text-brass mt-3">Queue joined</p><div className="font-serif text-8xl my-2">#{q.entry.token}</div><p className="text-cream/70">{Math.max(index, 0)} customers ahead · Position {Math.max(index, 0) + 1}</p>
    <dl className="grid grid-cols-2 gap-6 text-left mt-10 pt-8 border-t border-cream/20 text-sm">{[["Shop", q.shop.name],["Barber", q.barber.name],["Service", `${q.service.name} · ${q.service.duration} min`],["Payment", `${q.entry.paymentStatus || "Successful"} · ${q.entry.paymentAmount ? `₹${q.entry.paymentAmount}` : ""}`],["Status", q.entry.status],["Estimated wait", wait ? <LiveWait id={q.entry.id} minutes={wait} /> : "Now"]].map(([k,v])=><div key={k}><dt className="label !text-cream/60">{k}</dt><dd className="font-serif text-2xl">{v}</dd></div>)}</dl><Link to="/app/queue" className="btn mt-10">Track my queue</Link></div>;
}
