export function getAllowedOrigins(env = process.env) {
  return String(env.CLIENT_URL || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function validateCorsEnvironment(env = process.env) {
  const origins = getAllowedOrigins(env);
  if (
    env.NODE_ENV === "production" &&
    (!origins.length || origins.includes("*"))
  ) {
    throw new Error(
      "Production requires explicit, non-wildcard CLIENT_URL origins.",
    );
  }
  return origins;
}

export function createCorsOriginCallback(origins) {
  const allowed = new Set(origins);
  return (origin, callback) => {
    if (!origin || allowed.has(origin)) return callback(null, true);
    callback(new Error("CORS origin not allowed."));
  };
}
