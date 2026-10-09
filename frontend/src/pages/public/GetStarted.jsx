import { Link } from "react-router-dom";
import { User, Store, ShieldCheck, ArrowRight } from "lucide-react";

const roles = [
  ["customer", "Customer", "Find a barber and skip the wait", User, "/create-account?role=customer"],
  ["owner", "Shop Owner", "Manage your shop, barbers and queue", Store, "/create-account?role=owner"],
  ["admin", "Administrator", "Approve shops and manage the platform", ShieldCheck, "/sign-in?role=admin"],
];

export default function GetStarted() {
  return (
    <div className="min-h-screen px-6 md:px-16 py-10">
      <Link to="/" className="font-serif text-2xl">Barber Queue</Link>
      <div className="max-w-2xl mx-auto mt-16 fade">
        <p className="label">Get started</p>
        <h1 className="text-5xl mt-2 mb-10">How will you use Barber Queue?</h1>
        <div className="border-t border-khaki">
          {roles.map(([k, t, d, I, to]) => (
            <Link
              key={k}
              to={to}
              className="group flex items-center gap-5 py-6 border-b border-khaki"
            >
              <I className="text-gold" size={26} />
              <div className="flex-1">
                <div className="label !text-coffee">{t}</div>
                <div className="font-serif text-2xl">{d}</div>
              </div>
              <ArrowRight className="opacity-40 group-hover:opacity-100" />
            </Link>
          ))}
        </div>
        <p className="mt-8 text-sm">
          Already have an account? <Link to="/sign-in" className="underline">Sign In</Link>
        </p>
      </div>
    </div>
  );
}
