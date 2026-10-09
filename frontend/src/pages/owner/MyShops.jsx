import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Plus, MapPin, Clock, Trash2, MessageSquareText } from "lucide-react";
import { useOwner } from "../../hooks/useOwnerStore";
import { PageHead, StatusBadge, Empty, Modal } from "../../components/common/ui";

export default function MyShops() {
  const nav = useNavigate(); const { shops, owner, currentShopId, selectShop, deleteShop, shopsLoading, shopLoadError } = useOwner();
  const [reasonShop, setReasonShop] = useState(null);
  const mine = shops.filter((s) => s.ownerId === owner?.id);
  const openShop = (id, path = "/owner/shop") => { selectShop(id); nav(path); };
  const removeShop = (shop) => {
    const ok = window.confirm(`Delete "${shop.name}"? This removes the shop and its mock operational data from this Owner account.`);
    if (!ok) return;
    deleteShop(shop.id);
    if (currentShopId === shop.id) nav("/owner/shops");
  };
  if (shopsLoading) return <><PageHead title="My Shops" sub="Loading your shops from the database..." /><div className="border border-khaki p-8"><p>Please wait...</p></div></>;
  if (shopLoadError) return <><PageHead title="My Shops" sub="Could not load shop data." /><div className="border border-rose p-8"><p className="text-rose">{shopLoadError}</p><button className="btn mt-4" onClick={() => window.location.reload()}>Retry</button></div></>;
  return <><PageHead title="My Shops" sub="Manage every shop owned by this account. Each shop has its own operational dashboard and credentials." action={<Link to="/owner/create-shop" className="btn"><Plus size={16}/>Add New Shop</Link>} />
    {!mine.length ? <Empty title="No shops yet" text="Add your first shop and submit it for admin approval." action={<Link to="/owner/create-shop" className="btn mt-4">Add New Shop</Link>} />
    : <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">{mine.map((s) => <div key={s.id} className="border border-khaki p-5">
      <img src={s.image || s.photos?.[0]?.url || "/img/shop-placeholder.svg"} alt="" className="w-full aspect-[16/7] object-cover mb-4 rounded-md"/>
      <div className="flex justify-between gap-3"><div><h2 className="text-2xl">{s.name}</h2><p className="text-sm text-coffee/60 mt-1">{s.description}</p></div><StatusBadge s={{pending:"Pending",approved:"Approved",rejected:"Rejected",suspended:"Suspended"}[s.status] || "Pending"}/></div>
      <div className="text-sm text-coffee/70 space-y-1 mt-4"><p className="flex gap-2 items-center"><MapPin size={14}/>{s.address || "Address not added"}</p><p className="flex gap-2 items-center"><Clock size={14}/>{typeof s.hours === "string" ? s.hours : `${s.hours?.open || ""} - ${s.hours?.close || ""}`}</p><p><span className="label">Shop login</span> {s.loginEmail || "Not configured"}</p></div>
      <div className="flex flex-wrap gap-3 mt-5">{currentShopId === s.id ? <span className="btn-ghost opacity-60">Selected shop</span> : <button className="btn" onClick={() => openShop(s.id)}>{s.status === "approved" ? "Switch to this shop" : "Select this shop"}</button>}{s.status === "rejected" ? <><button className="btn-ghost" onClick={() => setReasonShop(s)}><MessageSquareText size={15}/>View rejection reason</button><button className="btn" onClick={() => openShop(s.id, "/owner/shop/details")}>Edit & resubmit</button></> : <button className="btn-ghost" onClick={() => openShop(s.id)}>{s.status === "approved" ? "Manage shop" : "View submission"}</button>}<button type="button" className="btn-ghost text-rose" onClick={() => removeShop(s)}><Trash2 size={15}/>Delete shop</button></div>
    </div>)}</div>}
    {reasonShop && <Modal title="Admin rejection reason" onClose={() => setReasonShop(null)}><div className="space-y-3"><p className="text-sm text-coffee/70">{reasonShop.name}</p><div className="border border-rose/30 bg-rose/10 p-4 rounded-md text-rose whitespace-pre-wrap">{reasonShop.rejection || "Admin requested changes before approval."}</div><p className="text-sm text-coffee/70">Edit the requested details and resubmit the shop for approval.</p></div></Modal>}
  </>;
}
