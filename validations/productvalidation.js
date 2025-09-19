/**
 * backend/validators/productValidator.js
 *
 * Robust adapter for product validation.
 * Tries many candidate paths (validations/, validators/, validation/, utils/) and
 * exposes a stable API:
 *   - validateProduct(data) -> { error, value }
 *   - validateBulkProductData(reqOrPayload) -> { error, value }
 *   - validateProductId(id) -> { error, value }
 *
 * Paste this file at: backend/validators/productValidator.js
 */

const mongoose = require('mongoose');

const CANDIDATES = [
  // validators/
  '../validators/productValidator',
  '../validators/productvalidation',
  '../validators/productValidation',
  '../../validators/productvalidation',
  '../../validators/productValidation',

  // validations/ (your folder)
  '../validations/productvalidation',
  '../validations/productValidation',
  '../../validations/productvalidation',
  '../../validations/productValidation',
  './validations/productvalidation',
  './validations/productValidation',

  // singular "validation"/other common places
  '../validation/productvalidation',
  '../validation/productValidation',
  '../../validation/productvalidation',
  '../../validation/productValidation',
  './validation/productvalidation',
  './validation/productValidation',

  // direct filenames in repo root or utils
  './productvalidation',
  './productValidation',
  '../productvalidation',
  '../productValidation',
  '../utils/validators',
  '../../utils/validators',
  './utils/validators'
];

let src = null;
let loadedFrom = null;

for (const p of CANDIDATES) {
  try {
    // try to require candidate path; first successful wins
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const mod = require(p);
    if (mod) {
      src = mod;
      loadedFrom = p;
      break;
    }
  } catch (e) {
    // ignore and continue trying other paths
  }
}

if (loadedFrom) {
  // helpful during dev; remove or lower log level in production if noisy
  console.log(`✅ productValidator adapter: loaded validation module from: ${loadedFrom}`);
} else {
  console.warn('⚠️ productValidator adapter: no validation module found in candidates; using permissive fallbacks.');
}

/**
 * Normalize many possible validator return shapes into Joi-like { error, value }.
 */
function normalizeValidateResult(res, input) {
  if (!res) return { error: null, value: input };

  // Joi-style: { error, value } or { errors, value }
  if (res && (res.error || res.value || res.errors)) {
    const err = res.error || res.errors || null;
    const val = typeof res.value !== 'undefined' ? res.value : input;
    return { error: err, value: val };
  }

  // boolean true/false
  if (res === true) return { error: null, value: input };
  if (res === false) return { error: { message: 'Validation failed' }, value: null };

  // array of messages => treat as errors
  if (Array.isArray(res)) {
    return { error: { details: res.map(m => ({ message: typeof m === 'string' ? m : JSON.stringify(m) })) }, value: input };
  }

  // object -> treat as cleaned value
  if (typeof res === 'object') {
    return { error: null, value: res };
  }

  // fallback
  return { error: null, value: input };
}

/**
 * validateProduct(data) - unify many possible exports
 */
function validateProduct(data) {
  if (!src) return { error: null, value: data };

  // Common exported function names to try
  const fnNames = [
    'validateProduct',
    'validate',
    'validateProductData',
    'validateProductSchema',
    'productValidate',
    'productValidation',
    'validateSchema',
    'schema'
  ];

  for (const name of fnNames) {
    const fn = src[name];
    if (typeof fn === 'function') {
      try {
        const out = fn(data);
        return normalizeValidateResult(out, data);
      } catch (e) {
        return { error: { message: e.message || String(e) }, value: null };
      }
    }
  }

  // If module itself is a Joi schema (has isJoi)
  if (src && src.isJoi && typeof src.validate === 'function') {
    const out = src.validate(data, { abortEarly: false });
    return { error: out.error || null, value: out.value };
  }

  // If module exports productSchema Joi object
  if (src.productSchema && typeof src.productSchema.validate === 'function') {
    const out = src.productSchema.validate(data, { abortEarly: false });
    return { error: out.error || null, value: out.value };
  }

  // fallback permissive
  return { error: null, value: data };
}

/**
 * validateBulkProductData(reqOrPayload)
 *
 * Accepts either:
 * - request-like object (checks req.file or req.files)
 * - payload with items array
 * Also tries module-provided bulk validators.
 */
function validateBulkProductData(reqOrPayload) {
  if (!src) {
    if (reqOrPayload && (reqOrPayload.file || (reqOrPayload.files && reqOrPayload.files.length > 0))) {
      return { error: null, value: reqOrPayload };
    }
    if (reqOrPayload && Array.isArray(reqOrPayload.items) && reqOrPayload.items.length > 0) {
      return { error: null, value: reqOrPayload.items };
    }
    return { error: { message: 'Bulk product data missing: provide file or items array' }, value: null };
  }

  const bulkFns = ['validateBulkProductData', 'validateBulk', 'validateBulkUpload', 'bulkValidate'];
  for (const name of bulkFns) {
    if (typeof src[name] === 'function') {
      try {
        const out = src[name](reqOrPayload);
        return normalizeValidateResult(out, reqOrPayload);
      } catch (e) {
        return { error: { message: e.message || String(e) }, value: null };
      }
    }
  }

  // fallback minimal checks if module doesn't provide bulk fn
  if (reqOrPayload && (reqOrPayload.file || (reqOrPayload.files && reqOrPayload.files.length > 0))) {
    return { error: null, value: reqOrPayload };
  }
  if (reqOrPayload && Array.isArray(reqOrPayload.items) && reqOrPayload.items.length > 0) {
    return { error: null, value: reqOrPayload.items };
  }

  return { error: { message: 'Bulk product data missing: provide file or items array' }, value: null };
}

/**
 * validateProductId(id)
 */
function validateProductId(id) {
  if (!id) return { error: { message: 'productId is required' }, value: null };
  if (!mongoose.Types.ObjectId.isValid(id)) return { error: { message: 'Invalid productId' }, value: null };
  return { error: null, value: id };
}

module.exports = {
  validateProduct,
  validateBulkProductData,
  validateProductId
};
