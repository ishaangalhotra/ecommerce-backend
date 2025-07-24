// utils/helpers.js
const generateSlug = (text) => {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
};

const formatPrice = (price) => {
  return parseFloat(price).toFixed(2);
};

module.exports = {
  generateSlug,
  formatPrice
};
