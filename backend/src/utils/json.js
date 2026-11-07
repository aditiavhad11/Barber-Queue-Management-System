/**
 * Safely parse a JSON string into an object/primitive, returning fallback on failure.
 * If value is already an object, returns it directly.
 */
export function parseJson(value, fallback = {}) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed !== undefined ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Safely parses a JSON array or array-like value into an array of string items.
 * If already an array, elements are converted to strings.
 * Returns empty array [] on parse error or non-array inputs.
 */
export function jsonArray(value) {
  if (Array.isArray(value)) return value.map(String);
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Alias for jsonArray, commonly used for parsing service/barber ID lists. */
export const jsonIds = jsonArray;
export const parseIds = jsonArray;

/**
 * Safely parse a JSON string into an object (excluding arrays).
 * Returns fallback if the result is not a non-array object.
 */
export function parseObject(value, fallback = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (!value) return fallback;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : fallback;
  } catch {
    return fallback;
  }
}

export default {
  parseJson,
  jsonArray,
  jsonIds,
  parseIds,
  parseObject,
};

