import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ownerSeed } from "../data/owner";
import { api } from "../services/api";

const Ctx = createContext(null);
const ACTIVE_QUEUE_STATUSES = ["Waiting", "Your Turn", "In Service"];
const today = "02 Oct 2026";
const mergeReviews = (a = [], b = []) => {
  const source = Array.isArray(b) ? b : [];
  if (!source.length) return [];
  const seen = new Set();
  return source.filter((r) => {
    const k = r.queueId || r.id;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};
const STORAGE_KEY = "barberQueuePlatform:v12";
const clone = (x) => JSON.parse(JSON.stringify(x));
const normalizeDbShop = (raw) => {
  const hours = {
    open: raw.hours?.open || raw.hours_open || "09:00",
    close: raw.hours?.close || raw.hours_close || "21:00",
  };
  const photos = raw.photos || [];
  const servicesList = (raw.services || []).map((x) => ({
    ...x,
    id: x.id,
    shopId: raw.id,
    price: Number(x.price),
    duration: Number(x.duration ?? x.duration_minutes),
    enabled: x.enabled === undefined ? true : Boolean(x.enabled),
  }));
  const barbersList = (raw.barbers || []).map((b) => ({
    ...b,
    id: b.id,
    shopId: raw.id,
    status: b.status || "Available",
    services: b.services || servicesList.map((x) => x.id),
    photo: b.photo || b.photo_url || "",
  }));
  const queues = raw.queues || {};
  barbersList.forEach((b) => {
    if (!queues[b.id]) queues[b.id] = [];
  });
  let policy = raw.policy || raw.policies || raw.policies_json || {};
  if (typeof policy === "string") {
    try {
      policy = JSON.parse(policy);
    } catch {
      policy = {};
    }
  }
  let availability = raw.availability || raw.availability_json || {};
  if (typeof availability === "string") {
    try {
      availability = JSON.parse(availability);
    } catch {
      availability = {};
    }
  }
  return blankShop({
    ...raw,
    ownerId: raw.ownerId || raw.owner_id,
    status: raw.status || "pending",
    active: Boolean(raw.active),
    approved: raw.status === "approved",
    hours,
    photos,
    servicesList,
    services: servicesList,
    barbersList,
    barbers: barbersList,
    barberCount: barbersList.length,
    queues,
    payments: raw.payments || [],
    reviewsList: raw.reviewsList || raw.reviews || [],
    reviews: raw.reviewsList || raw.reviews || [],
    notifications: raw.notifications || [],
    customers: raw.customers || [],
    policy,
    availability,
    rejection: raw.rejection || raw.rejection_reason || "",
    image:
      raw.image ||
      photos.find((x) => x.primary || x.is_primary)?.url ||
      photos[0]?.url ||
      "",
    loginEmail: raw.loginEmail || raw.login_email || "",
  });
};

const blankShop = (s) => ({
  ...clone(s),
  photos: s.photos || [],
  servicesList: s.servicesList || [],
  barbersList: s.barbersList || [],
  queues: s.queues || {},
  payments: s.payments || [],
  reviewsList: s.reviewsList || [],
  notifications: s.notifications || [],
  customers: s.customers || [],
  finished: s.finished || 0,
  status: s.status || "pending",
  approved: s.status === "approved",
  active: s.status === "approved",
  rejection: s.rejection || "",
  loginEmail: s.loginEmail || "",
  loginPassword: s.loginPassword || "",
  barberCount: s.barberCount || 0,
});

const defaultState = () => ({
  owner: null,
  shops: [],
  currentShopId: null,
  customer: null,
  customerQueueId: null,
  customerNotifications: [],
  seenServerNotes: [],
  customerComplaints: [],
  notificationDismissed: { owner: [], shop: [], customer: [] },
  adminData: { notifications: [], complaints: [] },
  prefs: clone(ownerSeed.prefs),
});

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return {
      ...defaultState(),
      ...parsed,
      currentShopId:
        parsed.currentShopId ||
        sessionStorage.getItem("ownerCurrentShopId") ||
        null,
      shops: (parsed.shops || []).map(blankShop),
      customerNotifications: parsed.customerNotifications || [],
      customerComplaints: parsed.customerComplaints || [],
      notificationDismissed: {
        owner: [],
        shop: [],
        customer: [],
        ...(parsed.notificationDismissed || {}),
      },
      adminData: {
        notifications: [],
        complaints: [],
        ...(parsed.adminData || {}),
      },
    };
  } catch {
    return defaultState();
  }
}

export function OwnerProvider({ children }) {
  const [state, setState] = useState(loadState);
  const [serverUsers, setServerUsers] = useState([]);
  const [shopsLoading, setShopsLoading] = useState(false);
  const [shopLoadError, setShopLoadError] = useState("");
  const bookingLock = useRef(false);
  const syncRef = useRef(null);
  const [pendingBookings, setPendingBookings] = useState([]);
  const [myBookings, setMyBookings] = useState([]);
  const [, forceAuth] = useState(0);
  useEffect(() => {
    const onAuth = () => forceAuth((v) => v + 1);
    const onStorage = (event) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        const next = JSON.parse(event.newValue);
        setState({
          ...defaultState(),
          ...next,
          currentShopId:
            next.currentShopId ||
            sessionStorage.getItem("ownerCurrentShopId") ||
            null,
          shops: (next.shops || []).map(blankShop),
          customerNotifications: next.customerNotifications || [],
          customerComplaints: next.customerComplaints || [],
          notificationDismissed: {
            owner: [],
            shop: [],
            customer: [],
            ...(next.notificationDismissed || {}),
          },
          adminData: {
            notifications: [],
            complaints: [],
            ...(next.adminData || {}),
          },
        });
      } catch {}
    };
    window.addEventListener("barber-auth-change", onAuth);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("barber-auth-change", onAuth);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const sessionRole = sessionStorage.getItem("role") || "customer";
  const sessionShopId = sessionStorage.getItem("shopId");
  const sessionUser = (() => {
    try {
      return JSON.parse(sessionStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  })();
  const ownerId = sessionUser?.id || null;
  const ownerShopIds = ownerId
    ? state.shops.filter((s) => s.ownerId === ownerId).map((s) => s.id)
    : [];
  const sessionShop =
    sessionRole === "shop"
      ? state.shops.find((s) => s.id === sessionShopId)
      : null;
  const storedOwnerShopId = sessionStorage.getItem("ownerCurrentShopId");
  const selectedOwnerShopId = ownerShopIds.includes(state.currentShopId)
    ? state.currentShopId
    : ownerShopIds.includes(storedOwnerShopId)
      ? storedOwnerShopId
      : ownerShopIds[0] || null;
  useEffect(() => {
    if (sessionRole === "owner") {
      if (selectedOwnerShopId)
        sessionStorage.setItem("ownerCurrentShopId", selectedOwnerShopId);
      else sessionStorage.removeItem("ownerCurrentShopId");
    }
  }, [sessionRole, selectedOwnerShopId]);
  const effectiveShopId =
    sessionRole === "shop" ? sessionShop?.id || null : selectedOwnerShopId;
  const current = state.shops.find((x) => x.id === effectiveShopId) || null;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state]);
  useEffect(() => {
    setState((p) => ({
      ...p,
      owner: sessionRole === "owner" ? sessionUser : p.owner,
      customer: sessionRole === "customer" ? sessionUser : p.customer,
      currentShopId:
        sessionRole === "owner" && !p.currentShopId
          ? sessionStorage.getItem("ownerCurrentShopId") || null
          : p.currentShopId,
    }));
  }, [sessionRole, sessionUser?.id]);

  useEffect(() => {
    if (!sessionStorage.getItem("token")) return;
    let cancelled = false;
    const loadServerData = async () => {
      setShopsLoading(true);
      setShopLoadError("");
      try {
        const shopsReq =
          sessionRole === "owner"
            ? api.get("/shops/mine")
            : sessionRole === "admin"
              ? api.get("/shops/admin/all")
              : api.get("/shops");
        const usersReq =
          sessionRole === "admin"
            ? api.get("/auth/users")
            : Promise.resolve(null);
        const [shopsRes, usersRes] = await Promise.allSettled([
          shopsReq,
          usersReq,
        ]);
        if (cancelled) return;
        if (usersRes.status === "fulfilled" && usersRes.value)
          setServerUsers(usersRes.value.data || []);
        if (shopsRes.status === "rejected") throw shopsRes.reason;
        const results = [shopsRes.value];
        const serverShops = (results[0].data || []).map(normalizeDbShop);
        setState((p) => {
          // Keep the existing local runtime data for queues/bookings, payments,
          // reviews and notifications when the server shop response does not
          // contain those runtime fields. This fixes reload-only data loss
          // without changing any booking/business logic.
          const mergeRuntimeData = (serverShop) => {
            const localShop = p.shops.find((x) => x.id === serverShop.id);
            if (!localShop) return serverShop;
            return {
              ...serverShop,
              queues: localShop.queues || serverShop.queues || {},
              payments: localShop.payments || serverShop.payments || [],
              reviewsList: mergeReviews(
                localShop.reviewsList,
                serverShop.reviewsList,
              ),
              reviews: mergeReviews(
                localShop.reviewsList,
                serverShop.reviewsList,
              ),
              notifications:
                localShop.notifications || serverShop.notifications || [],
              customers: localShop.customers || serverShop.customers || [],
              isOpen:
                localShop.isOpen !== undefined
                  ? localShop.isOpen
                  : serverShop.isOpen !== undefined
                    ? serverShop.isOpen
                    : false,
              finished:
                localShop.finished !== undefined
                  ? localShop.finished
                  : serverShop.finished || 0,
            };
          };

          const mergedServerShops = serverShops.map(mergeRuntimeData);

          if (sessionRole === "owner") {
            const mineIds = new Set(mergedServerShops.map((x) => x.id));
            const localOther = p.shops.filter(
              (x) => !mineIds.has(x.id) && x.ownerId !== sessionUser?.id,
            );
            const stored = sessionStorage.getItem("ownerCurrentShopId");
            const currentId = mineIds.has(p.currentShopId)
              ? p.currentShopId
              : mineIds.has(stored)
                ? stored
                : mergedServerShops[0]?.id || null;
            if (currentId)
              sessionStorage.setItem("ownerCurrentShopId", currentId);
            else sessionStorage.removeItem("ownerCurrentShopId");
            return {
              ...p,
              shops: [...mergedServerShops, ...localOther],
              currentShopId: currentId,
            };
          }
          if (sessionRole === "admin")
            return { ...p, shops: mergedServerShops };
          const approved = mergedServerShops.filter(
            (x) => x.status === "approved" && x.active,
          );
          const nonServer = p.shops.filter(
            (x) => !serverShops.some((y) => y.id === x.id),
          );
          return { ...p, shops: [...approved, ...nonServer] };
        });
      } catch (error) {
        if (!cancelled)
          setShopLoadError(
            error.response?.data?.message ||
              error.message ||
              "Could not load data from the database.",
          );
      } finally {
        if (!cancelled) setShopsLoading(false);
      }
    };
    loadServerData();
    return () => {
      cancelled = true;
    };
  }, [sessionRole, sessionUser?.id]);

  const updateShop = (shopId, updater) =>
    setState((p) => ({
      ...p,
      shops: p.shops.map((s) =>
        s.id === shopId
          ? typeof updater === "function"
            ? updater(s)
            : { ...s, ...updater }
          : s,
      ),
    }));

  const up = (key, value) => {
    setState((p) => {
      if (
        ["owner", "prefs", "customer", "customerNotifications"].includes(key)
      ) {
        const v = typeof value === "function" ? value(p[key]) : value;
        return { ...p, [key]: v };
      }
      if (key === "adminData")
        return {
          ...p,
          adminData: typeof value === "function" ? value(p.adminData) : value,
        };
      if (
        [
          "shop",
          "barbers",
          "services",
          "queues",
          "payments",
          "reviews",
          "finished",
          "notifications",
        ].includes(key)
      ) {
        const id =
          sessionRole === "shop"
            ? sessionShopId
            : ownerShopIds.includes(p.currentShopId)
              ? p.currentShopId
              : ownerShopIds[0];
        if (!id) return p;
        return {
          ...p,
          shops: p.shops.map((s) => {
            if (s.id !== id) return s;
            if (key === "shop") {
              const patch = typeof value === "function" ? value(s) : value;
              const nextStatus = patch.status ?? s.status;
              return {
                ...s,
                ...patch,
                approved: nextStatus === "approved",
                active: nextStatus === "approved",
              };
            }
            const old =
              key === "barbers"
                ? s.barbersList
                : key === "services"
                  ? s.servicesList
                  : key === "queues"
                    ? s.queues
                    : key === "payments"
                      ? s.payments
                      : key === "reviews"
                        ? s.reviewsList
                        : key === "finished"
                          ? s.finished
                          : s.notifications;
            const next = typeof value === "function" ? value(old) : value;
            const patch =
              key === "barbers"
                ? { barbersList: next, barberCount: next.length, barbers: next }
                : key === "services"
                  ? { servicesList: next, services: next }
                  : key === "queues"
                    ? { queues: next }
                    : key === "payments"
                      ? { payments: next }
                      : key === "reviews"
                        ? { reviewsList: next, reviews: next }
                        : key === "finished"
                          ? { finished: next }
                          : { notifications: next };
            return { ...s, ...patch };
          }),
        };
      }
      const v = typeof value === "function" ? value(p[key]) : value;
      return { ...p, [key]: v };
    });

    if (key === "shop" && (sessionRole === "owner" || sessionRole === "shop")) {
      const id = sessionRole === "shop" ? sessionShopId : effectiveShopId;
      const existing = state.shops.find((s) => s.id === id);
      if (existing) {
        const patch = typeof value === "function" ? value(existing) : value;
        const body = {};
        [
          "name",
          "description",
          "contact",
          "address",
          "location",
          "hours",
          "availability",
          "policy",
          "photos",
        ].forEach((k) => {
          if (patch[k] !== undefined) body[k] = patch[k];
        });
        if (Object.keys(body).length) {
          api
            .patch(`/shops/${id}`, body)
            .catch((error) =>
              console.error("Could not persist shop changes:", error),
            );
        }
      }
    }
  };

  const addServiceToShop = async (shopId, service) => {
    const payload = {
      name: String(service.name || "").trim(),
      price: Number(service.price),
      duration: Number(service.duration),
    };
    if (
      !payload.name ||
      !Number.isFinite(payload.price) ||
      payload.price <= 0 ||
      !Number.isFinite(payload.duration) ||
      payload.duration <= 0
    )
      throw new Error(
        "Enter a service name, positive price and positive duration.",
      );
    try {
      const response = await api.post(`/shops/${shopId}/services`, payload);
      const saved = response.data?.service || response.data;
      const normalized = {
        id: saved.id,
        shopId,
        name: saved.name || payload.name,
        price: Number(saved.price ?? payload.price),
        duration: Number(saved.duration ?? payload.duration),
        enabled: saved.enabled !== false,
      };
      setState((p) => ({
        ...p,
        shops: p.shops.map((s) => {
          if (s.id !== shopId) return s;
          const list = [...(s.servicesList || [])];
          const index = list.findIndex((x) => x.id === normalized.id);
          const next =
            index >= 0
              ? list.map((x, i) => (i === index ? normalized : x))
              : [...list, normalized];
          return { ...s, servicesList: next, services: next };
        }),
      }));
      return normalized;
    } catch (error) {
      throw new Error(
        error.response?.data?.message ||
          error.message ||
          "Could not add service.",
      );
    }
  };

  const addServiceToAllShops = async (shopIds, service) => {
    const results = [];
    for (const id of shopIds) results.push(await addServiceToShop(id, service));
    return results;
  };

  const saveBarber = async (form) => {
    if (!effectiveShopId) throw new Error("Select a shop first.");
    try {
      const payload = {
        name: form.name,
        gender: form.gender,
        experience: form.experience,
        specialization: form.specialization,
        status: form.status,
        photo: form.photo || null,
        services: form.services || [],
      };
      const response = form.id
        ? await api.patch(
            `/shops/${effectiveShopId}/barbers/${form.id}`,
            payload,
          )
        : await api.post(`/shops/${effectiveShopId}/barbers`, payload);
      const saved = response.data.barber || response.data;
      const normalized = {
        ...form,
        id: saved.id || form.id,
        shopId: effectiveShopId,
        name: saved.name || form.name,
        gender: saved.gender || form.gender,
        experience: Number(
          saved.experience_years ?? saved.experience ?? form.experience ?? 0,
        ),
        specialization: saved.specialization || form.specialization || "",
        status: saved.status || form.status || "Available",
        photo: saved.photo_url || saved.photo || form.photo || "",
        services: saved.services || form.services || [],
      };
      up("barbers", (list) =>
        form.id
          ? list.map((b) => (b.id === form.id ? { ...b, ...normalized } : b))
          : [...list, normalized],
      );
      return normalized;
    } catch (error) {
      throw new Error(
        error.response?.data?.message ||
          error.message ||
          "Could not save barber profile.",
      );
    }
  };

  // Apply one policy set to every shop this owner has (local state + database).
  const applyPolicyToAllShops = async (policy) => {
    const ids = state.shops
      .filter((x) => x.ownerId === ownerId)
      .map((x) => x.id);
    if (!ids.length) throw new Error("No shops found for this owner.");
    const results = await Promise.allSettled(
      ids.map((id) => api.patch(`/shops/${id}`, { policy })),
    );
    const okIds = ids.filter((_, i) => results[i].status === "fulfilled");
    setState((p) => ({
      ...p,
      shops: p.shops.map((x) =>
        okIds.includes(x.id) ? { ...x, policy: { ...policy } } : x,
      ),
    }));
    if (okIds.length !== ids.length)
      throw new Error(
        `Policies saved for ${okIds.length} of ${ids.length} shops. Please try again.`,
      );
    return okIds.length;
  };
  const selectShop = (id) => {
    if (sessionRole === "shop") return;
    if (state.shops.some((s) => s.id === id && s.ownerId === ownerId)) {
      sessionStorage.setItem("ownerCurrentShopId", id);
      setState((p) => ({ ...p, currentShopId: id }));
    }
  };

  const deleteShop = async (id) => {
    const target = state.shops.find((s) => s.id === id);
    if (!target || target.ownerId !== ownerId) return;
    try {
      await api.delete(`/shops/${id}`);
    } catch (error) {
      if (import.meta.env.VITE_API_URL)
        throw new Error(
          error.response?.data?.message ||
            "Could not delete shop from the database.",
        );
    }
    setState((p) => {
      const remaining = p.shops.filter((s) => s.id !== id);
      const nextId = remaining.find((s) => s.ownerId === ownerId)?.id || null;
      if (nextId) sessionStorage.setItem("ownerCurrentShopId", nextId);
      else sessionStorage.removeItem("ownerCurrentShopId");
      return { ...p, shops: remaining, currentShopId: nextId };
    });
  };

  const submitShop = async (payload) => {
    if (!ownerId)
      throw new Error("Owner session is missing. Please sign in again.");
    const normalizedPayload = { ...payload };
    try {
      const { data } = await api.post("/shops", normalizedPayload);
      const serverShop = normalizeDbShop(data);
      sessionStorage.setItem("ownerCurrentShopId", serverShop.id);
      setState((p) => ({
        ...p,
        shops: [...p.shops.filter((s) => s.id !== serverShop.id), serverShop],
        currentShopId: serverShop.id,
      }));
      return serverShop;
    } catch (error) {
      throw new Error(
        error.response?.data?.message ||
          "Could not save the shop to the database.",
      );
    }
  };

  const adminUpdateShop = async (id, patch) => {
    const target = state.shops.find((s) => s.id === id);
    if (!target) return;
    try {
      await api.patch(`/shops/${id}/status`, {
        status: patch.status,
        rejection: patch.rejection || "",
      });
    } catch (error) {
      throw new Error(
        error.response?.data?.message ||
          "Could not update shop status in the database.",
      );
    }
    setState((p) => {
      const nextStatus = patch.status;
      const message =
        nextStatus === "approved" && target.status === "suspended"
          ? "Your shop has been reactivated and is visible to customers again."
          : nextStatus === "approved"
            ? "Your shop has been approved and is now visible to customers."
            : nextStatus === "rejected"
              ? "Your shop was rejected. Open My Shops and use View rejection reason to see the admin feedback."
              : nextStatus === "suspended"
                ? "Your shop has been suspended and is hidden from customers."
                : "Shop status updated.";
      const note = {
        id: Date.now(),
        tone:
          nextStatus === "approved"
            ? "ok"
            : nextStatus === "rejected" || nextStatus === "suspended"
              ? "alert"
              : "info",
        text: message,
        createdAt: new Date().toISOString(),
        source: "admin",
      };
      return {
        ...p,
        shops: p.shops.map((s) =>
          s.id === id
            ? {
                ...s,
                ...patch,
                approved: nextStatus === "approved",
                active: nextStatus === "approved",
                rejection:
                  nextStatus === "rejected"
                    ? patch.rejection
                    : nextStatus === "approved"
                      ? ""
                      : s.rejection,
                notifications: [note, ...(s.notifications || [])],
              }
            : s,
        ),
      };
    });
  };

  const nextToken = (shop) => {
    const used = Object.values(shop.queues || {})
      .flat()
      .map((e) => Number(String(e.token || "").replace(/^A/i, "")))
      .filter(Number.isFinite);
    return `A${String((used.length ? Math.max(...used) : 0) + 1).padStart(3, "0")}`;
  };

  const normalizeQueue = (list) => {
    const active = list.filter((e) => ACTIVE_QUEUE_STATUSES.includes(e.status));
    const inService = active.find((e) => e.status === "In Service");
    if (inService)
      return list.map((e) =>
        e.status === "Your Turn" ? { ...e, status: "Waiting" } : e,
      );
    const firstId = active[0]?.id;
    return list.map((e) => {
      if (!firstId) return e;
      if (e.id === firstId && e.status === "Waiting")
        return { ...e, status: "Your Turn" };
      if (e.id !== firstId && e.status === "Your Turn")
        return { ...e, status: "Waiting" };
      return e;
    });
  };

  const setQueueStatus = (shopId, barberId, entryId, status, extra = {}) => {
    const live = state.shops
      .find((s) => s.id === shopId)
      ?.queues?.[barberId]?.find((e) => e.id === entryId);
    if (live?.bookingId && sessionStorage.getItem("token")) {
      api
        .patch(`/bookings/${live.bookingId}/queue-status`, { status })
        .then(() => syncRef.current?.())
        .catch((error) =>
          console.error(
            "Could not save queue status:",
            error.response?.data?.message || error.message,
          ),
        );
    }
    applyQueueStatus(shopId, barberId, entryId, status, extra);
  };
  const applyQueueStatus = (shopId, barberId, entryId, status, extra = {}) =>
    setState((p) => {
      const target = p.shops.find((s) => s.id === shopId);
      const oldEntry = target?.queues?.[barberId]?.find(
        (e) => e.id === entryId,
      );
      if (!oldEntry) return p;
      let q = target.queues?.[barberId] || [];
      if (status === "Skipped") {
        const moving = q.find((e) => e.id === entryId);
        q = [
          ...q.filter((e) => e.id !== entryId),
          {
            ...moving,
            status: "Waiting",
            skippedAt: new Date().toISOString(),
            skipCount: (moving.skipCount || 0) + 1,
          },
        ];
      } else {
        q = q.map((e) =>
          e.id === entryId
            ? {
                ...e,
                status,
                ...extra,
                ...(status === "In Service"
                  ? { serviceStartedAt: new Date().toISOString() }
                  : {}),
                ...(status === "Completed"
                  ? { completedAt: new Date().toISOString() }
                  : {}),
              }
            : e,
        );
      }
      q = normalizeQueue(q);
      const finalStatus =
        status === "Skipped" ? "Skipped to end of queue" : status;
      const now = new Date().toISOString();
      const note = {
        id: `n-${crypto.randomUUID()}`,
        tone:
          status === "Completed"
            ? "ok"
            : ["No Show", "Cancelled"].includes(status)
              ? "alert"
              : "info",
        text: `Queue ${oldEntry.token} is now ${finalStatus}.`,
        createdAt: now,
      };
      const msg = {
        id: `n-${crypto.randomUUID()}`,
        tone: note.tone,
        text: `Your queue status is now ${finalStatus}.`,
        createdAt: now,
      };
      return {
        ...p,
        shops: p.shops.map((s) => {
          if (s.id !== shopId) return s;
          const nextPayments =
            status === "Cancelled"
              ? (s.payments || []).map((payment) => {
                  if (
                    payment.queueId !== entryId ||
                    !["Successful", "Pending"].includes(payment.status)
                  )
                    return payment;
                  return { ...payment, status: "Cancelled", cancelledAt: now };
                })
              : s.payments || [];
          return {
            ...s,
            queues: { ...s.queues, [barberId]: q },
            payments: nextPayments,
            finished: status === "Completed" ? s.finished + 1 : s.finished,
            notifications: [note, ...(s.notifications || [])],
          };
        }),
        customerNotifications: [msg, ...p.customerNotifications],
      };
    });

  const addServiceToQueue = ({ queueId, serviceIds }) => {
    const customerId = state.customer?.id;
    const selectedIds = [...new Set((serviceIds || []).map(String))];
    const existingEntry = state.shops.some((shop) =>
      Object.values(shop.queues || {}).some((queue) =>
        queue.some(
          (entry) =>
            entry.id === queueId &&
            entry.customerId === customerId &&
            ACTIVE_QUEUE_STATUSES.includes(entry.status),
        ),
      ),
    );
    if (!customerId || !existingEntry || !selectedIds.length) return false;
    setState((p) => {
      for (const shop of p.shops) {
        for (const [barberId, q] of Object.entries(shop.queues || {})) {
          const entry = q.find(
            (e) =>
              e.id === queueId &&
              e.customerId === p.customer?.id &&
              ACTIVE_QUEUE_STATUSES.includes(e.status),
          );
          if (!entry) continue;
          const ids = selectedIds;
          const currentServices =
            Array.isArray(entry.services) && entry.services.length
              ? entry.services
              : [
                  shop.servicesList.find(
                    (service) => service.id === entry.service,
                  ),
                ]
                  .filter(Boolean)
                  .map((service) => ({
                    id: service.id,
                    name: service.name,
                    price: Number(service.price),
                    duration: Number(service.duration),
                  }));
          const additions = ids
            .map((id) =>
              shop.servicesList.find((service) => String(service.id) === id),
            )
            .filter(Boolean)
            .filter(
              (service) =>
                service.enabled !== false &&
                !currentServices.some(
                  (item) => String(item.id) === String(service.id),
                ),
            );
          if (!additions.length) return p;
          const services = [
            ...currentServices,
            ...additions.map((service) => ({
              id: service.id,
              name: service.name,
              price: Number(service.price),
              duration: Number(service.duration),
            })),
          ];
          const total = services.reduce(
            (n, service) => n + Number(service.price || 0),
            0,
          );
          const duration = services.reduce(
            (n, service) => n + Number(service.duration || 0),
            0,
          );
          const now = new Date().toISOString();
          const nextEntry = {
            ...entry,
            services,
            service: services[0].id,
            serviceDuration: duration,
            paymentAmount: total,
            additionalServicesAddedAt: now,
          };
          const nextQ = q.map((item) =>
            item.id === queueId ? nextEntry : item,
          );
          const payment = {
            id: `TXN-${crypto.randomUUID()}`,
            customerId: p.customer.id,
            customer: p.customer.name,
            beneficiary: entry.beneficiary?.name || p.customer.name,
            service: additions.map((item) => item.name).join(" + "),
            barber: shop.barbersList.find((barber) => barber.id === barberId)
              ?.name,
            amount: additions.reduce((n, item) => n + Number(item.price), 0),
            date: new Date().toLocaleDateString("en-IN"),
            time: new Date().toLocaleTimeString("en-IN", {
              hour: "numeric",
              minute: "2-digit",
            }),
            status: "Successful",
            shopId: shop.id,
            queueId,
          };
          const note = {
            id: `n-${crypto.randomUUID()}`,
            tone: "ok",
            text: `Additional service added to #${entry.token}: ${additions.map((item) => item.name).join(" + ")}.`,
            createdAt: now,
          };
          return {
            ...p,
            shops: p.shops.map((item) =>
              item.id === shop.id
                ? {
                    ...item,
                    queues: { ...item.queues, [barberId]: nextQ },
                    payments: [...(item.payments || []), payment],
                    notifications: [note, ...(item.notifications || [])],
                  }
                : item,
            ),
            customerNotifications: [note, ...p.customerNotifications],
          };
        }
      }
      return p;
    });
    return true;
  };

  const contactCustomer = async ({ shopId, queueId, message }) => {
    const shop = state.shops.find((s) => s.id === shopId);
    const entry =
      shop &&
      Object.values(shop.queues || {})
        .flat()
        .find((e) => e.id === queueId);
    if (!shop || !entry) throw new Error("Queue entry not found.");
    const barber = shop.barbersList.find((b) => b.id === entry.barberId);
    const services = (
      entry.services || [shop.servicesList.find((s) => s.id === entry.service)]
    )
      .filter(Boolean)
      .map((s) => s.name)
      .join(" + ");
    const recipient =
      entry.beneficiary?.isSelf === false && entry.beneficiary?.email
        ? { email: entry.beneficiary.email, name: entry.beneficiary.name }
        : { email: null, name: entry.name };
    try {
      await api.post("/notifications/contact", {
        customerId: entry.customerId,
        recipientEmail: recipient.email,
        recipientName: recipient.name,
        shopName: shop.name,
        token: entry.token,
        barber: barber?.name || "Barber",
        services,
        status: entry.status,
        message: String(message || "").trim(),
      });
    } catch (error) {
      throw new Error(
        error.response?.data?.message || "Could not send the customer email.",
      );
    }
    const note = {
      id: `n-${crypto.randomUUID()}`,
      tone: "info",
      text: String(message || "Message sent to customer."),
      createdAt: new Date().toISOString(),
      customerId: entry.customerId,
    };
    setState((p) => ({
      ...p,
      shops: p.shops.map((s) =>
        s.id === shopId
          ? { ...s, notifications: [note, ...(s.notifications || [])] }
          : s,
      ),
      customerNotifications: [note, ...p.customerNotifications],
    }));
  };

  const addComplaint = ({ shopId, issueType, subject, description }) =>
    setState((p) => {
      const shop = p.shops.find((s) => s.id === shopId);
      if (!shop || !p.customer?.id) return p;
      const complaint = {
        id: `CMP-${crypto.randomUUID()}`,
        customerId: p.customer.id,
        shopId,
        shop: shop.name,
        issueType,
        subject,
        description,
        status: "OPEN",
        createdAt: new Date().toISOString(),
      };
      return {
        ...p,
        customerComplaints: [complaint, ...(p.customerComplaints || [])],
        adminData: {
          ...p.adminData,
          complaints: [complaint, ...(p.adminData?.complaints || [])],
        },
      };
    });

  const addReview = async ({ shopId, queueId, rating, text }) => {
    const shopTarget = state.shops.find((s) => s.id === shopId);
    if (!shopTarget || !state.customer?.id) return false;
    const entry = Object.values(shopTarget.queues || {})
      .flat()
      .find((e) => e.id === queueId);
    if (
      !entry ||
      entry.status !== "Completed" ||
      entry.customerId !== state.customer.id
    )
      return false;
    if ((shopTarget.reviewsList || []).some((r) => r.queueId === queueId))
      return false;
    const cleanText = String(text || "").trim();
    try {
      const { data } = await api.post("/reviews", {
        shopId,
        queueId,
        rating: +rating,
        text: cleanText,
      });
      const service = shopTarget.servicesList.find(
        (x) => x.id === entry.service,
      );
      const barber = shopTarget.barbersList.find(
        (x) => x.id === entry.barberId,
      );
      const review = {
        id: data.id || `rev-${crypto.randomUUID()}`,
        queueId,
        customerId: state.customer.id,
        customer: state.customer.name,
        rating: +rating,
        text: cleanText,
        service: service?.name || entry.service,
        barber: barber?.name || entry.barberId,
        date: new Date().toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
        shopId,
      };
      setState((p) => ({
        ...p,
        shops: p.shops.map((s) => {
          if (s.id !== shopId) return s;
          const list = [...(s.reviewsList || []), review];
          return {
            ...s,
            reviewsList: list,
            reviews: list,
            rating: +(
              list.reduce((a, r) => a + r.rating, 0) / list.length
            ).toFixed(1),
            reviewCount: list.length,
            notifications: [
              {
                id: Date.now() + 1,
                tone: "ok",
                text: `New ${rating}-star review from ${p.customer.name}.`,
                createdAt: new Date().toISOString(),
              },
              ...(s.notifications || []),
            ],
          };
        }),
      }));
      return true;
    } catch (error) {
      console.error(
        "Could not save review:",
        error.response?.data?.message || error.message,
      );
      return false;
    }
  };

  const deletePayment = async (payment) => {
    if (!payment?.queueId)
      throw new Error("This payment record cannot be deleted.");
    await api.delete(`/bookings/${payment.queueId}/history`);
    setState((p) => ({
      ...p,
      shops: p.shops.map((s) => {
        if (s.id !== payment.shopId) return s;
        const queues = Object.fromEntries(
          Object.entries(s.queues || {}).map(([barberId, list]) => [
            barberId,
            list.filter((e) => e.id !== payment.queueId),
          ]),
        );
        return {
          ...s,
          queues,
          payments: (s.payments || []).filter(
            (x) => x.id !== payment.id && x.queueId !== payment.queueId,
          ),
          reviewsList: (s.reviewsList || []).filter(
            (r) => r.queueId !== payment.queueId,
          ),
          reviews: (s.reviews || []).filter(
            (r) => r.queueId !== payment.queueId,
          ),
        };
      }),
    }));
  };

  const sendAnnouncement = (text) => {
    const clean = String(text || "").trim();
    if (!clean) return;
    const note = {
      id: `ann-${crypto.randomUUID()}`,
      tone: "info",
      text: clean,
      createdAt: new Date().toISOString(),
      source: "admin",
      type: "announcement",
      audience: ["owner", "customer"],
    };
    setState((p) => ({
      ...p,
      adminData: {
        ...p.adminData,
        notifications: [note, ...(p.adminData?.notifications || [])],
      },
    }));
  };

  const removeNotification = (id) => {
    setState((p) => {
      if (sessionRole === "admin")
        return {
          ...p,
          adminData: {
            ...p.adminData,
            notifications: (p.adminData?.notifications || []).filter(
              (n) => n.id !== id,
            ),
          },
        };
      const key =
        sessionRole === "shop"
          ? "shop"
          : sessionRole === "owner"
            ? "owner"
            : "customer";
      const dismissed = p.notificationDismissed || {
        owner: [],
        shop: [],
        customer: [],
      };
      if (sessionRole === "customer") {
        const own = (p.customerNotifications || []).find((n) => n.id === id);
        if (own)
          return {
            ...p,
            customerNotifications: (p.customerNotifications || []).filter(
              (n) => n.id !== id,
            ),
          };
      }
      const currentNotifications = current?.notifications || [];
      const local = currentNotifications.find((n) => n.id === id);
      if (local) {
        const idForShop = effectiveShopId;
        if (!idForShop) return p;
        return {
          ...p,
          shops: p.shops.map((s) =>
            s.id === idForShop
              ? {
                  ...s,
                  notifications: (s.notifications || []).filter(
                    (n) => n.id !== id,
                  ),
                }
              : s,
          ),
        };
      }
      if ((p.adminData?.notifications || []).some((n) => n.id === id)) {
        return {
          ...p,
          notificationDismissed: {
            ...dismissed,
            [key]: [...new Set([...(dismissed[key] || []), id])],
          },
        };
      }
      return p;
    });
  };

  // Payment submissions and queue bookings live in MySQL. This browser only reads them and never decides a payment is confirmed.
  useEffect(() => {
    if (
      !sessionStorage.getItem("token") ||
      !["owner", "shop", "customer"].includes(sessionRole)
    )
      return undefined;
    let stopped = false;
    const toNote = (n) => ({
      id: n.id,
      tone: n.tone,
      text: n.text,
      createdAt: n.createdAt,
      source: "booking",
    });
    const mergeNotes = (rows) =>
      setState((p) => {
        const seen = new Set(p.seenServerNotes || []);
        const fresh = rows.filter(
          (n) =>
            !seen.has(n.id) &&
            (sessionRole === "customer" ||
              p.shops.some((s) => s.id === n.shopId)),
        );
        if (!fresh.length) return p;
        const seenServerNotes = [...seen, ...fresh.map((n) => n.id)].slice(
          -500,
        );
        if (sessionRole === "customer")
          return {
            ...p,
            seenServerNotes,
            customerNotifications: [
              ...fresh.map(toNote),
              ...p.customerNotifications,
            ],
          };
        return {
          ...p,
          seenServerNotes,
          shops: p.shops.map((s) => {
            const mine = fresh.filter((n) => n.shopId === s.id);
            return mine.length
              ? {
                  ...s,
                  notifications: [
                    ...mine.map(toNote),
                    ...(s.notifications || []),
                  ],
                }
              : s;
          }),
        };
      });
    // The queue lives in MySQL: every accepted booking is a queue entry, so the customer, the owner and the
    // shop login all see the same ticket and status, on any device.
    const mergeQueue = (rows) =>
      setState((p) => {
        if (!rows.length) return p;
        let changed = false;
        const shops = p.shops.map((shop) => {
          const mine = rows.filter((b) => b.shopId === shop.id);
          if (!mine.length) return shop;
          const queues = { ...(shop.queues || {}) };
          const payments = [...(shop.payments || [])];
          const customers = new Set(shop.customers || []);
          const serverIds = new Set(mine.map((b) => b.queueId));
          for (const b of mine) {
            const person =
              b.beneficiary?.isSelf === false
                ? { ...b.beneficiary }
                : {
                    name: b.customerName,
                    mobile: b.beneficiary?.mobile || "",
                    email: b.beneficiary?.email || "",
                    isSelf: true,
                  };
            const status = b.queueStatus || "Waiting";
            const entry = {
              id: b.queueId,
              bookingId: b.id,
              token: b.token,
              customerId: b.customerId,
              name: b.customerName,
              beneficiary: person,
              beneficiaryKey: person.isSelf
                ? `user:${b.customerId}`
                : `mobile:${person.mobile || person.email || String(person.name || "").toLowerCase()}`,
              services: (b.services || []).map((x) => ({
                id: x.id,
                name: x.name,
                price: Number(x.price),
                duration: Number(x.duration),
              })),
              service: b.services?.[0]?.id || b.serviceIds?.[0],
              serviceDuration: b.durationMinutes,
              barberId: b.barberId,
              shopId: b.shopId,
              status,
              arrival: "ontime",
              paymentStatus: "Successful",
              paymentAmount: b.amount,
              joinedAt: new Date(
                b.acceptedAt || b.paidAt || Date.now(),
              ).getTime(),
              createdAt: b.acceptedAt || b.paidAt || new Date().toISOString(),
              skipCount: b.skipCount || 0,
              ...(b.skippedAt ? { skippedAt: b.skippedAt } : {}),
              ...(b.completedAt ? { completedAt: b.completedAt } : {}),
            };
            const list = queues[b.barberId] || [];
            const old = list.find((e) => e.id === entry.id);
            const merged = old ? { ...old, ...entry, status } : entry;
            if (!old || JSON.stringify(old) !== JSON.stringify(merged))
              changed = true;
            queues[b.barberId] = old
              ? list.map((e) => (e.id === entry.id ? merged : e))
              : [...list, merged];
            if (b.paymentId && !payments.some((x) => x.queueId === entry.id)) {
              const paidAt = new Date(
                b.acceptedAt || b.paymentSubmittedAt || Date.now(),
              );
              payments.push({
                id: `TXN-${b.paymentId}`,
                customerId: b.customerId,
                customer: b.customerName,
                beneficiary: person.name,
                service: (b.services || []).map((x) => x.name).join(" + "),
                barber: b.barberName,
                amount: b.amount,
                date: paidAt.toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                }),
                time: paidAt.toLocaleTimeString("en-IN", {
                  hour: "numeric",
                  minute: "2-digit",
                }),
                status: status === "Cancelled" ? "Cancelled" : "Successful",
                paymentMethod: "UPI QR",
                shopId: b.shopId,
                queueId: entry.id,
                queueStatus: status,
                paymentReference: b.paymentId,
              });
              changed = true;
            }
            customers.add(b.customerId);
          }
          // Server order is authoritative for booking-backed entries (skips move a ticket to the end).
          for (const barberId of Object.keys(queues)) {
            const list = queues[barberId];
            const fromServer = mine
              .filter((b) => b.barberId === barberId)
              .map((b) => list.find((e) => e.id === b.queueId))
              .filter(Boolean);
            const rest = list.filter((e) => !serverIds.has(e.id));
            queues[barberId] = normalizeQueue([...fromServer, ...rest]);
          }
          return { ...shop, queues, payments, customers: [...customers] };
        });
        return changed ? { ...p, shops } : p;
      });
    const run = async () => {
      try {
        const [notes, bookings, queueRows] = await Promise.all([
          api.get("/notifications/mine"),
          api.get(
            sessionRole === "customer" ? "/bookings/mine" : "/bookings/pending",
          ),
          api.get("/bookings/queue"),
        ]);
        if (stopped) return;
        mergeQueue(queueRows.data || []);
        mergeNotes(notes.data || []);
        if (sessionRole === "customer") setMyBookings(bookings.data || []);
        else setPendingBookings(bookings.data || []);
      } catch {
        /* offline or session expired: keep the last known data */
      }
    };
    syncRef.current = run;
    run();
    const timer = setInterval(run, 8000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [sessionRole, sessionUser?.id]);

  // Owner ACCEPT: the backend moves the booking from paid to accepted, and only then is the customer added to the queue.
  const acceptBooking = async (booking) => {
    const shop = state.shops.find((s) => s.id === booking.shopId);
    if (!shop)
      throw new Error(
        "Shop data is not loaded yet. Please refresh and try again.",
      );
    const { data } = await api.patch(`/bookings/${booking.id}/accept`, {
      token: nextToken(shop),
    });
    const b = data.booking;
    setState((p) => {
      const target = p.shops.find((s) => s.id === b.shopId);
      if (
        !target ||
        Object.values(target.queues || {})
          .flat()
          .some((e) => e.id === b.queueId)
      )
        return p;
      const services = b.serviceIds
        .map((id) => target.servicesList.find((s) => s.id === id))
        .filter(Boolean);
      if (!services.length) return p;
      const person =
        b.beneficiary?.isSelf === false
          ? { ...b.beneficiary }
          : {
              name: b.customerName,
              mobile: b.beneficiary?.mobile || "",
              email: b.beneficiary?.email || "",
              isSelf: true,
            };
      const queue = target.queues?.[b.barberId] || [];
      const serviceName = services.map((s) => s.name).join(" + ");
      const barberName =
        target.barbersList.find((x) => x.id === b.barberId)?.name ||
        b.barberName;
      const paidAt = new Date(
        b.acceptedAt || b.paymentSubmittedAt || Date.now(),
      );
      const entry = {
        id: b.queueId,
        bookingId: b.id,
        token: b.token,
        customerId: b.customerId,
        name: b.customerName,
        beneficiary: person,
        beneficiaryKey: person.isSelf
          ? `user:${b.customerId}`
          : `mobile:${person.mobile || person.email || String(person.name || "").toLowerCase()}`,
        services: services.map((s) => ({
          id: s.id,
          name: s.name,
          price: Number(s.price),
          duration: Number(s.duration),
        })),
        service: services[0].id,
        serviceDuration: services.reduce(
          (n, s) => n + Number(s.duration || 0),
          0,
        ),
        barberId: b.barberId,
        shopId: b.shopId,
        status: queue.length === 0 ? "Your Turn" : "Waiting",
        arrival: "ontime",
        paymentStatus: "Successful",
        paymentAmount: b.amount,
        joinedAt: Date.now(),
        createdAt: new Date().toISOString(),
      };
      const payment = {
        id: `TXN-${b.paymentId}`,
        customerId: b.customerId,
        customer: b.customerName,
        beneficiary: person.name,
        service: serviceName,
        barber: barberName,
        amount: b.amount,
        date: paidAt.toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
        time: paidAt.toLocaleTimeString("en-IN", {
          hour: "numeric",
          minute: "2-digit",
        }),
        status: "Successful",
        paymentMethod: "UPI QR",
        shopId: b.shopId,
        queueId: entry.id,
        queueStatus: entry.status,
        paymentReference: b.paymentId,
      };
      const note = {
        id: `n-${crypto.randomUUID()}`,
        tone: "info",
        text: `New queue entry: ${b.token} joined ${barberName}'s queue for ${serviceName}.`,
        createdAt: new Date().toISOString(),
      };
      return {
        ...p,
        customerQueueId:
          p.customer?.id === b.customerId ? entry.id : p.customerQueueId,
        shops: p.shops.map((s) =>
          s.id === b.shopId
            ? {
                ...s,
                queues: {
                  ...s.queues,
                  [b.barberId]: normalizeQueue([...queue, entry]),
                },
                payments: [...(s.payments || []), payment],
                notifications: [note, ...(s.notifications || [])],
                customers: [...new Set([...(s.customers || []), b.customerId])],
              }
            : s,
        ),
      };
    });
    setPendingBookings((list) => list.filter((x) => x.id !== booking.id));
    return b;
  };

  const declineBooking = async (booking, reason) => {
    const { data } = await api.patch(`/bookings/${booking.id}/decline`, {
      reason,
    });
    setPendingBookings((list) => list.filter((x) => x.id !== booking.id));
    return data.booking;
  };

  const customerQueues = useMemo(() => {
    if (!state.customer?.id) return [];
    const rows = [];
    for (const s of state.shops)
      for (const [barberId, q] of Object.entries(s.queues || {})) {
        for (const e of q) {
          if (e.customerId !== state.customer.id) continue;
          const barber = s.barbersList.find((b) => b.id === barberId);
          rows.push({
            shop: s,
            barberId,
            entry: e,
            service: s.servicesList.find((x) => x.id === e.service),
            services: e.services || [],
            barber,
          });
        }
      }
    return rows.sort((a, b) => {
      const rank = {
        "In Service": 0,
        "Your Turn": 1,
        Waiting: 2,
        Completed: 3,
        Skipped: 4,
        "No Show": 5,
        Cancelled: 6,
      };
      return (
        (rank[a.entry.status] ?? 9) - (rank[b.entry.status] ?? 9) ||
        new Date(b.entry.createdAt || 0) - new Date(a.entry.createdAt || 0)
      );
    });
  }, [state.shops, state.customer?.id]);

  const customerQueue = useMemo(
    () =>
      customerQueues.find((x) => x.entry.id === state.customerQueueId) ||
      customerQueues.find((x) =>
        ACTIVE_QUEUE_STATUSES.includes(x.entry.status),
      ) ||
      customerQueues[0] ||
      null,
    [customerQueues, state.customerQueueId],
  );
  const cancelCustomerQueue = () => {
    if (customerQueue)
      setQueueStatus(
        customerQueue.shop.id,
        customerQueue.barberId,
        customerQueue.entry.id,
        "Cancelled",
      );
  };
  const globalNotifications = state.adminData?.notifications || [];
  const audienceNotifications = globalNotifications.filter(
    (n) => !n.audience || n.audience.includes(sessionRole),
  );
  const dismissedForRole =
    sessionRole === "owner" ||
    sessionRole === "shop" ||
    sessionRole === "customer"
      ? state.notificationDismissed?.[sessionRole] || []
      : [];
  const filterDismissed = (list) =>
    list.filter((n) => !dismissedForRole.includes(n.id));
  const visibleNotifications =
    sessionRole === "customer"
      ? filterDismissed([
          ...state.customerNotifications,
          ...audienceNotifications,
        ])
      : sessionRole === "owner"
        ? filterDismissed([
            ...(current?.notifications || []),
            ...audienceNotifications,
          ])
        : sessionRole === "shop"
          ? filterDismissed([
              ...(current?.notifications || []).filter(
                (n) => n.source !== "admin",
              ),
              ...audienceNotifications.filter((n) => n.type !== "announcement"),
            ])
          : globalNotifications;
  const customerPayments = state.customer?.id
    ? state.shops.flatMap((s) =>
        (s.payments || [])
          .filter((p) => p.customerId === state.customer.id)
          .map((p) => ({ ...p, shop: s.name, shopContact: s.contact })),
      )
    : [];
  const completedCustomerVisits = state.customer?.id
    ? state.shops.flatMap((s) =>
        Object.values(s.queues || {})
          .flat()
          .filter(
            (e) =>
              e.customerId === state.customer.id && e.status === "Completed",
          )
          .map((e) => ({
            shop: s,
            entry: e,
            service: s.servicesList.find((x) => x.id === e.service),
            barber: s.barbersList.find((b) => b.id === e.barberId),
          })),
      )
    : [];
  const value = {
    ...state,
    owner: sessionRole === "owner" ? sessionUser : state.owner,
    customer: sessionRole === "customer" ? sessionUser : state.customer,
    shop: current,
    shops: state.shops,
    serverUsers,
    shopsLoading,
    shopLoadError,
    barbers: current?.barbersList || [],
    services: current?.servicesList || [],
    queues: current?.queues || {},
    payments: current?.payments || [],
    customerPayments,
    reviews: current?.reviewsList || [],
    notifications: visibleNotifications,
    finished: current?.finished || 0,
    sessionRole,
    sessionShopId,
    currentShopId: effectiveShopId,
    ownerShopIds,
    selectShop,
    applyPolicyToAllShops,
    deleteShop,
    up,
    submitShop,
    adminUpdateShop,
    sendAnnouncement,
    removeNotification,
    addServiceToShop,
    addServiceToAllShops,
    setQueueStatus,
    addServiceToQueue,
    contactCustomer,
    addComplaint,
    saveBarber,
    pendingBookings,
    myBookings,
    acceptBooking,
    declineBooking,
    deletePayment,
    refreshBookings: () => syncRef.current?.(),
    customerQueue,
    customerComplaints: state.customerComplaints || [],
    completedCustomerVisits,
    customerQueues,
    cancelCustomerQueue,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useOwner = () => useContext(Ctx);
