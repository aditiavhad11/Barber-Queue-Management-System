const AUTH_EVENT = "barber-auth-change";

const notify = () => window.dispatchEvent(new Event(AUTH_EVENT));
const apiBase = () =>
  (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");

async function apiRequest(path, options = {}) {
  const base = apiBase();
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
  SESSION_KEYS.forEach((k) => {
    sessionStorage.removeItem(k);
    localStorage.removeItem(k);
  });
  notify();
};
const readSessionUser = () => {
  try {
    return JSON.parse(sessionStorage.getItem("user") || "null");
  } catch {
    return null;
  }
};
const tokenValid = () => {
  const t = sessionStorage.getItem("token");
  if (!t) return false;
  const parts = t.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    return !payload.exp || payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
};

const saveSession = (result) => {
  sessionStorage.setItem("token", result.token);
  sessionStorage.setItem("role", result.user.role);
  sessionStorage.removeItem("shopId");
  if (result.user.role === "owner")
    sessionStorage.removeItem("ownerCurrentShopId");
  sessionStorage.setItem("user", JSON.stringify(result.user));
  notify();
  return result.user;
};

export const useAuth = () => ({
  isAuthed: tokenValid(),
  role: sessionStorage.getItem("role") || "customer",
  shopId: sessionStorage.getItem("shopId") || null,
  user: readSessionUser(),

  requestOtp: async ({ email, role = "customer", name = "", password = "", intent = "signin" }) => {
    const clean = email.trim().toLowerCase();
    return apiRequest("/auth/request-otp", {
      method: "POST",
      body: JSON.stringify({ email: clean, role, name: name.trim(), password, intent }),
    });
  },

  verifyOtp: async ({
    email,
    otp,
    role = "customer",
    name = "",
    password = "",
    intent = "signin",
  }) => {
    const clean = email.trim().toLowerCase();

    const result = await apiRequest("/auth/verify-otp", {
      method: "POST",
      body: JSON.stringify({ email: clean, code: otp, role, name: name.trim(), password, intent }),
    });
    if (intent === "forgot") return result;
    return saveSession(result);
  },
  resetPassword: async ({ email, role = "customer", code, password }) => {
    return apiRequest("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({
        email: email.trim().toLowerCase(),
        role,
        code,
        password,
      }),
    });
  },

  loginWithPassword: async ({ email, password, role = "customer" }) => {
    const clean = email.trim().toLowerCase();

    const result = await apiRequest("/auth/login-password", {
      method: "POST",
      body: JSON.stringify({ email: clean, password, role }),
    });
    return saveSession(result);
  },

  loginWithShop: async ({ email, password }) => {
    const result = await apiRequest("/auth/shop-login", {
      method: "POST",
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
    });
    const user = saveSession(result);
    if (user.shopId) sessionStorage.setItem("shopId", user.shopId);
    return user;
  },

  logout: () => clearSession(),
});
