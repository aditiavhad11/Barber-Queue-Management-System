import { useState } from "react";
import { Link } from "react-router-dom";
import { MessageSquareWarning } from "lucide-react";
import { useOwner } from "../../hooks/useOwnerStore";
import { Empty, Rating, Badge } from "../../components/common/ui";

export default function CustomerReviews() {
  const { completedCustomerVisits, addReview } = useOwner();
  const [drafts, setDrafts] = useState({});
  const [saved, setSaved] = useState({});
  const [submitting, setSubmitting] = useState({});
  const [errors, setErrors] = useState({});

  if (!completedCustomerVisits.length) {
    return <div className="fade"><h1 className="text-5xl mb-6">Reviews</h1><Empty title="No completed visits yet" text="Complete a service and you can review your visit here." /></div>;
  }

  const getExisting = (visit) => visit.shop.reviewsList?.find((r) => r.queueId === visit.entry.id);
  const updateDraft = (id, patch) => setDrafts((p) => ({ ...p, [id]: { rating: 5, text: "", ...(p[id] || {}), ...patch } }));

  return <div className="fade">
    <h1 className="text-5xl mb-2">Reviews</h1>
    <p className="text-coffee/70 mb-8">Share your experience after a completed visit.</p>
    <div className="space-y-5">
      {completedCustomerVisits.map((visit) => {
        const existing = getExisting(visit);
        const draft = drafts[visit.entry.id] || { rating: 5, text: "" };
        return <section key={visit.entry.id} className="border border-khaki p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-serif text-2xl">{visit.shop.name}</h2>
              <p className="text-sm text-coffee/70">{visit.service?.name || "Service"} with {visit.barber?.name || "Barber"}</p>
            </div>
            <Badge tone="ok">Completed</Badge>
          </div>
          {existing ? <div className="mt-5 border-t border-khaki pt-5">{saved[visit.entry.id] && <p className="text-sm text-olive mb-3">Review submitted successfully.</p>}<p className="label">Your review</p><Rating v={existing.rating} /><p className="mt-2">{existing.text}</p></div> : <div className="mt-5 border-t border-khaki pt-5">
            <p className="label">Rate your visit</p>
            <div className="flex gap-2 my-3">{[1,2,3,4,5].map((n) => <button type="button" key={n} onClick={() => updateDraft(visit.entry.id, { rating: n })} className={`text-2xl ${n <= draft.rating ? "text-brass" : "text-khaki"}`}>★</button>)}</div>
            <textarea className="input" rows={3} placeholder="How was your visit?" value={draft.text} onChange={(e) => updateDraft(visit.entry.id, { text: e.target.value })} />
            <div className="flex flex-wrap gap-3 mt-3"><button className="btn" disabled={submitting[visit.entry.id]} onClick={async () => {
              setSubmitting((p) => ({ ...p, [visit.entry.id]: true }));
              setErrors((p) => ({ ...p, [visit.entry.id]: "" }));
              let ok = false;
              try { ok = await addReview({ shopId: visit.shop.id, queueId: visit.entry.id, rating: draft.rating, text: draft.text }); } catch { ok = false; }
              setSubmitting((p) => ({ ...p, [visit.entry.id]: false }));
              if (ok) { setSaved((p) => ({ ...p, [visit.entry.id]: true })); }
              else { setErrors((p) => ({ ...p, [visit.entry.id]: "This review could not be submitted. Please refresh and try again." })); }
            }}>{submitting[visit.entry.id] ? "Submitting..." : "Submit review"}</button><Link className="btn-ghost" to={`/app/complaints?shopId=${encodeURIComponent(visit.shop.id)}&queueId=${encodeURIComponent(visit.entry.id)}`}><MessageSquareWarning size={16}/>Report an issue instead</Link></div>
                        {errors[visit.entry.id] && <p className="text-sm text-rose mt-3">{errors[visit.entry.id]}</p>}
          </div>}
        </section>;
      })}
    </div>
  </div>;
}
