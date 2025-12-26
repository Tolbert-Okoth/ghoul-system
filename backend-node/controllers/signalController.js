const Signal = require('../models/signalModel');

let isAiOnline = true; // Local state for the Kill Switch

exports.processSignal = async (req, res, io) => {
    if (!isAiOnline) {
        return res.status(503).json({ error: "System is Blind. Execution Paused." });
    }

    try {
        const result = await Signal.saveSignal(req.body);
        const savedSignal = result.rows[0];

        // Broadcast to the Dark Kaneki Frontend
        io.emit('new_signal', savedSignal);

        res.status(201).json(savedSignal);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.updateHealth = (req, res, io) => {
    const { status } = req.body;
    isAiOnline = (status === 'HEALTHY');
    io.emit('system_status', { isAiOnline });
    res.json({ message: `System is now ${status}` });
};