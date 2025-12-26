import React, { useEffect, useState } from 'react';
import axios from 'axios';

const OverallVerdictPanel = () => {
    const [data, setData] = useState(null);

    useEffect(() => {
        const fetchVerdict = async () => {
            try {
                const response = await axios.get('https://ghoul-system.onrender.com/api/v1/intel/overall-verdict');
                setData(response.data);
            } catch (error) {
                console.error("Error fetching verdict:", error);
            }
        };

        fetchVerdict();
        // Auto-refresh every 30 seconds
        const interval = setInterval(fetchVerdict, 30000); 
        return () => clearInterval(interval);
    }, []);

    if (!data) {
        return <div className="panel loading">Loading AI Verdict...</div>;
    }

    const getVerdictColor = (verdict) => {
        if (verdict.includes('BULLISH')) return '#00FF88'; // Green
        if (verdict.includes('BEARISH')) return '#FF0055'; // Red
        return '#FFFFFF'; // White for Neutral
    };

    const getRiskColor = (risk) => {
        if (risk === 'HIGH') return '#FF0055';
        if (risk === 'MEDIUM') return '#FFAA00';
        return '#00FF88';
    };

    return (
        <div className="panel verdict-panel">
            <div className="panel-header">OVERALL AI VERDICT</div>
            
            <div className="verdict-main" style={{ color: getVerdictColor(data.verdict) }}>
                {data.verdict}
            </div>

            <div className="verdict-summary">
                {data.summary}
            </div>

            <div className="verdict-metrics">
                <div className="metric">
                    <span className="label">RISK LEVEL:</span>
                    <span className="value" style={{ color: getRiskColor(data.risk) }}>
                        {data.risk}
                    </span>
                </div>
                <div className="metric">
                    <span className="label">AVG. CONFIDENCE:</span>
                    <span className="value">{data.confidence}%</span>
                </div>
            </div>
        </div>
    );
};

export default OverallVerdictPanel;