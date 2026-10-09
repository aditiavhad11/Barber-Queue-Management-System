import { useMemo, useState } from "react";
import { Plus, Store, Layers3 } from "lucide-react";
import { useOwner } from "../../hooks/useOwnerStore";
import { PageHead, Empty, Modal, Badge } from "../../components/common/ui";

export default function AllShopServices() {
  const { shops, owner, addServiceToAllShops } = useOwner();
  const mine = shops.filter((s) => s.ownerId === owner?.id);
  const [scope, setScope] = useState("all");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ name: "", price: "", duration: "" });

  const visibleShops = scope === "all" ? mine : mine.filter((s) => s.id === scope);
  const services = useMemo(() => {
    const map = new Map();
    visibleShops.forEach((shop) => (shop.servicesList || []).forEach((service) => {
      const key = service.name.trim().toLowerCase();
      const item = map.get(key) || { name: service.name, prices: new Set(), durations: new Set(), shops: [] };
      item.prices.add(Number(service.price));
      item.durations.add(Number(service.duration));
      item.shops.push(shop.name);
      map.set(key, item);
    }));
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [visibleShops]);

  const save = async () => {
    const name = form.name.trim();
    const price = Number(form.price);
    const duration = Number(form.duration);
    if (!name || !Number.isFinite(price) || price <= 0 || !Number.isFinite(duration) || duration <= 0) {
      setMessage("Enter a service name, positive price and positive duration.");
      return;
    }
    const targets = visibleShops;
    if (!targets.length) { setMessage("Create a shop first."); return; }
    setSaving(true); setMessage("");
    try {
      await addServiceToAllShops(targets.map((s) => s.id), { name, price, duration });
      setForm({ name: "", price: "", duration: "" });
      setOpen(false);
      setMessage(`“${name}” is now available in ${targets.length} shop${targets.length === 1 ? "" : "s"}. Existing copies were kept.`);
    } catch (e) { setMessage(e.message || "Could not add the service."); }
    finally { setSaving(false); }
  };

  return <div className="fade">
    <PageHead title="All Shop Services" sub="See the services across your shops and add one service to every selected shop at once." action={<button className="btn" onClick={() => { setMessage(""); setOpen(true); }}><Plus size={16}/>Add service to shops</button>} />
    <div className="service-manager border border-khaki p-5 md:p-6 mb-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="label">SHOP SCOPE</p><h2 className="font-serif text-2xl mt-1">Service catalogue</h2></div>
        <select className="input md:w-72" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="all">All my shops</option>
          {mine.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      {message && <p className="text-sm text-olive mt-4">{message}</p>}
    </div>
    {!mine.length ? <Empty title="No shops yet" text="Create a shop before managing shared services." /> : !services.length ? <Empty title="No services yet" text="Add your first service and choose all shops as the scope." action={<button className="btn mt-4" onClick={() => setOpen(true)}><Plus size={16}/>Add service</button>} /> :
      <div className="grid md:grid-cols-2 gap-5">{services.map((s) => <article key={s.name.toLowerCase()} className="border border-khaki p-5 rounded-md">
        <div className="flex items-start justify-between gap-3"><div><p className="font-serif text-2xl">{s.name}</p><p className="text-sm text-coffee/70 mt-1">{s.prices.size === 1 ? `₹${[...s.prices][0]}` : "Price varies"} · {s.durations.size === 1 ? `${[...s.durations][0]} min` : "Duration varies"}</p></div><Badge tone="ok">{s.shops.length} shop{s.shops.length === 1 ? "" : "s"}</Badge></div>
        <div className="flex flex-wrap gap-2 mt-4">{s.shops.map((name) => <span key={name} className="text-xs border border-khaki rounded-md px-2.5 py-1 inline-flex items-center gap-1"><Store size={12}/>{name}</span>)}</div>
      </article>)}</div>}

    {open && <Modal title="Add service to shops" onClose={() => !saving && setOpen(false)} actions={<button className="btn" disabled={saving} onClick={save}>{saving ? "Adding..." : "Add service"}</button>}>
      <div className="space-y-4">
        <div className="border border-brass/30 bg-brass/10 p-4 rounded-md"><div className="flex gap-2 items-center"><Layers3 size={16}/><b>{scope === "all" ? `All ${mine.length} of your shops` : visibleShops[0]?.name}</b></div><p className="text-sm text-coffee/70 mt-1">The service will be added to every shop in the selected scope. If a shop already has the same service name, it will not be duplicated.</p></div>
        <input className="input" placeholder="Service name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="input" type="number" min="0" step="1" placeholder="Price (₹)" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value === "" ? "" : Math.max(0, Number(e.target.value)) })} />
        <input className="input" type="number" min="1" step="1" placeholder="Duration (minutes)" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value === "" ? "" : Math.max(1, Number(e.target.value)) })} />
        {message && <p className="text-sm text-rose">{message}</p>}
      </div>
    </Modal>}
  </div>;
}
