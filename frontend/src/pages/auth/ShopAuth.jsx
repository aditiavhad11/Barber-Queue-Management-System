import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { notifyError, notifySuccess } from "../../utils/toast";
import { isValidEmail } from "../../utils/validators";

export default function ShopAuth() {
  const nav = useNavigate();
  const { loginWithShop } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!isValidEmail(email)) {
      notifyError("Enter a valid email address.");
      return;
    }
    if (!password) {
      notifyError("Enter your password.");
      return;
    }
    setBusy(true);
    try {
      await loginWithShop({ email, password });
      notifySuccess("Signed in to the shop dashboard.");
      nav("/shop");
    } catch (error) {
      notifyError(error.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="min-h-screen grid md:grid-cols-2">
      <div className="hidden md:block bg-card relative">
        <img
          src="https://images.unsplash.com/photo-1585747860715-2ba37e788b70?auto=format&fit=crop&w=1000&q=70"
          className="absolute inset-0 w-full h-full object-cover opacity-50"
          alt=""
        />
        <Link
          to="/"
          className="relative font-serif text-3xl text-cream p-10 block"
        >
          Barber Queue
        </Link>
      </div>
      <div className="flex items-center px-6 md:px-16 py-12">
        <div className="w-full max-w-sm fade">
          <p className="label mb-2">Shop & Manager Access</p>
          <h1 className="text-4xl mb-2">Shop Sign In</h1>
          <p className="text-sm text-coffee/65 mb-6">
            Sign in as a shop manager, assigned co-owner, or using shop credentials to manage this branch's operations.
          </p>
          <form onSubmit={submit} className="space-y-4">
            <input
              className="input"
              type="email"
              required
              placeholder="Shop or Co-Owner email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <div className="relative">
              <input
                className="input pr-10"
                type={showPwd ? "text" : "password"}
                required
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-coffee/50 hover:text-coffee transition-colors"
                onClick={() => setShowPwd((v) => !v)}
                tabIndex={-1}
                aria-label={showPwd ? "Hide password" : "Show password"}
              >
                {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <button className="btn w-full" disabled={busy}>
              {busy ? "Signing in..." : "Sign in to shop dashboard"}
            </button>
          </form>
          <p className="mt-6 text-sm">
            <Link className="underline" to="/sign-in">
              Owner/customer sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
