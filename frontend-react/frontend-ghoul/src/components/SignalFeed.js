import React, { useEffect, useState } from 'react';
import axios from 'axios';
import io from 'socket.io-client';

const SignalFeed = () => {
    const [signals, setSignals] = useState([]);

    // Initial Fetch
    useEffect(() => {
        const fetchSignals = async () => {
            try {
                const res = await axios.get('https://ghoul-system.onrender.com/api/v1/signals/latest');
                setSignals(res.data);
            } catch (e) { console.error(e); }
        };
        fetchSignals();

        // Real-time Updates
        const socket = io('https://ghoul-system.onrender.com');
        socket.on('new_signal', (newSignal) => {
            setSignals(prev => [newSignal, ...prev].slice(0, 50)); // Keep last 50
        });

        return () => socket.close();
    }, []);

    const getSentimentColor = (s) => {
        if (s > 0) return 'bullish';
        if (s < 0) return 'bearish';
        return 'watch';
    };

    return (
        <div className="panel feed-panel">
            <div className="panel-header">INCOMING_DATA_STREAM</div>
            
            {/* SCROLL AREA: This div allows scrolling while header stays fixed */}
            <div className="signal-scroll-area">
                <div className="signal-grid">
                    {signals.map((sig) => (
                        <div key={sig.id} className={`signal-card ${getSentimentColor(sig.sentiment)}`}>
                            <div className="signal-header">
                                <span className="sig-type">{sig.status}</span>
                                <span className="sig-conf">{(sig.confidence * 100).toFixed(0)}% CONF</span>
                            </div>
                            <div className="sig-headline">{sig.headline}</div>
                            <div className="sig-meta">
                                {new Date(sig.created_at).toLocaleTimeString()} :: ID {sig.id}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default SignalFeed;