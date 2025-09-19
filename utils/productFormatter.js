// utils/productFormatter.js
// Small helper to normalise/format product payloads before persistence or response

/**
 * Format incoming product payload before saving to DB.
 * This is intentionally minimal — adapt fields and sanitization to your schema.
 */
function formatProductInput(payload = {}) {
  const formatted = {};

  if (payload.name) formatted.name = String(payload.name).trim();
  if (payload.description) formatted.description = String(payload.description).trim();
  if (payload.price !== undefined) formatted.price = Number(payload.price);
  if (payload.currency) formatted.currency = String(payload.currency).toUpperCase();
  if (payload.category) formatted.category = String(payload.category).trim();
  if (payload.brand) formatted.brand = String(payload.brand).trim();
  if (payload.stock !== undefined) formatted.stock = parseInt(payload.stock, 10) || 0;
  if (Array.isArray(payload.tags)) formatted.tags = payload.tags.map(t => String(t).trim());
  if (Array.isArray(payload.images)) formatted.images = payload.images;

  // sellerId may come from auth middleware; keep if provided
  if (payload.sellerId) formatted.sellerId = payload.sellerId;

  // add minimal defaults
  formatted.active = payload.active === undefined ? true : !!payload.active;

  return formatted;
}

/**
 * Format product for responses (remove internal fields)
 */
function formatProductResponse(product = {}) {
  const p = product.toObject ? product.toObject() : { ...product };
  // Remove internal fields if present
  delete p.__v;
  // delete or mask any fields you don't want to expose
  return p;
}

module.exports = {
  formatProductInput,
  formatProductResponse
};
