const express = require('express');
const router = express.Router();

const {
  addInventoryItem,
  getInventoryItems,
  recordInventoryMovement,
  getItemMovements
} = require('../controllers/inventoryController');

const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');
const { checkSubscription } = require('../middlewares/subscriptionMiddleware');

// Security Middleware
router.use(protect);

// Inventory Items Routes
router.post('/items', authorize('OWNER'), checkSubscription, addInventoryItem);
router.get('/farms/:farm_id/items', authorize('OWNER', 'SUPERVISOR'), checkSubscription, getInventoryItems);

// Inventory Movements Routes
router.post('/movements', authorize('OWNER', 'SUPERVISOR'), checkSubscription, recordInventoryMovement);
router.get('/items/:item_id/movements', authorize('OWNER'), getItemMovements);

module.exports = router;