import { useState } from "react";
import { Link } from "react-router-dom";
import { Clock, MapPin } from "lucide-react";
import { useOwner } from "../../hooks/useOwnerStore";
import {
  PageHead,
  StatusBadge,
  Rating,
  Empty,
  Modal,
} from "../../components/common/ui";
import PhotoUploader from "../../components/owner/PhotoUploader";
import LocationPicker from "../../components/owner/LocationPicker";
import { activeOf } from "../../utils/ownerEta";
import {
  scheduleOf,
  withSchedule,
  hoursFromSchedule,
  scheduleError,
} from "../../utils/closedDays";
import WeeklyHours from "../../components/owner/WeeklyHours";
import { to12Hour, from12Hour } from "../../utils/time";
const SaveBar = ({ dirty, onSave, onCancel, saved }) => (
  <div className="flex items-center gap-3 mt-6">
    <button className="btn" disabled={!dirty} onClick={onSave}>
      Save changes
    </button>
    <button className="btn-ghost" disabled={!dirty} onClick={onCancel}>
      Cancel
    </button>
    {saved && !dirty && <span className="text-sm text-olive">Saved</span>}
  </div>
);
export function Overview() {
  const { shop, services, barbers, queues, up, sessionRole } = useOwner();
  const base = sessionRole === "shop" ? "/shop" : "/owner";
  const prim = shop.photos.find((p) => p.primary) || shop.photos[0];
  return (
    <>
      <PageHead
        title="Shop overview"
        action={
          <div className="flex gap-2">
            <StatusBadge
              s={
                {
                  pending: "Pending",
                  approved: "Approved",
                  rejected: "Rejected",
                  suspended: "Suspended",
                }[shop.status]
              }
            />
            <StatusBadge s={shop.isOpen ? "Open" : "Closed"} />
          </div>
        }
      />
      {prim && (
        <img
          src={prim.url}
          alt=""
          className="w-full aspect-[21/9] object-cover rounded-md border border-khaki"
        />
      )}
      <div className="flex flex-wrap items-start justify-between gap-3 mt-5">
        <div>
          <h2 className="text-4xl">{shop.name}</h2>
          <p className="text-sm text-coffee/70 mt-1 flex flex-wrap gap-x-4">
            <span className="flex items-center gap-1">
              <MapPin size={14} />
              {shop.address}
            </span>
            <span className="flex items-center gap-1">
              <Clock size={14} />
              {shop.hours.open} - {shop.hours.close}
            </span>
            {shop.rating > 0 && <Rating v={shop.rating} />}
          </p>
        </div>
        {shop.status === "approved" && (
          <button
            className={shop.isOpen ? "btn-ghost" : "btn"}
            onClick={() => up("shop", (p) => ({ ...p, isOpen: !p.isOpen }))}
          >
            {shop.isOpen ? "Close shop" : "Open shop"}
          </button>
        )}
      </div>
      <p className="text-xs text-coffee/60 mt-2">
        Shop open/closed is separate from each barber's availability and each
        service's enabled state.
      </p>
      <div className="grid md:grid-cols-3 gap-5 mt-6 items-stretch">
        <div className="ov-card">
          <div className="label mb-3">Barbers</div>
          <div className="font-serif text-5xl">{barbers.length}</div>
        </div>
        <div className="ov-card">
          <div className="label mb-3">Services</div>
          {services.length ? (
            services.map((s) => (
              <div
                key={s.id}
                className="flex justify-between items-center text-sm py-2 border-b border-khaki last:border-0"
              >
                {s.name}
                <StatusBadge s={s.enabled ? "Enabled" : "Disabled"} />
              </div>
            ))
          ) : (
            <p className="text-sm text-coffee/60">No services yet.</p>
          )}
        </div>
        <div className="ov-card">
          <div className="label mb-3">Current queues</div>
          {barbers.length ? (
            barbers.map((b) => (
              <div
                key={b.id}
                className="flex justify-between items-center text-sm py-2 border-b border-khaki last:border-0"
              >
                {b.name}
                <span>{activeOf(queues[b.id]).length} waiting</span>
              </div>
            ))
          ) : (
            <p className="text-sm text-coffee/60">No barbers yet.</p>
          )}
        </div>
      </div>
      <Link
        to={`${base}/shop/details`}
        className="underline text-sm inline-block mt-8"
      >
        Edit shop details
      </Link>
    </>
  );
}
function useDraft(keys) {
  const { shop, up } = useOwner();
  const pick = () => Object.fromEntries(keys.map((k) => [k, shop[k]]));
  const [d, setD] = useState(pick);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(d) !== JSON.stringify(pick());
  const save = () => {
    up("shop", (p) => ({
      ...p,
      ...d,
      ...(p.status === "rejected" ? { status: "pending", rejection: "" } : {}),
    }));
    setSaved(true);
  };
  return {
    d,
    set: (k, v) => {
      setSaved(false);
      setD((p) => ({ ...p, [k]: v }));
    },
    dirty,
    save,
    cancel: () => setD(pick()),
    saved,
    shop,
  };
}
export function Details() {
  const x = useDraft(["name", "description", "contact", "address"]);
  return (
    <>
      <PageHead title="Shop details" sub="Changes only apply when you save." />
      <div className="max-w-xl space-y-3">
        {[
          ["name", "Shop name"],
          ["contact", "Contact number"],
          ["address", "Address"],
        ].map(([k, l]) => (
          <label key={k} className="block text-sm">
            {l}
            <input
              className="input"
              value={x.d[k]}
              onChange={(e) => x.set(k, e.target.value)}
            />
          </label>
        ))}
        <label className="block text-sm">
          Description
          <textarea
            rows={3}
            className="input"
            value={x.d.description}
            onChange={(e) => x.set("description", e.target.value)}
          />
        </label>
        <SaveBar
          dirty={x.dirty}
          onSave={x.save}
          onCancel={x.cancel}
          saved={x.saved}
        />
      </div>
    </>
  );
}
export function Photos() {
  const x = useDraft(["photos"]);
  const [showRejection, setShowRejection] = useState(false);
  return (
    <>
      <PageHead
        title="Photos"
        sub="At least one photo is required. The primary photo is shown first to customers."
      />
      {x.shop.status === "rejected" && (
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setShowRejection(true)}
          >
            View rejection reason
          </button>
          <span className="text-sm text-coffee/60">
            Saving changes will resubmit the shop for approval.
          </span>
        </div>
      )}
      <PhotoUploader
        photos={x.d.photos}
        onChange={(v) => x.set("photos", v)}
        error={x.d.photos.length ? "" : "At least one shop photo is required."}
      />
      <SaveBar
        dirty={x.dirty && x.d.photos.length > 0}
        onSave={x.save}
        onCancel={x.cancel}
        saved={x.saved}
      />
      {showRejection && (
        <Modal
          title="Admin rejection reason"
          onClose={() => setShowRejection(false)}
        >
          <div className="border border-rose/30 bg-rose/10 p-4 rounded-md text-rose whitespace-pre-wrap">
            {x.shop.rejection || "Admin requested changes before approval."}
          </div>
        </Modal>
      )}
    </>
  );
}
export function Location() {
  const x = useDraft(["address", "location"]);
  return (
    <>
      <PageHead
        title="Location"
        sub="The exact location customers use for directions."
      />
      <div className="max-w-xl">
        <LocationPicker
          address={x.d.address}
          onAddress={(v) => x.set("address", v)}
          location={x.d.location}
          onLocation={(v) => x.set("location", v)}
        />
        <SaveBar
          dirty={x.dirty && x.d.location?.confirmed}
          onSave={x.save}
          onCancel={x.cancel}
          saved={x.saved}
        />
      </div>
    </>
  );
}
export function Hours() {
  const x = useDraft(["hours", "availability"]);
  const schedule = scheduleOf({
    availability: x.d.availability,
    hours: x.d.hours,
  });
  const bad = scheduleError(schedule);
  const change = (next) => {
    x.set("availability", withSchedule(x.d.availability || {}, next));
    x.set("hours", hoursFromSchedule(next));
  };
  return (
    <>
      <PageHead
        title="Opening hours"
        sub="Set timings for each day. Tap Open/Closed to close the shop on a day."
      />
      <div className="max-w-3xl">
        <WeeklyHours schedule={schedule} onChange={change} error={bad} />
        <SaveBar
          dirty={x.dirty && !bad}
          onSave={x.save}
          onCancel={x.cancel}
          saved={x.saved}
        />
      </div>
    </>
  );
}
export function Policies() {
  const x = useDraft(["policy"]);
  const { shops, owner, applyPolicyToAllShops, sessionRole } = useOwner();
  const empty = Object.values(x.d.policy).some((v) => !v.trim());
  const mine = shops.filter((s) => s.ownerId === owner?.id);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const applyAll = async () => {
    setBusy(true);
    setMsg("");
    try {
      const n = await applyPolicyToAllShops(x.d.policy);
      setMsg(`These policies now apply to all ${n} of your shops.`);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHead
        title="Shop policies"
        sub="Customers must accept these before paying."
      />
      <div className="max-w-xl space-y-3">
        {Object.keys(x.d.policy).map((k) => (
          <label key={k} className="block text-sm">
            {k} policy
            <textarea
              rows={2}
              className="input"
              value={x.d.policy[k]}
              onChange={(e) =>
                x.set("policy", { ...x.d.policy, [k]: e.target.value })
              }
            />
          </label>
        ))}
        {empty && <p className="text-sm text-rose">All policies need text.</p>}
        <SaveBar
          dirty={x.dirty && !empty}
          onSave={x.save}
          onCancel={x.cancel}
          saved={x.saved}
        />
        {sessionRole === "owner" && mine.length > 1 && (
          <div className="pt-4 border-t border-khaki">
            <button
              type="button"
              className="btn-ghost"
              disabled={busy || empty}
              onClick={applyAll}
            >
              {busy
                ? "Applying..."
                : `Apply these policies to all my shops (${mine.length})`}
            </button>
            {msg && <p className="text-sm mt-2">{msg}</p>}
          </div>
        )}
      </div>
    </>
  );
}
