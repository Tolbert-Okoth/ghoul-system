const express = require('express');
const router = express.Router();
const signalController = require('../controllers/signalController');

module.exports = (io) => {
    router.post('/incoming', (req, res) => signalController.processSignal(req, res, io));
    router.post('/health', (req, res) => signalController.updateHealth(req, res, io));
    return router;
};