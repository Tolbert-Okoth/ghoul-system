import React, { useEffect, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Line } from 'recharts';
import axios from 'axios';
import io from 'socket.io-client';
import { SERVER_URL } from '../config';

// ⚠️ Verify this matches your Render URL exactly (no trailing slash)


const GhoulChart = ({ symbol }) => { 
    const [data, setData] = useState([]);
    const [currentPrice, setCurrentPrice] = useState(0);
    const [range, setRange] = useState('1y'); 
    const [isSimulated, setIsSimulated] = useState(false); 

    const ranges = ['1d', '1mo', '3mo', '1y', 'ytd'];

    const calculateSMA = (data, period = 20) => {
        return data.map((point, index, array) => {
            if (index < period) return { ...point, sma: null };
            const slice = array.slice(index - period, index);
            const sum = slice.reduce((acc, curr) => acc + curr.value, 0);
            return { ...point, sma: sum / period };
        });
    };

    useEffect(() => {
        const fetchData = async () => {
            try {
                const res = await axios.get(`${SERVER_URL}/api/v1/history?symbol=${encodeURIComponent(symbol)}&range=${range}`);
                const rawData = res.data;

                if (rawData.length > 0 && rawData[0].isSimulated) {
                    setIsSimulated(true);
                } else {
                    setIsSimulated(false);
                }
                
                const processedData = calculateSMA(rawData, rawData.length > 50 ? 20 : 5);
                setData(processedData);

                if (rawData.length > 0) setCurrentPrice(rawData[rawData.length - 1].value);
            } catch (err) { console.error(err); }
        };

        fetchData();
        const socket = io(SERVER_URL);
        socket.on(`price_tick_${symbol}`, (tick) => setCurrentPrice(tick.price));
        return () => socket.close();
    }, [symbol, range]); 

    return (
        <div className="panel chart-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '300px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                <div>
                    <div className="panel-header">PRICE · <b>{symbol}</b></div>
                    <div className="price-display">
                        ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        {isSimulated ? (
                            <span className="live-indicator" style={{ color: 'var(--down)', marginLeft: '10px' }}>SIMULATED DATA</span>
                        ) : (
                            <span className="live-indicator"><span className="live-dot">●</span> LIVE</span>
                        )}
                    </div>
                </div>

                <div className="range-selector">
                    {ranges.map(r => (
                        <button key={r} className={`range-btn ${range === r ? 'active' : ''}`} onClick={() => setRange(r)}>
                            {r.toUpperCase()}
                        </button>
                    ))}
                </div>
            </div>
            
            {/* 👇 KEY FIX: Added class 'ghoul-chart-container' for mobile CSS targeting */}
            <div className="ghoul-chart-container" style={{ flex: 1, width: '100%', minHeight: '0' }}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                        <defs>
                            <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={isSimulated ? "#ff5c4d" : "#ffb000"} stopOpacity={0.22}/>
                                <stop offset="95%" stopColor={isSimulated ? "#ff5c4d" : "#ffb000"} stopOpacity={0}/>
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1d1a14" />
                        <XAxis dataKey="time" hide={true} />
                        <YAxis domain={['auto', 'auto']} hide={true} padding={{ top: 20, bottom: 20 }} />
                        <Tooltip
                            contentStyle={{ backgroundColor: '#0b0a08', border: '1px solid #2a251d', color: '#ece3cf', fontFamily: 'JetBrains Mono', fontSize: 12, borderRadius: 2 }}
                            labelFormatter={(t) => new Date(t * 1000).toLocaleString(undefined, range === '1d' ? { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })}
                            formatter={(v, name) => [`$${Number(v).toFixed(2)}`, name === 'sma' ? 'SMA' : 'PRICE']}
                        />
                        <Line type="monotone" dataKey="sma" stroke="#8b8170" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                        <Area type="monotone" dataKey="value" stroke={isSimulated ? "#ff5c4d" : "#ffb000"} strokeWidth={2} fill="url(#colorPrice)" isAnimationActive={false} />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
            <div className="chart-legend">
                <span><i style={{ background: isSimulated ? '#ff5c4d' : '#ffb000' }} />PRICE</span>
                <span><i style={{ background: '#8b8170' }} />MOVING AVG ({data.length > 50 ? 20 : 5})</span>
            </div>
        </div>
    );
};

export default GhoulChart;