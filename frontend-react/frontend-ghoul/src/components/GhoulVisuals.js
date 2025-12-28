import React, { useEffect, useState } from 'react';
import axios from 'axios';

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
                const verdictRes = await axios.get(`https://ghoul-system.onrender.com/api/v1/intel/overall-verdict?symbol=${symbol}`);
                setSentiment(verdictRes.data.verdict || "NEUTRAL");
                setReason(verdictRes.data.reason || "No clear signal detected.");
                setConfidence(verdictRes.data.confidence || 0);

                // 2. Get Hot Topics
                const tagsRes = await axios.get('https://ghoul-system.onrender.com/api/v1/intel/hot-topics');
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
        if (sentiment.includes("STRONG") && sentiment.includes("BULL")) return "var(--neon-green)";
        if (sentiment.includes("WEAK") && sentiment.includes("BULL")) return "var(--neon-yellow)"; 
        if (sentiment.includes("BULL")) return "var(--neon-green)";
        if (sentiment.includes("STRONG") && sentiment.includes("BEAR")) return "var(--neon-red)";
        if (sentiment.includes("WEAK") && sentiment.includes("BEAR")) return "#ff8800"; 
        if (sentiment.includes("BEAR")) return "var(--neon-red)";
        return "#888";
    };

    return (
        <div className="panel visuals-panel">
            <div className="panel-header">NARRATIVE_CLUSTERS // {symbol}</div>

            {/* AI CONSENSUS */}
            <div style={{ marginBottom: '15px' }}>
                <div className="sub-label">AI_CONSENSUS</div>
                <div className="neon-text" style={{ 
                    color: getGlowColor(), 
                    fontSize: '1.4rem', 
                    textShadow: `0 0 15px ${getGlowColor()}`,
                    letterSpacing: '1px'
                }}>
                    {error ? "SYSTEM_FAILURE" : sentiment}
                </div>
            </div>

            {/* THE REASONING ENGINE */}
            <div style={{ marginBottom: '20px', padding: '10px', background: 'rgba(255,255,255,0.03)', borderLeft: `2px solid ${getGlowColor()}` }}>
                <div className="sub-label" style={{ marginBottom: '5px' }}>STRATEGIC_RATIONALE</div>
                <div style={{ 
                    fontFamily: 'var(--font-code)', 
                    fontSize: '0.8rem', 
                    color: error ? '#ff4444' : '#ddd', 
                    lineHeight: '1.4' 
                }}>
                    "{reason}"
                </div>
            </div>

            {/* AI TRUST INDICATOR */}
            <div style={{ marginBottom: '20px' }}>
                <div className="flex-between">
                    <span className="sub-label">CONFIDENCE_INTERVAL</span>
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