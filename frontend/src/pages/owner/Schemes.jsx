import { useEffect, useState } from "react";
import { ImagePlus, Pencil, Plus, Sparkles, X } from "lucide-react";
import { PageHead, StatusBadge } from "../../components/common/ui";
import { useOwner } from "../../hooks/useOwnerStore";
import { api } from "../../services/api";
import { ACCEPTED, MAX_MB, uploadImage } from "../../services/upload";

const emptyForm = () => ({
  title: "", description: "", imageUrl: "", terms: "", offerType: "discount", freeQuantity: 1, requiredQuantities: {}, rewardServiceId: "", discountType: "percentage", discountValue: "",
  startsAt: "", endsAt: "", allServices: true, serviceIds: [], allBarbers: true, barberIds: [],
  minimumAmount: "0", maximumDiscount: "", usageLimit: "", perCustomerLimit: "", promoCode: "", status: "draft",
});
const localInput = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const toApiDate = (value) => value ? new Date(value).toISOString() : "";
const dateLabel = (value) => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not scheduled";
const fromScheme = (scheme) => ({ ...scheme, allServices: scheme.offerType === "bogo" ? false : scheme.allServices, requiredQuantities: Object.fromEntries((scheme.serviceIds || []).map((id) => [id, scheme.requiredQuantities?.[id] || 1])), status: scheme.storedStatus || scheme.status, startsAt: localInput(scheme.startsAt), endsAt: localInput(scheme.endsAt) });
const validateOfferDates = (values, isNewOffer) => {
  const start = values.startsAt ? new Date(values.startsAt) : null;
  const end = values.endsAt ? new Date(values.endsAt) : null;
  const now = new Date();
  now.setSeconds(0, 0);
  if ((start && Number.isNaN(start.getTime())) || (end && Number.isNaN(end.getTime()))) return "Enter valid start and end dates.";
  if (start && end && end <= start) return "End date must be later than start date.";
  if (isNewOffer && start && start < now) return "Start date cannot be in the past for a new offer.";
  if (isNewOffer && end && end < now) return "End date cannot be in the past for a new offer.";
  return "";
};

export default function Schemes() {
  const { currentShopId, shop, services, barbers, shopsLoading } = useOwner();
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [dateError, setDateError] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!currentShopId) { setRows([]); return undefined; }
    setLoading(true);
    api.get(`/schemes/manage/${currentShopId}`, { toastOnError: false })
      .then(({ data }) => { if (!cancelled) { setRows(data || []); setError(""); } })
      .catch((e) => { if (!cancelled) setError(e.response?.data?.message || "Could not load offers."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentShopId]);

  const beginEdit = (scheme = null) => {
    setError(""); setMessage(""); setDateError(""); setEditingId(scheme?.id || null);
    setForm(scheme ? fromScheme(scheme) : emptyForm());
  };
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const setDate = (key, value) => {
    const next = { ...form, [key]: value };
    setForm(next);
    setDateError(validateOfferDates(next, !editingId));
  };
  const toggleId = (key, id) => setForm((prev) => {
    const removing = prev[key].includes(id);
    const next = { ...prev, [key]: removing ? prev[key].filter((item) => item !== id) : [...prev[key], id] };
    if (key === "serviceIds" && removing) {
      const requiredQuantities = { ...prev.requiredQuantities };
      delete requiredQuantities[id];
      next.requiredQuantities = requiredQuantities;
    } else if (key === "serviceIds" && prev.offerType === "bogo") {
      next.requiredQuantities = { ...prev.requiredQuantities, [id]: prev.requiredQuantities?.[id] || 1 };
    }
    return next;
  });

  const chooseImage = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) return setError("Choose a JPG, PNG, or WebP image.");
    if (file.size > MAX_MB * 1024 * 1024) return setError(`Choose an image smaller than ${MAX_MB} MB.`);
    setUploading(true); setError("");
    try {
      const image = await uploadImage(file, `barber-queue/shops/${currentShopId}/schemes`);
      set("imageUrl", image.url);
    } catch (e) {
      setError(e.response?.data?.message || e.message || "Image upload failed. Try again.");
    } finally { setUploading(false); }
  };

  const save = async (event) => {
    event.preventDefault();
    if (saving || uploading) return;
    const invalidDates = validateOfferDates(form, !editingId);
    setDateError(invalidDates);
    if (invalidDates) return;
    setSaving(true); setError(""); setMessage("");
    const body = {
      ...form, startsAt: toApiDate(form.startsAt), endsAt: toApiDate(form.endsAt),
      discountValue: Number(form.discountValue), minimumAmount: Number(form.minimumAmount || 0),
      maximumDiscount: form.maximumDiscount, usageLimit: form.usageLimit, perCustomerLimit: form.perCustomerLimit,
    };
    try {
      const { data } = editingId
        ? await api.patch(`/schemes/manage/${currentShopId}/${editingId}`, body, { toastOnError: false })
        : await api.post(`/schemes/manage/${currentShopId}`, body, { toastOnError: false });
      setRows((items) => [data.scheme, ...items.filter((item) => item.id !== data.scheme.id)]);
      setForm(null); setEditingId(null); setMessage("Offer saved.");
    } catch (e) {
      setError(e.response?.data?.message || "Could not save this offer.");
    } finally { setSaving(false); }
  };

  if (shopsLoading) return <p className="text-soft">Loading shop…</p>;
  if (!currentShopId || !shop) return <p className="text-soft">Select a shop to manage its offers.</p>;
  return (
    <div>
      <PageHead title="Schemes & Offers" sub={`Create and manage offers for ${shop.name}.`} action={
        !form && <button className="btn flex items-center gap-2" onClick={() => beginEdit()}><Plus size={16} /> New offer</button>
      } />
      {message && <p className="border border-olive/30 bg-olive/10 p-3 mb-4 text-sm" role="status">{message}</p>}
      {error && !form && <p className="border border-rose/30 bg-rose/10 p-3 mb-4 text-sm text-rose" role="alert">{error}</p>}

      {form && <form className="border border-khaki bg-card p-5 md:p-7 mb-8 space-y-5" onSubmit={save}>
        <div className="flex justify-between items-center"><h2 className="font-serif text-3xl">{editingId ? "Edit offer" : "New offer"}</h2><button type="button" className="btn-ghost" onClick={() => { setForm(null); setError(""); }} aria-label="Close form"><X size={18} /></button></div>
        {error && <p className="text-rose text-sm" role="alert">{error}</p>}
        <div className="grid md:grid-cols-2 gap-4">
          <label className="block"><span className="label">Offer title</span><input className="input mt-1" maxLength={120} required value={form.title} onChange={(e) => set("title", e.target.value)} /></label>
          <label className="block"><span className="label">Status</span><select className="input mt-1" value={form.status} onChange={(e) => set("status", e.target.value)}><option value="draft">Draft</option><option value="active">Active / Scheduled</option><option value="paused">Paused</option></select></label>
        </div>
        <label className="block"><span className="label">Description</span><textarea className="input mt-1 min-h-24" maxLength={2000} required value={form.description} onChange={(e) => set("description", e.target.value)} /></label>
        <div className="grid md:grid-cols-2 gap-4 items-start">
          <div>
            <span className="label">Offer banner</span>
            {form.imageUrl && <div className="mt-2 relative"><img src={form.imageUrl} alt="Offer preview" className="w-full max-h-52 object-cover border border-khaki" /><button type="button" className="absolute top-2 right-2 bg-card border border-khaki p-2 rounded" onClick={() => set("imageUrl", "")} aria-label="Remove offer image"><X size={16} /></button></div>}
            <label className="btn-ghost mt-2 inline-flex items-center gap-2 cursor-pointer"><ImagePlus size={16} />{uploading ? "Uploading…" : form.imageUrl ? "Replace image" : "Upload image"}<input type="file" className="sr-only" accept={ACCEPTED.join(",")} onChange={chooseImage} disabled={uploading} /></label>
            <p className="text-xs text-soft mt-1">JPG, PNG, or WebP · up to {MAX_MB} MB</p>
          </div>
          <div className="border border-khaki p-4"><p className="label">Offer preview</p>{form.imageUrl && <img src={form.imageUrl} alt="" className="w-full h-24 object-cover mt-2" />}<h3 className="font-serif text-2xl mt-2">{form.title || "Your offer title"}</h3><p className="text-sm mt-1">{form.description || "The offer description will appear here."}</p><p className="text-sm font-medium mt-2">{form.offerType === "bogo" ? `Required services · Get ${form.freeQuantity} free ${services.find((service) => String(service.id) === String(form.rewardServiceId))?.name || "service"}` : `${form.discountValue || "—"}${form.discountType === "percentage" ? "% off" : " rupees off"}`}</p></div>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <label className="block"><span className="label">Offer type</span><select className="input mt-1" value={form.offerType || "discount"} onChange={(e) => { set("offerType", e.target.value); if (e.target.value === "bogo") set("allServices", false); }}><option value="discount">Discount</option><option value="bogo">Buy services, get a free service</option></select></label>
          {form.offerType === "bogo" ? <label className="block"><span className="label">Free service quantity per qualifying set</span><input className="input mt-1" type="number" min="1" max="100" step="1" required value={form.freeQuantity ?? 1} onChange={(e) => set("freeQuantity", e.target.value)} /></label> : <><label className="block"><span className="label">Discount type</span><select className="input mt-1" value={form.discountType} onChange={(e) => set("discountType", e.target.value)}><option value="percentage">Percentage (%)</option><option value="fixed">Fixed amount (₹)</option></select></label><label className="block"><span className="label">Discount value</span><input className="input mt-1" type="number" min="0.01" max={form.discountType === "percentage" ? "100" : undefined} step="0.01" required value={form.discountValue} onChange={(e) => set("discountValue", e.target.value)} /></label></>}
          <label className="block"><span className="label">Starts at</span><input className="input mt-1" type="datetime-local" value={form.startsAt} onChange={(e) => setDate("startsAt", e.target.value)} /></label>
          <label className="block"><span className="label">Ends at</span><input className="input mt-1" type="datetime-local" value={form.endsAt} onChange={(e) => setDate("endsAt", e.target.value)} /></label>
          {dateError && <p className="text-rose text-sm md:col-span-2" role="alert">{dateError}</p>}
        </div>
        <fieldset className="space-y-3"><legend className="label mb-2">{form.offerType === "bogo" ? "Required purchased services" : "Applicable services"}</legend>{form.offerType !== "bogo" && <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.allServices} onChange={(e) => set("allServices", e.target.checked)} />All shop services</label>}{(form.offerType === "bogo" || !form.allServices) && <div className="grid sm:grid-cols-2 gap-2">{services.filter((s) => s.enabled !== false).map((service) => { const sid = String(service.id); const checked = form.serviceIds.includes(sid); return <label key={sid} className="flex flex-wrap items-center gap-2 text-sm border border-khaki p-2"><input type="checkbox" checked={checked} onChange={() => toggleId("serviceIds", sid)} />{service.name} · ₹{Number(service.price).toFixed(2)}{form.offerType === "bogo" && checked && <span className="ml-auto">Qty <input className="input w-20 !py-1" type="number" min="1" max="20" step="1" value={form.requiredQuantities?.[sid] ?? 1} onChange={(e) => set("requiredQuantities", { ...form.requiredQuantities, [sid]: e.target.value })} /></span>}</label>; })}</div>}{form.offerType === "bogo" && <label className="block max-w-sm"><span className="label">Free reward service</span><select className="input mt-1" required value={form.rewardServiceId || ""} onChange={(e) => set("rewardServiceId", e.target.value)}><option value="">Select the free service</option>{services.filter((s) => s.enabled !== false).map((service) => <option key={service.id} value={String(service.id)}>{service.name} · ₹{Number(service.price).toFixed(2)}</option>)}</select></label>}</fieldset>
        <fieldset className="space-y-3"><legend className="label mb-2">Barber restrictions</legend><label className="flex gap-2 text-sm"><input type="checkbox" checked={form.allBarbers} onChange={(e) => set("allBarbers", e.target.checked)} />All barbers</label>{!form.allBarbers && <div className="grid sm:grid-cols-2 gap-2">{barbers.map((barber) => <label key={barber.id} className="flex gap-2 text-sm border border-khaki p-2"><input type="checkbox" checked={form.barberIds.includes(String(barber.id))} onChange={() => toggleId("barberIds", String(barber.id))} />{barber.name}</label>)}</div>}</fieldset>
        <div className="grid md:grid-cols-2 gap-4">
          <label className="block"><span className="label">Minimum booking amount (₹)</span><input className="input mt-1" type="number" min="0" step="0.01" value={form.minimumAmount} onChange={(e) => set("minimumAmount", e.target.value)} /></label>
          <label className="block"><span className="label">Maximum discount (₹, optional)</span><input className="input mt-1" type="number" min="0" step="0.01" value={form.maximumDiscount} onChange={(e) => set("maximumDiscount", e.target.value)} /></label>
          <label className="block"><span className="label">Total uses limit (optional)</span><input className="input mt-1" type="number" min="1" step="1" value={form.usageLimit} onChange={(e) => set("usageLimit", e.target.value)} /></label>
          <label className="block"><span className="label">Uses per customer (optional)</span><input className="input mt-1" type="number" min="1" step="1" value={form.perCustomerLimit} onChange={(e) => set("perCustomerLimit", e.target.value)} /></label>
          <label className="block md:col-span-2"><span className="label">Promo code (optional)</span><input className="input mt-1 uppercase" maxLength={32} value={form.promoCode} onChange={(e) => set("promoCode", e.target.value.toUpperCase())} placeholder="Leave empty to apply automatically when eligible" /></label>
          <label className="block md:col-span-2"><span className="label">Terms and conditions (optional)</span><textarea className="input mt-1 min-h-20" maxLength={4000} value={form.terms} onChange={(e) => set("terms", e.target.value)} /></label>
        </div>
        <div className="flex flex-wrap gap-3"><button className="btn" disabled={saving || uploading}>{saving ? "Saving…" : editingId ? "Save changes" : "Save offer"}</button><button type="button" className="btn-ghost" disabled={saving} onClick={() => { setForm(null); setError(""); }}>Cancel</button></div>
      </form>}

      {loading ? <p className="text-soft py-8">Loading offers…</p> : rows.length === 0 ? <div className="border border-dashed border-khaki p-10 text-center rounded-md"><Sparkles className="mx-auto mb-3 text-brass" /><h2 className="font-serif text-2xl">No offers yet</h2><p className="text-soft mt-1">Create a scheme to share an offer with your customers.</p></div> : <div className="grid md:grid-cols-2 gap-4">{rows.map((scheme) => <article key={scheme.id} className="border border-khaki bg-card rounded-md overflow-hidden">{scheme.imageUrl && <img src={scheme.imageUrl} alt="" className="w-full h-40 object-cover" />}<div className="p-5"><div className="flex justify-between gap-3"><h2 className="font-serif text-2xl">{scheme.title}</h2><StatusBadge s={scheme.status[0].toUpperCase() + scheme.status.slice(1)} /></div><p className="text-sm mt-2">{scheme.description}</p><p className="font-medium mt-3">{scheme.offerType === "bogo" ? `Buy ${scheme.serviceIds.map((serviceId) => `${scheme.requiredQuantities?.[serviceId] || 1} × ${services.find((service) => String(service.id) === String(serviceId))?.name || "service"}`).join(" + ")} · Get ${scheme.freeQuantity} × ${services.find((service) => String(service.id) === String(scheme.rewardServiceId))?.name || "service"} free` : scheme.discountType === "percentage" ? `${scheme.discountValue}% off` : `₹${scheme.discountValue.toFixed(2)} off`}{scheme.promoCode && ` · Code ${scheme.promoCode}`}</p><p className="text-xs text-soft mt-2">{dateLabel(scheme.startsAt)} – {dateLabel(scheme.endsAt)}</p><p className="text-xs text-soft mt-1">{scheme.allServices ? "All services" : `${scheme.serviceIds.length} selected services`} · {scheme.allBarbers ? "All barbers" : `${scheme.barberIds.length} selected barbers`}</p><div className="flex gap-2 mt-4"><button className="btn-ghost flex items-center gap-2" onClick={() => beginEdit(scheme)}><Pencil size={14} /> Edit</button>{scheme.storedStatus !== "draft" && <button className="btn-ghost" onClick={async () => { const status = scheme.storedStatus === "paused" ? "active" : "paused"; try { const { data } = await api.patch(`/schemes/manage/${currentShopId}/${scheme.id}`, { ...scheme, startsAt: toApiDate(localInput(scheme.startsAt)), endsAt: toApiDate(localInput(scheme.endsAt)), status }, { toastOnError: false }); setRows((items) => items.map((item) => item.id === scheme.id ? data.scheme : item)); } catch (e) { setError(e.response?.data?.message || "Could not update offer status."); } }}>{scheme.storedStatus === "paused" ? "Reactivate" : "Pause"}</button>}</div></div></article>)}</div>}
    </div>
  );
}
