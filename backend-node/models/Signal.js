const { DataTypes } = require('sequelize');
const db = require('../config/database');

const Signal = db.define('Signal', {
    ticker: { type: DataTypes.STRING, defaultValue: 'US500' },
    headline: { type: DataTypes.TEXT },
    sentiment_score: { type: DataTypes.FLOAT }, // -1.0 to 1.0
    confidence: { type: DataTypes.FLOAT },
    execution_price: { type: DataTypes.FLOAT },
    status: { type: DataTypes.STRING } // 'EXECUTED', 'VETOED', 'PAUSED'
});

module.exports = Signal;