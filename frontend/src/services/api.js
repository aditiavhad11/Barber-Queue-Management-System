import axios from "axios";
// Ready for backend: set VITE_API_URL. Pages read from /src/data via mock helpers for now.
export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || "/api" });
api.interceptors.request.use((c) => { const t = sessionStorage.getItem("token"); if (t) c.headers.Authorization = `Bearer ${t}`; return c; });
export const mock = (data, ms = 500) => new Promise((r) => setTimeout(() => r(data), ms));

// Expired / invalid JWT: clear the session once and send the person to the right sign-in page.
api.interceptors.response.use((r) => r, (error) => {
  const url = String(error.config?.url || "");
  if (error.response?.status === 401 && sessionStorage.getItem("token") && !url.includes("/auth/")) {
    const role = sessionStorage.getItem("role");
    ["token", "role", "shopId", "user", "ownerCurrentShopId"].forEach((k) => sessionStorage.removeItem(k));
    window.dispatchEvent(new Event("barber-auth-change"));
    const target = role === "shop" ? "/shop-sign-in" : role === "admin" ? "/sign-in?role=admin" : role === "owner" ? "/sign-in?role=owner" : "/sign-in";
    if (window.location.pathname + window.location.search !== target) window.location.assign(target);
  }
  return Promise.reject(error);
});
