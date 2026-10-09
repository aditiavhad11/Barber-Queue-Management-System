import { useState } from "react";
import { NavLink, Outlet, useNavigate, Link } from "react-router-dom";
import {
  LayoutDashboard,
  Store,
  FileText,
  Images,
  MapPin,
  Clock,
  ScrollText,
  ListOrdered,
  Scissors,
  Tag,
  Users,
  CreditCard,
  Wallet,
  Star,
  Bell,
  Settings,
  LogOut,
  Menu,
  X,
  User,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useOwner } from "../hooks/useOwnerStore";
import { StatusBadge, Empty } from "../components/common/ui";

const groups = [
  [null, [["/shop", "Dashboard", LayoutDashboard, true]]],
  [
    "Shop",
    [
      ["/shop/shop", "Shop Overview", Store, true],
      ["/shop/shop/details", "Shop Details", FileText],
      ["/shop/shop/photos", "Photos", Images],
      ["/shop/shop/location", "Location", MapPin],
      ["/shop/shop/hours", "Opening Hours", Clock],
      ["/shop/shop/policies", "Policies", ScrollText],
    ],
  ],
  [
    "Operations",
    [
      ["/shop/queue", "Queue", ListOrdered],
      ["/shop/barbers", "Barbers", Scissors],
      ["/shop/services", "Services", Tag],
    ],
  ],
  [
    "Business",
    [
      ["/shop/customers", "Customers", Users],
      ["/shop/payments", "Payments", CreditCard],
      ["/shop/earnings", "Earnings", Wallet],
      ["/shop/reviews", "Reviews", Star],
    ],
  ],
  [null, [["/shop/notifications", "Notifications", Bell]]],
];

export default function ShopLayout() {
  const [drawer, setDrawer] = useState(false);
  const nav = useNavigate();
  const { logout } = useAuth();
  const { shop, notifications } = useOwner();
  const out = () => {
    logout();
    nav("/");
  };
  const side = (
    <div className="flex flex-col h-full py-6 overflow-y-auto">
      <div className="font-serif text-2xl text-cream px-6 mb-1">
        Barber Queue
      </div>
      <div className="label !text-brass px-6 mb-6">Shop dashboard</div>
      <nav className="flex-1">
        {groups.map(([h, items], i) => (
          <div key={i} className="mb-4">
            {h && <div className="label !text-cream/50 px-6 mb-1">{h}</div>}
            {items.map(([to, l, I, end]) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={() => setDrawer(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-6 py-2 text-sm ${isActive ? "bg-brass text-side font-medium" : "text-cream/80 hover:bg-sidehover hover:text-cream"}`
                }
              >
                <I size={16} />
                {l}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <NavLink
        to="/shop/settings"
        onClick={() => setDrawer(false)}
        className="flex items-center gap-3 px-6 py-2 text-sm text-cream/80 hover:bg-sidehover hover:text-cream"
      >
        <Settings size={16} />
        Settings
      </NavLink>
      <button
        onClick={out}
        className="flex items-center gap-3 px-6 py-2 text-sm text-cream/80 hover:bg-sidehover hover:text-cream"
      >
        <LogOut size={16} />
        Logout
      </button>
    </div>
  );
  if (!shop)
    return (
      <Empty
        title="Shop session not found"
        text="Please sign in again with this shop's credentials."
        action={
          <Link to="/shop-sign-in" className="btn mt-4">
            Shop sign in
          </Link>
        }
      />
    );
  const label =
    {
      pending: "Pending",
      approved: "Approved",
      rejected: "Rejected",
      suspended: "Suspended",
    }[shop.status] || shop.status;
  const blocked = shop.status !== "approved";
  return (
    <div className="md:flex min-h-screen">
      <aside className="hidden md:block w-64 bg-side sticky top-0 h-screen shrink-0">
        {side}
      </aside>
      {drawer && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div className="w-72 bg-side">{side}</div>
          <div
            className="flex-1 bg-black/70"
            onClick={() => setDrawer(false)}
          />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <header className="flex items-center justify-between gap-3 px-5 md:px-8 py-4 border-b border-khaki sticky top-0 bg-mist z-30">
          <div className="flex items-center gap-3">
            <button
              className="md:hidden"
              onClick={() => setDrawer(!drawer)}
              aria-label="Menu"
            >
              {drawer ? <X /> : <Menu />}
            </button>
            <div>
              <div className="label">Signed in as shop</div>
              <div className="font-serif text-xl leading-tight">
                {shop.name}
              </div>
            </div>
            <StatusBadge s={label} />
          </div>
          <div className="flex items-center gap-4">
            <Link
              to="/shop/notifications"
              className="relative"
              aria-label="Notifications"
            >
              <Bell size={20} />
              <span className="absolute -top-1 -right-1 bg-brass text-[10px] text-[#1C1713] rounded-full w-4 h-4 grid place-items-center">
                {notifications.length}
              </span>
            </Link>
            <span className="w-8 h-8 rounded-full bg-side text-cream grid place-items-center">
              <User size={16} />
            </span>
          </div>
        </header>
        {shop.status === "pending" && (
          <div className="bg-brass/15 text-sm px-5 md:px-8 py-2">
            This shop is pending admin approval. Operational dashboard access
            will remain locked.
          </div>
        )}
        {shop.status === "suspended" && (
          <div className="bg-rose/15 text-rose text-sm px-5 md:px-8 py-2">
            This shop is suspended and operational access is locked.
          </div>
        )}
        <main className="px-5 md:px-8 py-8 pb-16 max-w-6xl fade">
          {blocked ? (
            <Empty
              title={`Shop ${label.toLowerCase()}`}
              text="This shop dashboard is unavailable until the shop is approved and active."
              action={
                <button className="btn mt-4" onClick={out}>
                  Sign out
                </button>
              }
            />
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
}
