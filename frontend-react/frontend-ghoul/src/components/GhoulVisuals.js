import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { SERVER_URL } from '../config';

const GhoulVisuals = ({ symbol }) => {
    const [sentiment, setSentiment] = useState("NEUTRAL");
    const [reason, setReason] = useState("Analyzing market data...");
    const [confidence, setConfidence] = useState(0);
    const [tags, setTags] = useState([]);
    const [error, setError] = useState(null); // New Error State

    useEffect(() => {
        const fetchData = async () => {
            try {
                setError(null); // Clear errors on new attempt
                
                // 1. Get Verdict & Reasoning
                const verdictRes = await axios.get(`${SERVER_URL}/api/v1/intel/overall-verdict?symbol=${encodeURIComponent(symbol)}`);
                setSentiment(verdictRes.data.verdict || "NEUTRAL");
                setReason(verdictRes.data.reason || "No clear signal detected.");
                setConfidence(verdictRes.data.confidence || 0);

                // 2. Get Hot Topics
                const tagsRes = await axios.get(`${SERVER_URL}/api/v1/intel/hot-topics`);
                setTags(tagsRes.data.slice(0, 5)); 
            } catch (e) { 
                console.error("GhoulVisuals Error:", e);
                // 👇 This will tell us if it's CORS, Network, or Server Error
                if (e.message === "Network Error") {
                    setReason("⚠️ NETWORK ERROR: Check CORS or Backend Status");
                    setError("OFFLINE");
                } else {
                    setReason(`⚠️ API ERROR: ${e.response ? e.response.status : e.message}`);
                    setError("CRASH");
                }
            }
        };
        
        fetchData();
        const interval = setInterval(fetchData, 5000); 
        return () => clearInterval(interval);
    }, [symbol]);

    // Dynamic Color Logic
    const getGlowColor = () => {
        if (error) return "var(--neon-red)"; // Error State
        if (sentiment === "BUY") return "var(--neon-green)";
        if (sentiment === "SELL") return "var(--neon-red)";
        if (sentiment === "WATCH" || sentiment === "HOLD") return "var(--neon-yellow)";
        if (sentiment.includes("STRONG") && sentiment.includes("BULL")) return "var(--neon-green)";
        if (sentiment.includes("WEAK") && sentiment.includes("BULL")) return "var(--neon-yellow)"; 
        if (sentiment.includes("BULL")) return "var(--neon-green)";
        if (sentiment.includes("STRONG") && sentiment.includes("BEAR")) return "var(--neon-red)";
        if (sentiment.includes("WEAK") && sentiment.includes("BEAR")) return "var(--down)"; 
        if (sentiment.includes("BEAR")) return "var(--neon-red)";
        return "var(--dim)";
    };

    return (
        <div className="panel visuals-panel">
            <div className="panel-header">AI READ · <b>{symbol}</b></div>

            {/* AI CONSENSUS */}
            <div style={{ marginBottom: '15px' }}>
                <div className="sub-label">CALL</div>
                <div className="neon-text" style={{ 
                    color: getGlowColor(), 
                    fontSize: '2.2rem', lineHeight: 1, 

                    letterSpacing: '1px'
                }}>
                    {error ? "SYSTEM_FAILURE" : sentiment}
                </div>
            </div>

            {/* THE REASONING ENGINE */}
            <div style={{ marginBottom: '20px', padding: '10px', background: 'transparent', borderLeft: `2px solid ${getGlowColor()}` }}>
                <div className="sub-label" style={{ marginBottom: '5px' }}>WHY</div>
                <div style={{ 
                    fontFamily: 'var(--font-code)', 
                    fontSize: '0.8rem', 
                    color: error ? 'var(--down)' : 'var(--paper)', 
                    lineHeight: '1.4' 
                }}>
                    "{reason}"
                </div>
            </div>

            {/* AI TRUST INDICATOR */}
            <div style={{ marginBottom: '20px' }}>
                <div className="flex-between">
                    <span className="sub-label">CONFIDENCE&nbsp;</span>
                    <span style={{ color: confidence > 80 ? 'var(--neon-green)' : 'var(--neon-yellow)' }}>
                        {confidence}%
                    </span>
                </div>
                <div className="progress-bar-bg">
                    <div className="progress-bar-fill" style={{ 
                        width: `${confidence}%`,
                        backgroundColor: confidence > 80 ? 'var(--neon-green)' : 'var(--neon-yellow)',
                        boxShadow: `0 0 10px ${confidence > 80 ? 'var(--neon-green)' : 'var(--neon-yellow)'}`
                    }}></div>
                </div>
            </div>

            {/* TAGS */}
            <div className="tags-container">
                {tags.length > 0 ? tags.map((t, i) => (
                    <span key={i} className="narrative-tag">#{t.word.toUpperCase()}</span>
                )) : <span className="narrative-tag" style={{ opacity: 0.5 }}>NO_DATA</span>}
            </div>
        </div>
    );
};

export default GhoulVisuals;