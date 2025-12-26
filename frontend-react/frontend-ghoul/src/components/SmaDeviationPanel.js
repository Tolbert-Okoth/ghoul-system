import React, { useEffect, useState } from 'react';
import axios from 'axios';

const SmaDeviationPanel = ({ symbol }) => {
    const [deviation, setDeviation] = useState(0);
    const [trend, setTrend] = useState("NEUTRAL");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchSMA = async () => {
            try {
                // Fetch history for the specific symbol
                const res = await axios.get(`https://ghoul-system.onrender.com/api/v1/history?symbol=${symbol}`);
                const data = res.data;

                if (data.length < 20) {
                    setDeviation(0);
                    setLoading(false);
                    return;
                }

                // Calculate SMA 20 (Simple Moving Average)
                const last20 = data.slice(-20);
                const sum = last20.reduce((acc, point) => acc + point.value, 0);
                const sma20 = sum / 20;
                const currentPrice = data[data.length - 1].value;

                // Calculate Deviation Percentage
                const dev = ((currentPrice - sma20) / sma20) * 100;
                setDeviation(dev);
                setTrend(dev > 0 ? "OVERBOUGHT" : "OVERSOLD");
                setLoading(false);
            } catch (err) {
                console.error(err);
                setLoading(false);
            }
        };

        fetchSMA();
        // Re-calculate every minute
        const interval = setInterval(fetchSMA, 60000);
        return () => clearInterval(interval);
    }, [symbol]);

    // Dynamic Color Logic
    const getColor = () => {
        if (Math.abs(deviation) > 5) return 'var(--neon-red)'; // Extreme deviation
        if (Math.abs(deviation) > 2) return 'var(--neon-yellow)'; // Warning
        return 'var(--neon-blue)'; // Normal
    };

    return (
        <div className="panel sma-panel">
            <div className="panel-header">MEAN_REVERSION // {symbol}</div>
            
            {loading ? (
                <div className="loading-text">CALCULATING...</div>
            ) : (
                <div style={{ textAlign: 'center', padding: '10px 0' }}>
                    <div style={{ 
                        fontSize: '2.5rem', 
                        fontWeight: 'bold', 
                        color: getColor(),
                        textShadow: `0 0 20px ${getColor()}`
                    }}>
                        {deviation > 0 ? "+" : ""}{deviation.toFixed(2)}%
                    </div>
                    <div className="sub-label">DEVIATION FROM 20-DAY SMA</div>
                    <div className="status-badge" style={{ 
                        borderColor: getColor(), 
                        color: getColor(),
                        marginTop: '10px',
                        display: 'inline-block'
                    }}>
                        {Math.abs(deviation) < 1 ? "STABLE" : trend}
                    </div>
                </div>
            )}
        </div>
    );
};

export default SmaDeviationPanel;