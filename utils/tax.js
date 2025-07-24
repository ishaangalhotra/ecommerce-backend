const calculateTax = (amount, taxRate = 0.18) => {
  return amount * taxRate;
};

const getTaxRate = (location) => {
  // Default GST rate for India
  return 0.18;
};

module.exports = { calculateTax, getTaxRate };
