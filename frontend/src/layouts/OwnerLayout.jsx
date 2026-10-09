import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, Link } from "react-router-dom";
import { LayoutDashboard, Store, FolderOpen, FileText, Images, MapPin, Clock, ScrollText, ListOrdered, Scissors, Tag, Users, CreditCard, Wallet, Star, Bell, Settings, LogOut, Menu, X, User, Layers3 } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useOwner } from "../hooks/useOwnerStore";
import { StatusBadge, Empty } from "../components/common/ui";
const groups = [
  [null, [["/owner", "Dashboard", LayoutDashboard, true], ["/owner/shops", "My Shops", FolderOpen]]],
  ["My Shop", [["/owner/shop", "Shop Overview", Store, true], ["/owner/shop/details", "Shop Details", FileText], ["/owner/shop/photos", "Photos", Images], ["/owner/shop/location", "Location", MapPin], ["/owner/shop/hours", "Opening Hours", Clock], ["/owner/shop/policies", "Policies", ScrollText]]],
  ["Operations", [["/owner/queue", "Queue", ListOrdered], ["/owner/barbers", "Barbers", Scissors], ["/owner/services", "Services", Tag], ["/owner/all-services", "All Shop Services", Layers3]]],
  ["Business", [["/owner/customers", "Customers", Users], ["/owner/payments", "Payments", CreditCard], ["/owner/earnings", "Earnings", Wallet], ["/owner/reviews", "Reviews", Star]]],
  [null, [["/owner/notifications", "Notifications", Bell]]],
];
const open_ok = ["/owner", "/owner/shops", "/owner/create-shop", "/owner/notifications", "/owner/settings", "/owner/profile", "/owner/all-services"];
export default function OwnerLayout() {
  const [drawer, setDrawer] = useState(false); const nav = useNavigate(); const { pathname } = useLocation(); const { logout } = useAuth(); const { shop, owner, notifications, shops, currentShopId, selectShop } = useOwner();
  const out = () => { logout(); nav("/"); };
  const label = shop ? ({ pending: "Pending", approved: "Approved", rejected: "Rejected", suspended: "Suspended" }[shop.status] || null) : null;
  const side = (
    <div className="flex flex-col h-full py-6 overflow-y-auto">
      <div className="font-serif text-2xl text-cream px-6 mb-1">Barber Queue</div><div className="label !text-brass px-6 mb-6">Owner</div>
      <nav className="flex-1">{groups.map(([h, items], i) => <div key={i} className="mb-4">{h && <div className="label !text-cream/50 px-6 mb-1">{h}</div>}{items.map(([to, l, I, end]) => <NavLink key={to} to={to} end={end} onClick={() => setDrawer(false)} className={({ isActive }) => `flex items-center gap-3 px-6 py-2 text-sm ${isActive ? "bg-brass text-side font-medium" : "text-cream/80 hover:bg-sidehover hover:text-cream"}`}><I size={16} />{l}</NavLink>)}</div>)}</nav>
      <NavLink to="/owner/settings" onClick={() => setDrawer(false)} className="flex items-center gap-3 px-6 py-2 text-sm text-cream/80 hover:bg-sidehover hover:text-cream"><Settings size={16} />Settings</NavLink>
      <button onClick={out} className="flex items-center gap-3 px-6 py-2 text-sm text-cream/80 hover:bg-sidehover hover:text-cream"><LogOut size={16} />Logout</button>
    </div>);
  const blocked = !shop && !open_ok.includes(pathname);
  return <div className="md:flex min-h-screen">
    <aside className="hidden md:block w-64 bg-side sticky top-0 h-screen shrink-0">{side}</aside>
    {drawer && <div className="md:hidden fixed inset-0 z-40 flex"><div className="w-72 bg-side">{side}</div><div className="flex-1 bg-black/70" onClick={() => setDrawer(false)} /></div>}
    <div className="flex-1 min-w-0">
      <header className="flex items-center justify-between gap-3 px-5 md:px-8 py-4 border-b border-khaki sticky top-0 bg-mist z-30">
        <div className="flex items-center gap-3"><button className="md:hidden" onClick={() => setDrawer(!drawer)} aria-label="Menu">{drawer ? <X /> : <Menu />}</button><div><div className="label">Current shop</div>{shops.filter((s) => s.ownerId === owner?.id).length > 0 ? <select className="bg-transparent border-0 p-0 pr-8 font-serif text-xl leading-tight focus:ring-0" value={currentShopId} onChange={(e) => selectShop(e.target.value)}>{shops.filter((s) => s.ownerId === owner?.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select> : <div className="font-serif text-xl leading-tight">No shop yet</div>}</div>{label && <StatusBadge s={label} />}</div>
        <div className="flex items-center gap-4"><Link to="/owner/notifications" className="relative" aria-label="Notifications"><Bell size={20} /><span className="absolute -top-1 -right-1 bg-brass text-[10px] text-[#1C1713] rounded-full w-4 h-4 grid place-items-center">{notifications.length}</span></Link><Link to="/owner/profile" className="flex items-center gap-2 text-sm"><span className="w-8 h-8 rounded-full bg-side text-cream grid place-items-center"><User size={16} /></span><span className="hidden md:inline">{owner?.name || "Owner"}</span></Link></div>
      </header>
      {shop?.status === "pending" && <div className="bg-brass/15 text-sm px-5 md:px-8 py-2">Your shop is pending admin approval and is not visible to customers yet.</div>}
      {shop?.status === "rejected" && <div className="bg-rose/15 text-rose text-sm px-5 md:px-8 py-2">Your shop was rejected. Open My Shops to review the Admin feedback and resubmit.</div>}
      {shop?.status === "suspended" && <div className="bg-rose/15 text-rose text-sm px-5 md:px-8 py-2">Your shop is suspended and hidden from customers. Contact support.</div>}
      <main className="px-5 md:px-8 py-8 pb-16 max-w-6xl fade">{blocked ? <Empty title="No shop created" text="Create your shop to use this section." action={<Link to="/owner/create-shop" className="btn mt-4">Create your shop</Link>} /> : <Outlet />}</main>
    </div></div>;
}
