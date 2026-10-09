import { useState } from "react";
import {
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  Link,
} from "react-router-dom";
import {
  LayoutDashboard,
  Store,
  Users,
  Scissors,
  CreditCard,
  RotateCcw,
  MessageSquareWarning,
  Star,
  Bell,
  ShieldCheck,
  Settings,
  LogOut,
  Menu,
  X,
  UserCheck,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";

const groups = [
  [
    null,
    [
      ["/admin", "Dashboard", LayoutDashboard, true],
      ["/admin/approvals", "Shop Approvals", UserCheck],
      ["/admin/shops", "All Shops", Store],
    ],
  ],
  [
    "People",
    [
      ["/admin/owners", "Owners", Users],
      ["/admin/customers", "Customers", Users],
      ["/admin/barbers", "Barbers", Scissors],
    ],
  ],
  [
    "Commerce",
    [
      ["/admin/payments", "Payments", CreditCard],
      ["/admin/refunds", "Refunds", RotateCcw],
    ],
  ],
  [
    "Trust & engagement",
    [
      ["/admin/complaints", "Complaints", MessageSquareWarning],
      ["/admin/reviews", "Reviews", Star],
      ["/admin/notifications", "Notifications", Bell],
    ],
  ],
  [
    "System",
    [
      ["/admin/security", "Security", ShieldCheck],
      ["/admin/settings", "Settings", Settings],
    ],
  ],
];

export default function AdminLayout() {
  const [drawer, setDrawer] = useState(false);
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { logout } = useAuth();
  const out = () => {
    logout();
    nav("/");
  };
  const side = (
    <div className="flex flex-col h-full py-6 overflow-y-auto">
      <div className="font-serif text-2xl text-cream px-6 mb-1">
        Barber Queue
      </div>
      <div className="label !text-brass px-6 mb-6">Administrator</div>
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
      <button
        onClick={out}
        className="flex items-center gap-3 px-6 py-2 text-sm text-cream/80 hover:bg-sidehover hover:text-cream"
      >
        <LogOut size={16} />
        Logout
      </button>
    </div>
  );
  return (
    <div className="md:flex min-h-screen">
      <aside className="hidden md:block w-64 bg-side sticky top-0 h-screen">
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
        <header className="flex items-center justify-between px-5 md:px-8 py-4 border-b border-khaki sticky top-0 bg-mist z-30">
          <div className="flex items-center gap-3">
            <button
              className="md:hidden"
              onClick={() => setDrawer(!drawer)}
              aria-label="Menu"
            >
              {drawer ? <X /> : <Menu />}
            </button>
            <div>
              <div className="label">Platform administration</div>
              <div className="font-serif text-xl">Control Center</div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="w-8 h-8 rounded-full bg-side text-cream grid place-items-center">
              <ShieldCheck size={16} />
            </span>
            <span className="hidden md:inline">Admin</span>
          </div>
        </header>
        <main className="px-5 md:px-8 py-8 pb-16 max-w-7xl fade">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
