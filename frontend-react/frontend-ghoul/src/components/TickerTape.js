import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { SERVER_URL } from '../config';

// Scrolling strip of the latest AI call per symbol: the desk's "wire at a glance"
const TickerTape = () => {
    const [items, setItems] = useState([]);

    useEffect(() => {
        let alive = true;
        const load = async () => {
            try {
                const { data } = await axios.get(`${SERVER_URL}/api/v1/intel/latest`);
                const latest = new Map();
                (Array.isArray(data) ? data : []).forEach(s => { if (s.symbol && !latest.has(s.symbol)) latest.set(s.symbol, s); });
                if (alive) setItems([...latest.values()]);
            } catch { /* tape stays empty offline */ }
        };
        load();
        const t = setInterval(load, 30000);
        return () => { alive = false; clearInterval(t); };
    }, []);

    if (items.length === 0) return null;
    const row = [...items, ...items]; // repeat so the loop has no gap
    const dir = (v) => (v === 'BUY' ? 'up' : v === 'SELL' ? 'down' : 'flat');

    return (
        <div className="tape" aria-label="Latest calls">
            <div className="tape-label">WIRE</div>
            <div className="tape-track">
                {row.map((s, i) => (
                    <span className="tape-item" key={`${s.id}-${i}`}>
                        <b>{s.symbol}</b>
                        <span className={dir(s.verdict)}>{s.verdict === 'BUY' ? '▲' : s.verdict === 'SELL' ? '▼' : '■'} {s.verdict}</span>
                        <small>{Math.round(Number(s.confidence || 0) * 100)}% · {s.entry_price ? `$${Number(s.entry_price).toFixed(2)}` : '—'}</small>
                    </span>
                ))}
            </div>
        </div>
    );
};

export default TickerTape;
