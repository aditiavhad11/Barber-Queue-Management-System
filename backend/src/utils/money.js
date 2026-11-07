/**
 * Rounds a monetary amount to 2 decimal places.
 * Handles numbers and numeric strings safely.
 */
export const money = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export default money;

