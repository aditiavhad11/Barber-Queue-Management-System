import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";

const EMAIL_REGEX =
  /^[A-Z0-9.!#$%&'+\/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

export default function Auth({ mode }) {
  const nav = useNavigate();
  const auth = useAuth();
  const [q] = useSearchParams();
  const requestedRole = q.get("role");
  const role = ["owner", "admin"].includes(requestedRole)
    ? requestedRole
    : "customer";
  const isAdmin = role === "admin";

  const [step, setStep] = useState("form");
  const [loginMethod, setLoginMethod] = useState("password");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [devOtp, setDevOtp] = useState("");

  useEffect(() => {
    if (isAdmin && mode === "signin") setLoginMethod("otp");
  }, [isAdmin, mode]);

  const titles = {
    signin: "Sign in",
    create: "Create your account",
    forgot: "Forgot password",
    reset: "Reset password",
  };

  const sendOtp = async (e) => {
    e?.preventDefault();
    setErr("");
    if (!EMAIL_REGEX.test(email.trim())) {
      setErr("Enter a valid email address.");
      return;
    }
    setBusy(true);

    try {
      const result = await auth.requestOtp({
        email,
        role,
        name,
        password,
        intent: mode,
      });

      setDevOtp(result?.devOtp || "");
      setStep("otp");
      setSent(true);
      setTimeout(() => setSent(false), 2500);
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  };

  const loginWithPassword = async (e) => {
    e.preventDefault();
    setErr("");
    if (!EMAIL_REGEX.test(email.trim())) {
      setErr("Enter a valid email address.");
      return;
    }
    setBusy(true);

    try {
      const account = await auth.loginWithPassword({
        email,
        password,
        role,
      });

      nav(
        account.role === "owner"
          ? "/owner"
          : account.role === "admin"
            ? "/admin"
            : "/app",
      );
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);

    try {
      if (mode === "forgot") {
        await auth.verifyOtp({ email, otp, role });
        nav("/reset-password");
        return;
      }

      const account = await auth.verifyOtp({
        email,
        otp,
        role,
        name,
        password,
      });

      nav(
        account.role === "owner"
          ? "/owner"
          : account.role === "admin"
            ? "/admin"
            : "/app",
      );
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  };

  const passwordForm = (
    <form onSubmit={loginWithPassword} className="space-y-4 mt-6">
      <input
        type="email"
        required
        pattern="^[A-Za-z0-9.!#$%&'+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          setErr("");
        }}
        placeholder="Email address"
        className="input"
      />

      <input
        type="password"
        required
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          setErr("");
        }}
        placeholder="Password"
        className="input"
      />

      {err && <p className="text-sm text-rose">{err}</p>}

      <button className="btn w-full" disabled={busy}>
        {busy ? "Signing in..." : "Sign in"}
      </button>

      <button
        type="button"
        onClick={() => {
          setLoginMethod("otp");
          setErr("");
        }}
        className="text-sm underline"
      >
        Sign in with OTP instead
      </button>

      <Link to="/forgot-password" className="block text-sm underline">
        Forgot password?
      </Link>
    </form>
  );

  const otpLoginForm = (
    <form onSubmit={sendOtp} className="space-y-4 mt-6">
      <input
        type="email"
        required
        pattern="^[A-Za-z0-9.!#$%&'+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          setErr("");
        }}
        placeholder="Email address"
        className="input"
      />

      {err && <p className="text-sm text-rose">{err}</p>}

      <button className="btn w-full" disabled={busy}>
        {busy ? "Sending..." : "Send OTP"}
      </button>

      <button
        type="button"
        onClick={() => {
          setLoginMethod("password");
          setErr("");
        }}
        className="text-sm underline"
      >
        Sign in with password instead
      </button>
    </form>
  );

  const createForm = (
    <form onSubmit={sendOtp} className="space-y-4 mt-6">
      <input
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Full name"
        className="input"
      />

      <input
        type="email"
        required
        pattern="^[A-Za-z0-9.!#$%&'+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          setErr("");
        }}
        placeholder="Email address"
        className="input"
      />

      <input
        type="password"
        required
        minLength={8}
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          setErr("");
        }}
        placeholder="Create password (min 8 characters)"
        className="input"
      />

      {err && <p className="text-sm text-rose">{err}</p>}

      <button className="btn w-full" disabled={busy}>
        {busy ? "Sending..." : "Send OTP"}
      </button>
    </form>
  );

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
          <h1 className="text-4xl mb-1">{titles[mode]}</h1>

          {(mode === "create" || role !== "customer") && (
            <p className="label mb-6">{role} account</p>
          )}

          {mode === "reset" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                nav("/sign-in");
              }}
              className="space-y-4 mt-6"
            >
              <input
                type="password"
                required
                minLength={8}
                placeholder="New password"
                className="input"
              />
              <input
                type="password"
                required
                placeholder="Confirm password"
                className="input"
              />
              <button className="btn w-full">Reset password</button>
            </form>
          ) : mode === "create" && step === "form" ? (
            createForm
          ) : mode === "signin" && step === "form" ? (
            <>
              {isAdmin ? (
                otpLoginForm
              ) : (
                <>
                  <div className="flex gap-2 mt-6">
                    <button
                      type="button"
                      onClick={() => {
                        setLoginMethod("password");
                        setErr("");
                      }}
                      className={`flex-1 py-2 border ${
                        loginMethod === "password"
                          ? "bg-olive text-[#F4EDE3]"
                          : ""
                      }`}
                    >
                      Password
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setLoginMethod("otp");
                        setErr("");
                      }}
                      className={`flex-1 py-2 border ${
                        loginMethod === "otp" ? "bg-olive text-[#F4EDE3]" : ""
                      }`}
                    >
                      OTP
                    </button>
                  </div>
                  {loginMethod === "password" ? passwordForm : otpLoginForm}
                </>
              )}
            </>
          ) : step === "form" ? (
            <form onSubmit={sendOtp} className="space-y-4 mt-6">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setErr("");
                }}
                placeholder="Email address"
                className="input"
              />
              {err && <p className="text-sm text-rose">{err}</p>}
              <button className="btn w-full" disabled={busy}>
                {busy ? "Sending..." : "Send OTP"}
              </button>
            </form>
          ) : (
            <form onSubmit={verify} className="space-y-4 mt-6">
              <p className="text-sm text-coffee/70">
                We sent a 6-digit code to {email}.
              </p>

              {devOtp && (
                <p className="text-sm text-olive">
                  Development OTP: <b>{devOtp}</b>
                </p>
              )}

              <input
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => {
                  setOtp(e.target.value.replace(/\D/g, ""));
                  setErr("");
                }}
                placeholder="Enter code"
                className={`input tracking-[.5em] text-center text-xl ${
                  err ? "!border-rose" : ""
                }`}
              />

              {err && <p className="text-sm text-rose">{err}</p>}
              {sent && (
                <p className="text-sm text-olive">A new code has been sent.</p>
              )}

              <button className="btn w-full" disabled={busy || otp.length < 6}>
                {busy ? "Verifying..." : "Verify"}
              </button>

              <button
                type="button"
                onClick={sendOtp}
                className="text-sm underline"
              >
                Resend OTP
              </button>
            </form>
          )}

          {mode === "signin" && (
            <p className="mt-6 text-sm">
              {role === "owner" ? (
                <>
                  <Link className="underline" to="/sign-in">
                    Customer sign in
                  </Link>
                  <span className="mx-2">·</span>
                  <Link className="underline" to="/shop-sign-in">
                    Shop login
                  </Link>
                </>
              ) : role === "admin" ? (
                <Link className="underline" to="/sign-in">
                  Customer sign in
                </Link>
              ) : (
                <>
                  <Link className="underline" to="/sign-in?role=owner">
                    Shop owner? Sign in here
                  </Link>
                  <span className="mx-2">·</span>
                  <Link className="underline" to="/sign-in?role=admin">
                    Admin
                  </Link>
                  <span className="mx-2">·</span>
                  <Link className="underline" to="/shop-sign-in">
                    Shop login
                  </Link>
                </>
              )}
            </p>
          )}

          <p className="mt-4 text-sm">
            {mode === "create" ? (
              <>
                Have an account?{" "}
                <Link
                  className="underline"
                  to={`/sign-in${role !== "customer" ? `?role=${role}` : ""}`}
                >
                  Sign in
                </Link>
              </>
            ) : (
              <>
                New here?{" "}
                <Link className="underline" to="/get-started">
                  Create account
                </Link>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
