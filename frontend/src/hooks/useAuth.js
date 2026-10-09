const AUTH_EVENT = "barber-auth-change";
const ACCOUNTS_KEY = "barberQueueAccounts:v4";
const OTP_KEY = "barberQueueOtp:v4";

const notify = () => window.dispatchEvent(new Event(AUTH_EVENT));
const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const idFor = (email) => `user-${email.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
const apiBase = () => (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");

async function apiRequest(path, options = {}) {
  const base = apiBase();
  if (!base) return null;
  const res = await fetch(`${base}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || "Request failed.");
  return body;
}

const SESSION_KEYS = ["token", "role", "shopId", "user", "ownerCurrentShopId"];
export const clearSession = () => {
  SESSION_KEYS.forEach((k) => { sessionStorage.removeItem(k); localStorage.removeItem(k); });
  notify();
};
const readSessionUser = () => {
  try { return JSON.parse(sessionStorage.getItem("user") || "null"); } catch { return null; }
};
// A real JWT carries its expiry. Mock tokens (offline mode) have no dots and never expire.
const tokenValid = () => {
  const t = sessionStorage.getItem("token");
  if (!t) return false;
  const parts = t.split(".");
  if (parts.length !== 3) return true;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return !payload.exp || payload.exp * 1000 > Date.now();
  } catch { return false; }
};

const saveSession = (result) => {
  sessionStorage.setItem("token", result.token);
  sessionStorage.setItem("role", result.user.role);
  sessionStorage.removeItem("shopId");
  if (result.user.role === "owner") sessionStorage.removeItem("ownerCurrentShopId");
  sessionStorage.setItem("user", JSON.stringify(result.user));
  notify();
  return result.user;
};

export const useAuth = () => ({
  isAuthed: tokenValid(),
  role: sessionStorage.getItem("role") || "customer",
  shopId: sessionStorage.getItem("shopId") || null,
  user: readSessionUser(),

  requestOtp: async ({
    email,
    role = "customer",
    name = "",
    password = "",
    intent = "signin",
  }) => {
    const clean = email.trim().toLowerCase();

    if (apiBase()) {
      return apiRequest("/auth/request-otp", {
        method: "POST",
        body: JSON.stringify({
          email: clean,
          role,
          name: name.trim(),
          password,
          intent,
        }),
      });
    }

    const accounts = read(ACCOUNTS_KEY, []);
    const existing = accounts.find((a) => a.email === clean);

    if (role !== "admin" && existing && existing.role !== role) {
      throw new Error("This email is already registered for another account type.");
    }
    if ((intent === "signin" || intent === "forgot") && !existing && role !== "admin") {
      throw new Error("No account found. Create an account first.");
    }
    if (intent === "create" && existing) {
      throw new Error("An account already exists for this email. Sign in instead.");
    }
    if (intent === "create" && password.length < 8) {
      throw new Error("Password must be at least 8 characters.");
    }
    if (role === "admin" && import.meta.env.VITE_ADMIN_EMAIL && clean !== import.meta.env.VITE_ADMIN_EMAIL.trim().toLowerCase()) {
      throw new Error("This email is not configured for admin access.");
    }

    const devOtp = import.meta.env.VITE_DEV_OTP || "123456";
    write(OTP_KEY, {
      email: clean,
      role,
      intent,
      name: name.trim(),
      password,
      otp: devOtp,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    return { ok: true, devOtp: import.meta.env.DEV ? devOtp : undefined };
  },

  verifyOtp: async ({
    email,
    otp,
    role = "customer",
    name = "",
    password = "",
  }) => {
    const clean = email.trim().toLowerCase();

    if (apiBase()) {
      const result = await apiRequest("/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify({
          email: clean,
          code: otp,
          role,
          name: name.trim(),
          password,
        }),
      });
      return saveSession(result);
    }

    const pending = read(OTP_KEY, null);
    if (!pending || pending.email !== clean || pending.role !== role) {
      throw new Error("Request a new OTP for this email.");
    }
    if (Date.now() > pending.expiresAt) {
      throw new Error("This code has expired. Request a new one.");
    }
    if (otp !== pending.otp) {
      throw new Error("That code is not correct. Please try again.");
    }

    const accounts = read(ACCOUNTS_KEY, []);
    let account = accounts.find((a) => a.email === clean);

    if (role === "admin" && import.meta.env.VITE_ADMIN_EMAIL && clean !== import.meta.env.VITE_ADMIN_EMAIL.trim().toLowerCase()) {
      throw new Error("This email is not configured for admin access.");
    }

    if (!account) {
      if (pending.intent !== "create" && role !== "admin") {
        throw new Error("No account found. Create an account first.");
      }
      account = {
        id: idFor(clean),
        name: name.trim() || clean.split("@")[0],
        email: clean,
        role,
        password: pending.password || password,
      };
      write(ACCOUNTS_KEY, [...accounts, account]);
    } else if (account.role !== role) {
      throw new Error("This account belongs to a different role.");
    }

    sessionStorage.setItem("token", `mock-${account.id}`);
    sessionStorage.setItem("role", account.role);
    sessionStorage.removeItem("shopId");

    if (account.role === "owner") {
      const existingShop = (() => {
        try {
          const raw = localStorage.getItem("barberQueuePlatform:v12");
          const data = raw ? JSON.parse(raw) : null;
          return data?.shops?.find((s) => s.ownerId === account.id)?.id || null;
        } catch {
          return null;
        }
      })();
      if (existingShop) sessionStorage.setItem("ownerCurrentShopId", existingShop);
      else sessionStorage.removeItem("ownerCurrentShopId");
    }

    sessionStorage.setItem("user", JSON.stringify(account));
    localStorage.removeItem(OTP_KEY);
    notify();
    return account;
  },

  loginWithPassword: async ({ email, password, role = "customer" }) => {
    const clean = email.trim().toLowerCase();

    if (apiBase()) {
      const result = await apiRequest("/auth/login-password", {
        method: "POST",
        body: JSON.stringify({ email: clean, password, role }),
      });
      return saveSession(result);
    }

    const accounts = read(ACCOUNTS_KEY, []);
    const account = accounts.find((a) => a.email === clean);

    if (!account) throw new Error("No account found with this email.");
    if (account.role !== role) throw new Error("This account belongs to a different role.");
    if (!account.password) throw new Error("Password login is not set up for this account. Please sign in using OTP.");
    if (account.password !== password) throw new Error("Incorrect email or password.");

    sessionStorage.setItem("token", `mock-${account.id}`);
    sessionStorage.setItem("role", account.role);
    sessionStorage.removeItem("shopId");
    sessionStorage.setItem("user", JSON.stringify(account));
    notify();
    return account;
  },

  login: (role = "customer", shopId = null, user = null) => {
    sessionStorage.setItem("token", `mock-${user?.id || role}`);
    sessionStorage.setItem("role", role);
    if (shopId) sessionStorage.setItem("shopId", shopId);
    else sessionStorage.removeItem("shopId");
    if (user) sessionStorage.setItem("user", JSON.stringify(user));
    notify();
  },

  logout: () => clearSession(),
});

export const getAccounts = () => read(ACCOUNTS_KEY, []);
