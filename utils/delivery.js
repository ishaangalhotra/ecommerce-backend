// utils/delivery.js
const calculateDeliveryFee = (distance, weight) => {
  // Basic delivery calculation
  const baseFee = 50;
  const distanceFee = distance * 5;
  const weightFee = weight * 2;
  return baseFee + distanceFee + weightFee;
};

module.exports = {
  calculateDeliveryFee
};
