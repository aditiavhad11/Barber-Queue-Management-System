export const ACTIVE = ["Waiting", "Your Turn", "In Service"];
export const activeOf = (q = []) => q.filter((e) => ACTIVE.includes(e.status));
export const durOf = (services = [], id) => Number(services.find((s) => s.id === id)?.duration) || 0;
// ETA is based only on the service durations of active customers ahead in this barber's queue.
export const etaFor = (services = [], q = [], index = 0) => activeOf(q).slice(0, Math.max(0, index)).reduce((total, entry) => total + (Number(entry.serviceDuration) || durOf(services, entry.service)), 0);
