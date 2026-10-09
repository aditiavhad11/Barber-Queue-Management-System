export function to12Hour(value = "09:00") {
  const [hRaw, m = "00"] = String(value).split(":");
  const h = Number(hRaw);
  if (!Number.isFinite(h)) return { time: "09:00", period: "AM" };
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return { time: `${String(hour).padStart(2, "0")}:${m.padStart(2, "0")}`, period };
}

export function from12Hour(time = "09:00", period = "AM") {
  const [hRaw, m = "00"] = String(time).split(":");
  let h = Number(hRaw);
  if (!Number.isFinite(h)) h = 9;
  h %= 12;
  if (String(period).toUpperCase() === "PM") h += 12;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function compareTimes(a, aPeriod, b, bPeriod) {
  return from12Hour(a, aPeriod).localeCompare(from12Hour(b, bPeriod));
}
