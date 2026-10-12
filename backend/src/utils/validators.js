export const PATTERNS = {
  // Email: compliant with standard formats, allows .local/.test domains
  EMAIL: /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/i,

  // Phone: 10-digit Indian mobile numbers starting with 6, 7, 8, or 9
  PHONE: /^[6-9]\d{9}$/,

  // Full phone with optional +91 or 91 country code prefix
  PHONE_WITH_PREFIX: /^(?:(?:\+91|91)?[6-9]\d{9})$/,

  // Person name: must contain at least 2 letters; allows spaces, dots, dashes, apostrophes (2-60 chars total)
  NAME: /^(?=(?:[^A-Za-z]*[A-Za-z]){2})[A-Za-z\s.'-]{2,60}$/,

  // Shop name: 2-100 alphanumeric chars with common punctuation
  SHOP_NAME: /^[A-Za-z0-9\s&'.,\-/()#]{2,100}$/,

  // Service name: 2-80 alphanumeric chars with common service characters
  SERVICE_NAME: /^[A-Za-z0-9\s&'+/.,()#-]{2,80}$/,

  // OTP code: exactly 6 digits
  OTP: /^\d{6}$/,

  // Price: positive number with up to 2 decimal places (e.g. 50, 150.50)
  PRICE: /^(?:[1-9]\d*|0)(?:\.\d{1,2})?$/,

  // Positive integer (duration, queue count, etc.)
  POSITIVE_INT: /^[1-9]\d*$/,

  // Age: 18 to 70
  AGE: /^(?:1[89]|[2-6]\d|70)$/,

  // Experience: 0 to 60 years
  EXPERIENCE: /^(?:[0-9]|[1-5][0-9]|60)$/,

  // Rating: 1 to 5
  RATING: /^[1-5]$/,

  // Date in ISO format: YYYY-MM-DD
  DATE: /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/,

  // 24-hour time format: HH:MM
  TIME: /^(?:[01]\d|2[0-3]):[0-5]\d$/,

  // UPI Virtual Payment Address (e.g. user@okhdfcbank, shop@upi)
  UPI_ID: /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/,

  // Queue token: A001, A012, etc.
  TOKEN: /^A\d{3,6}$/,
};

/**
 * Normalizes phone numbers by stripping country codes (+91 / 91) and non-digits.
 */
export const normalizePhone = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    return digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    return digits.slice(1);
  }
  return digits;
};

export const isValidEmail = (val) =>
  typeof val === "string" && PATTERNS.EMAIL.test(val.trim());

export const isValidPhone = (val) => {
  if (!val) return false;
  const normalized = normalizePhone(val);
  return PATTERNS.PHONE.test(normalized);
};

export const isValidName = (val) =>
  typeof val === "string" && PATTERNS.NAME.test(val.trim());

export const isValidShopName = (val) =>
  typeof val === "string" && PATTERNS.SHOP_NAME.test(val.trim());

export const isValidServiceName = (val) =>
  typeof val === "string" && PATTERNS.SERVICE_NAME.test(val.trim());

export const isValidOtp = (val) =>
  PATTERNS.OTP.test(String(val || "").trim());

export const isValidPrice = (val) =>
  PATTERNS.PRICE.test(String(val ?? "").trim()) && Number(val) > 0;

export const isValidDuration = (val) =>
  PATTERNS.POSITIVE_INT.test(String(val ?? "").trim());

export const isValidAge = (val) =>
  PATTERNS.AGE.test(String(val ?? "").trim());

export const isValidExperience = (val) =>
  PATTERNS.EXPERIENCE.test(String(val ?? "").trim());

export const isValidRating = (val) =>
  PATTERNS.RATING.test(String(val ?? "").trim());

export const isValidDate = (val) =>
  PATTERNS.DATE.test(String(val || "").trim());

export const isValidTime = (val) =>
  PATTERNS.TIME.test(String(val || "").trim());

export const isValidUpiId = (val) =>
  PATTERNS.UPI_ID.test(String(val || "").trim());
