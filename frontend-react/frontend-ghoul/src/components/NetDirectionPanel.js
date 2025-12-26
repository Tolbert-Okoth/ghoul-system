import React, { useEffect, useState } from 'react';
import axios from 'axios';

const NetDirectionPanel = ({ symbol }) => { // Receives Symbol
    const [score, setScore] = useState(0);
    const [status, setStatus] = useState("NEUTRAL");

    useEffect(() => {
        const fetchVerdict = async () => {
            try {
                const res = await axios.get(`https://ghoul-system.onrender.com/api/v1/intel/overall-verdict?symbol=${symbol}`);
                setScore(res.data.score || 0);
                setStatus(res.data.verdict || "NEUTRAL");
            } catch (e) { console.error(e); }
        };
        
        fetchVerdict();
        // Poll every 30s to keep verdict fresh
        const interval = setInterval(fetchVerdict, 30000); 
        return () => clearInterval(interval);
    }, [symbol]);

    const getColor = () => {
        if (score > 2) return 'var(--neon-green)';
        if (score < -2) return 'var(--neon-red)';
        return '#888';
    };

    const getSliderPosition = () => {
        const clamped = Math.max(-10, Math.min(10, score)); // Score ranges from roughly -10 to +10
        return `${((clamped + 10) / 20) * 100}%`;
    };

    return (
        <div className="panel direction-panel">
            <div className="panel-header" style={{ marginBottom: 0 }}>NET_DIRECTION // {symbol}</div>
            
            <div className="slider-wrapper">
                <div className="slider-labels">
                    <span>BEAR</span>
                    <span>NEUTRAL</span>
                    <span>BULL</span>
                </div>
                <div className="slider-track">
                    <div className="slider-tick center"></div>
                    <div className="slider-marker" style={{ 
                        left: getSliderPosition(), 
                        backgroundColor: getColor(),
                        boxShadow: `0 0 15px ${getColor()}`
                    }}></div>
                </div>
            </div>

            <div style={{ textAlign: 'center' }}>
                <div className="status-main" style={{ 
                    color: getColor(),
                    textShadow: `0 0 25px ${getColor()}`
                }}>
                    {status}
                </div>
                <div className="status-sub">SENTIMENT SCORE: {score.toFixed(1)}</div>
            </div>
        </div>
    );
};

export default NetDirectionPanel;