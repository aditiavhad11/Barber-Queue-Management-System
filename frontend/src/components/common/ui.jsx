import { useEffect } from "react";
import { Star } from "lucide-react";
export const Rating = ({ v }) => <span className="inline-flex items-center gap-1 text-sm"><Star size={14} className="text-brass fill-brass" />{v}</span>;
export const Badge = ({ tone = "ok", children }) => {
  const c = { ok: "bg-olive/15 text-olive", alert: "bg-rose/15 text-rose", warn: "bg-wine text-gold-light", info: "bg-ivory/10 text-ivory" }[tone];
  return <span className={`px-2 py-0.5 text-xs font-medium rounded-md ${c}`}>{children}</span>;
};
export const Empty = ({ title, text, action }) => <div className="border border-dashed border-khaki p-10 text-center rounded-md"><h3 className="text-2xl">{title}</h3><p className="mt-1 text-soft">{text}</p>{action}</div>;
export const Loader = () => <div className="py-20 text-center label">Loading</div>;
export const Modal = ({ title, children, onClose, actions }) => {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  return (
  <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/70 p-0 md:p-6" onClick={onClose}>
    <div className="bg-card w-full max-w-md border border-khaki p-6 fade max-h-[90vh] overflow-y-auto rounded-lg" onClick={(e) => e.stopPropagation()}>
      <h3 className="text-3xl mb-3">{title}</h3><div className="text-sm space-y-3">{children}</div>
      <div className="flex justify-end gap-3 mt-6"><button className="btn-ghost" onClick={onClose}>Close</button>{actions}</div>
    </div></div>
  );
};
export const PageHead = ({ title, sub, action }) => (
  <div className="flex flex-wrap items-end justify-between gap-3 mb-8"><div><h1 className="text-4xl md:text-5xl">{title}</h1>{sub && <p className="text-soft mt-1 max-w-xl">{sub}</p>}</div>{action}</div>
);
export const StatusBadge = ({ s }) => {
  const m = { Waiting: "info", "Your Turn": "warn", "In Service": "ok", Completed: "ok", Skipped: "warn", Cancelled: "alert", Available: "ok", "On Break": "warn", Unavailable: "alert", Successful: "ok", Failed: "alert", Refunded: "warn", Pending: "info", Approved: "ok", Rejected: "alert", Suspended: "alert", Enabled: "ok", Disabled: "alert", Open: "ok", Closed: "alert" };
  return <Badge tone={m[s] || "info"}>{s}</Badge>;
};
