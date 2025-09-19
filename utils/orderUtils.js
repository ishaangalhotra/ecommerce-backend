// utils/orderUtils.js
// Small helper utilities for orders used by seller routes.
// Add/extend functions as your route expects.

function calculateOrderTotals(cartItems = [], options = {}) {
  // cartItems: [{ price, qty, discount = 0, tax = 0 }]
  const totals = cartItems.reduce(
    (acc, it) => {
      const price = Number(it.price || 0);
      const qty = Number(it.qty || it.quantity || 0);
      const discount = Number(it.discount || 0);
      const tax = Number(it.tax || 0);

      const lineNet = price * qty - discount;
      const lineTax = (lineNet * tax) / 100;
      acc.subtotal += lineNet;
      acc.tax += lineTax;
      acc.itemsCount += qty;
      return acc;
    },
    { subtotal: 0, tax: 0, itemsCount: 0 }
  );

  totals.delivery = Number(options.delivery || 0);
  totals.total = Number((totals.subtotal + totals.tax + totals.delivery).toFixed(2));
  return totals;
}

function formatOrderInput(payload = {}) {
  // normalize shape before saving
  const order = { ...payload };
  if (order.items && Array.isArray(order.items)) {
    order.items = order.items.map(it => ({
      productId: it.productId || it.id || it._id,
      name: it.name,
      price: Number(it.price || 0),
      qty: Number(it.qty || it.quantity || 1),
      discount: Number(it.discount || 0),
      tax: Number(it.tax || 0)
    }));
  } else {
    order.items = [];
  }

  if (payload.customer) {
    order.customer = {
      name: payload.customer.name || payload.customer.fullName,
      email: payload.customer.email,
      phone: payload.customer.phone
    };
  }

  order.metadata = order.metadata || {};
  return order;
}

function formatOrderResponse(orderDoc = {}) {
  // strip Mongoose internals if passed a doc
  const obj = orderDoc && orderDoc.toObject ? orderDoc.toObject() : { ...orderDoc };
  delete obj.__v;
  return obj;
}

function ordersToCsv(orders = [], fields = null) {
  // small, dependency-free json->csv for export (simple values only)
  if (!Array.isArray(orders) || orders.length === 0) return '';
  const keys = Array.isArray(fields) && fields.length ? fields : Object.keys(orders[0]);
  const header = keys.join(',');
  const lines = orders.map(o =>
    keys.map(k => {
      const v = o[k] == null ? '' : String(o[k]);
      if (/[,\n\r"]/g.test(v)) return `"${v.replace(/"/g, '""')}"`;
      return v;
    }).join(',')
  );
  return [header, ...lines].join('\n');
}

module.exports = {
  calculateOrderTotals,
  formatOrderInput,
  formatOrderResponse,
  ordersToCsv
};
