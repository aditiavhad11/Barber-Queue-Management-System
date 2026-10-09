import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Home,
  Search,
  Ticket,
  CalendarClock,
  CreditCard,
  Star,
  Bell,
  User,
  Settings,
  LogOut,
  MessageSquareWarning,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
const main = [
  ["/app", "Home", Home, true],
  ["/app/shops", "Find Shops", Search],
  ["/app/queue", "My Queue", Ticket],
  ["/app/bookings", "Bookings", CalendarClock],
  ["/app/payments", "Payments", CreditCard],
  ["/app/reviews", "Reviews", Star],
  ["/app/complaints", "Complaints", MessageSquareWarning],
  ["/app/notifications", "Notifications", Bell],
];
const Item = ({ to, label, Icon, end }) => (
  <NavLink
    to={to}
    end={end}
    className={({ isActive }) =>
      `flex items-center gap-3 px-6 py-2.5 text-sm ${isActive ? "bg-brass text-side font-medium" : "text-cream/80 hover:bg-sidehover hover:text-cream"}`
    }
  >
    <Icon size={18} />
    {label}
  </NavLink>
);
export default function CustomerLayout() {
  const nav = useNavigate();
  const { logout } = useAuth();
  const out = () => {
    logout();
    nav("/");
  };
  return (
    <div className="md:flex min-h-screen gap-0">
      <aside className="hidden md:flex flex-col w-64 shrink-0 bg-side py-8 sticky top-0 h-screen overflow-y-auto">
        <div className="font-serif text-2xl text-cream px-6 mb-10">
          Barber Queue
        </div>
        <nav className="flex-1">
          {main.map(([t, l, I, e]) => (
            <Item key={t} to={t} label={l} Icon={I} end={e} />
          ))}
        </nav>
        <Item to="/app/profile" label="Profile" Icon={User} />
        <Item to="/app/settings" label="Settings" Icon={Settings} />
        <button
          onClick={out}
          className="flex items-center gap-3 px-6 py-2.5 text-sm text-cream/80 hover:bg-sidehover hover:text-cream w-full"
        >
          <LogOut size={18} />
          Logout
        </button>
      </aside>
      <main className="flex-1 min-w-0 px-5 md:px-8 py-8 pb-28 md:pb-12">
        <div className="max-w-6xl">
          <Outlet />
        </div>
      </main>
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-side flex justify-around py-2 z-20">
        {[...main.slice(0, 4), ["/app/profile", "Profile", User]].map(
          ([t, l, I]) => (
            <NavLink
              key={t}
              to={t}
              end={t === "/app"}
              className={({ isActive }) =>
                `flex flex-col items-center text-[11px] gap-1 px-2 ${isActive ? "text-brass" : "text-cream/70"}`
              }
            >
              <I size={20} />
              {l}
            </NavLink>
          ),
        )}
      </nav>
    </div>
  );
}
