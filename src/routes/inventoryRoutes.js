const express = require('express');
const router = express.Router();

const {
  addInventoryItem,
  getInventoryItems,
  recordInventoryMovement,
  getItemMovements,
  updateInventoryItem,
  deleteInventoryItem,
  transferToBarn,
  confirmInventoryMovement,
  produceFeed,
  getPendingMovements,
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
router.put('/items/:id', authorize('OWNER'), checkSubscription, updateInventoryItem);
router.delete('/items/:id', authorize('OWNER'), checkSubscription, deleteInventoryItem);
router.post('/transfer-to-barn', authorize('OWNER', 'SUPERVISOR'), checkSubscription, transferToBarn);
router.put('/movements/:id/confirm', authorize('OWNER', 'SUPERVISOR'), checkSubscription, confirmInventoryMovement);
router.post('/produce-feed', authorize('OWNER', 'SUPERVISOR'), checkSubscription, produceFeed);
router.get('/farms/:farm_id/movements/pending', authorize('OWNER', 'SUPERVISOR'), checkSubscription, getPendingMovements);

module.exports = router;