// validations/productValidation.js
const Joi = require('joi');

const productValidationSchema = Joi.object({
  name: Joi.string().min(3).max(100).required(),
  price: Joi.number().min(0).required(),
  description: Joi.string().allow('', null),
  category: Joi.string().required(),
  imageUrl: Joi.string().uri().optional(),
  stock: Joi.number().integer().min(0).default(0),
  status: Joi.string().valid('active', 'inactive', 'pending', 'rejected').default('pending')
});

const validateProduct = (productData) => {
  return productValidationSchema.validate(productData, { abortEarly: false });
};

module.exports = {
  validateProduct
};
