const express = require('express');
const router = express.Router();

// Sample route - customize as needed
router.get('/', (req, res) => {
  res.send('Order route working!');
});

module.exports = router;