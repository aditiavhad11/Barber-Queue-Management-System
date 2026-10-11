import axios from "axios";
import { notifyError } from "../utils/toast";
// Ready for backend: set VITE_API_URL. Pages read from /src/data via mock helpers for now.
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
});
api.interceptors.request.use((c) => {
  const t = sessionStorage.getItem("token");
  if (t) c.headers.Authorization = `Bearer ${t}`;
  return c;
});
export const mock = (data, ms = 500) =>
  new Promise((r) => setTimeout(() => r(data), ms));

// Expired / invalid JWT: clear the session once and send the person to the right sign-in page.
api.interceptors.response.use(
  (r) => r,
  (error) => {
    const url = String(error.config?.url || "");
    // Requests can opt out of the automatic failure toast (e.g. background polling)
    // by passing { toastOnError: false } in their axios config.
    const showToast = error.config?.toastOnError !== false;
    const status = error.response?.status;

    if (status === 401 && sessionStorage.getItem("token") && !url.includes("/auth/")) {
      const role = sessionStorage.getItem("role");
      ["token", "role", "shopId", "user", "ownerCurrentShopId"].forEach((k) =>
        sessionStorage.removeItem(k),
      );
      window.dispatchEvent(new Event("barber-auth-change"));
      if (showToast)
        notifyError("Your session has expired. Please sign in again.");
      const target =
        role === "shop"
          ? "/shop-sign-in"
          : role === "admin"
            ? "/sign-in?role=admin"
            : role === "owner"
              ? "/sign-in?role=owner"
              : "/sign-in";
      if (window.location.pathname + window.location.search !== target)
        window.location.assign(target);
    } else if (showToast) {
      notifyError(
        error.response?.data?.message ||
          error.message ||
          "Something went wrong. Please try again.",
      );
    }

    return Promise.reject(error);
  },
);

