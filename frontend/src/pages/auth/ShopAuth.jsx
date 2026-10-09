import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { useOwner } from "../../hooks/useOwnerStore";

export default function ShopAuth() {
  const nav = useNavigate();
  const { login } = useAuth();
  const { shops } = useOwner();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      if (import.meta.env.VITE_API_URL) {
        const res = await fetch(
          `${import.meta.env.VITE_API_URL.replace(/\/$/, "")}/auth/shop-login`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
          },
        );
        const data = await res.json();
        if (!res.ok)
          throw new Error(data.message || "Invalid shop credentials.");
        sessionStorage.setItem("token", data.token);
        sessionStorage.setItem("role", "shop");
        sessionStorage.setItem("shopId", data.user.shopId);
        sessionStorage.setItem("user", JSON.stringify(data.user));
        window.dispatchEvent(new Event("barber-auth-change"));
      } else {
        const shop = shops.find(
          (s) => s.loginEmail?.toLowerCase() === email.trim().toLowerCase(),
        );
        if (!shop || shop.loginPassword !== password)
          throw new Error("Invalid shop email or password.");
        if (shop.status !== "approved" || !shop.active)
          throw new Error(
            shop.status === "pending"
              ? "This shop is still pending admin approval."
              : shop.status === "rejected"
                ? "This shop was rejected. The owner must resubmit it."
                : "This shop is suspended and cannot be accessed.",
          );
        login("shop", shop.id, {
          id: shop.id,
          name: shop.name,
          role: "shop",
          shopId: shop.id,
          ownerId: shop.ownerId,
        });
      }
      nav("/shop");
    } catch (error) {
      setErr(error.message);
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
          <p className="label mb-2">Shop access</p>
          <h1 className="text-4xl mb-2">Shop sign in</h1>
          <p className="text-sm text-coffee/65 mb-6">
            Use the separate credentials created for this shop. You will only
            see this shop's dashboard.
          </p>
          <form onSubmit={submit} className="space-y-4">
            <input
              className="input"
              type="email"
              required
              placeholder="Shop email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="input"
              type="password"
              required
              placeholder="Shop password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {err && <p className="text-sm text-rose">{err}</p>}
            <button className="btn w-full" disabled={busy}>
              {busy ? "Signing in..." : "Sign in to shop"}
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
