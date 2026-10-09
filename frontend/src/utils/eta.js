export const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`);
export const turnTime = (m) => new Date(Date.now() + m * 60000).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
export const ACTIVE = ["Waiting", "Your Turn", "In Service"];
export const activeOf = (q = []) => q.filter((e) => ACTIVE.includes(e.status));
export const durOf = (services = [], id) => Number(services.find((s) => s.id === id)?.duration) || 0;
export const waitMinutes = (services = [], q = []) => activeOf(q).reduce((t, e) => t + durOf(services, e.service), 0);
export const ahead = (q = []) => activeOf(q).length;
