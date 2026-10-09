import { useState } from "react";
import { useOwner } from "../../hooks/useOwnerStore";
import { PageHead, StatusBadge, Empty, Rating } from "../../components/common/ui";
import UpiSettings from "../../components/owner/UpiSettings";
const Row = ({ cols, head }) => <div className={`grid grid-cols-2 md:grid-cols-[repeat(auto-fit,minmax(0,1fr))] gap-x-4 gap-y-1 py-3 border-b border-khaki text-sm ${head ? "hidden md:grid label" : ""}`}>{cols.map((c, i) => <div key={i}>{c}</div>)}</div>;
export function Payments() {
  const { payments, currentShopId, deletePayment } = useOwner();
  const [deleting, setDeleting] = useState("");
  const [f, setF] = useState("All");
  const rows = payments.filter((p) => f === "All" || p.status === f);
  return <><PageHead title="Payments" sub="Customers pay using your original UPI QR. You confirm each submitted payment from the Queue." />
    <UpiSettings shopId={currentShopId} />
    <div className="flex gap-4 mb-4 text-sm flex-wrap">{["All", "Successful", "Cancelled", "Refunded"].map((s) => <button key={s} onClick={() => setF(s)} className={f === s ? "border-b-2 border-brass" : "text-coffee/60"}>{s}</button>)}</div>
    {!rows.length ? <Empty title="No payments" text="Accepted payments will appear here." /> : <><Row head cols={["Transaction", "Customer", "Service", "Barber", "Amount", "Date / time", "Status"]} />{rows.map((p) => <Row key={p.id} cols={[p.id, p.customer, p.service, p.barber, "₹" + p.amount, `${p.date}, ${p.time}`, <div className="flex items-center gap-3"><StatusBadge s={p.status} />{(p.queueStatus === "Completed" || p.status === "Cancelled") && <button type="button" className="text-rose underline text-xs" disabled={deleting === p.id} onClick={async () => { if (!window.confirm("Delete this completed/cancelled payment record?")) return; setDeleting(p.id); try { await deletePayment(p); } catch (e) { window.alert(e.message); } finally { setDeleting(""); } }}>{deleting === p.id ? "Deleting..." : "Delete"}</button>}</div>]} />)}</>}
  </>;
}
export function Customers() {
  const { payments } = useOwner();
  return <><PageHead title="Customers" sub="Only what is needed to run your shop. Contact details are not shown." />
    {!payments.length ? <Empty title="No customers" text="Customers appear after their first booking." /> : <><Row head cols={["Customer", "Service", "Barber", "Date", "Amount", "Status"]} />{payments.map((p) => <Row key={p.id} cols={[p.customer, p.service, p.barber, p.date, "₹" + p.amount, <StatusBadge s={p.status === "Successful" ? "Completed" : p.status} />]} />)}</>}</>;
}
export function Earnings() {
  const { payments } = useOwner();
  const ok = payments.filter((p) => p.status === "Successful");
  const days = {};
  ok.forEach((p) => {
    days[p.date] = days[p.date] || { total: 0, n: 0 };
    days[p.date].total += Number(p.amount) || 0;
    days[p.date].n++;
  });
  const todayKey = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const today = days[todayKey] || { total: 0, n: 0 };
  return <><PageHead title="Earnings" sub="Successful payments only. Refunded, failed and cancelled payments are excluded." />
    <dl className="grid grid-cols-2 border-y border-khaki divide-x divide-khaki mb-10"><div className="p-5"><dt className="label">Today's earnings</dt><dd className="font-serif text-4xl">₹{today.total.toFixed(2)}</dd></div><div className="p-5"><dt className="label">Completed services today</dt><dd className="font-serif text-4xl">{today.n}</dd></div></dl>
    <h2 className="text-2xl mb-2">Recent earnings</h2><Row head cols={["Date", "Services", "Earned"]} />{Object.entries(days).map(([d, v]) => <Row key={d} cols={[d, v.n, "₹" + v.total.toFixed(2)]} />)}</>;
}
export function Reviews() {
  const { reviews } = useOwner();
  return <><PageHead title="Reviews" />{!reviews.length ? <Empty title="No reviews" text="Reviews appear after customers complete a service." /> : reviews.map((r) => <div key={r.id} className="py-4 border-b border-khaki"><div className="flex justify-between"><span><b>{r.customer}</b> <Rating v={r.rating} /></span><span className="text-xs text-coffee/60">{r.date}</span></div><p className="text-sm text-coffee/70">{r.service} with {r.barber}</p><p className="mt-1">{r.text}</p></div>)}</>;
}
