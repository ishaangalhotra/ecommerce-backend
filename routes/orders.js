const express = require("express");
const router = express.Router();
const { placeOrder, getUserOrders } = require("../controllers/orderController");
const authMiddleware = require("../middlewares/authMiddleware");

router.post("/", authMiddleware, placeOrder);
router.get("/", authMiddleware, getUserOrders);

module.exports = router;
