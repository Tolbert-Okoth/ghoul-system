import React, { useEffect, useState } from 'react';
import io from 'socket.io-client';
import SignalCard from './SignalCard'; 

// ⚠️ Verify this URL matches your active Render dashboard URL exactly
const SERVER_URL = 'https://ghoul-system.onrender.com';

const SignalFeed = () => {
    const [signals, setSignals] = useState([]);

    useEffect(() => {
        const socket = io(SERVER_URL);

        // Listeners
        const handleNewSignal = (data) => {
            setSignals((prev) => {
                const exists = prev.find(s => s.id === data.id);
                if (exists) return prev;
                // Keep only the latest 50 signals
                return [data, ...prev].slice(0, 50);
            });
        };

        const handleHistory = (data) => {
            if (data.signals && Array.isArray(data.signals)) {
                setSignals(data.signals);
            }
        };

        socket.on('new_signal', handleNewSignal);
        socket.on('history_dump', handleHistory);

        socket.on('connect', () => {
            socket.emit('request_history');
        });

        return () => socket.disconnect();
    }, []);

    return (
        <div className="panel feed-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div className="panel-header" style={{ marginBottom: '10px' }}>
                INCOMING_DATA_STREAM
            </div>
            
            <div className="signal-scroll-area" style={{ flex: 1, overflowY: 'auto', paddingRight: '5px' }}>
                <div className="signal-grid">
                    {signals.length > 0 ? (
                        signals.map((sig, i) => (
                            <SignalCard key={sig.id || i} data={sig} />
                        ))
                    ) : (
                        <div style={{ color: '#6b7280', fontSize: '12px', textAlign: 'center', marginTop: '20px', fontFamily: 'monospace' }}>
                            ESTABLISHING UPLINK...
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SignalFeed;