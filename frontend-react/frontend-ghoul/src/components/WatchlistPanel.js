import React from 'react';

const ASSETS = [
    { id: 'SPY', name: 'S&P 500', type: 'INDEX' },
    { id: 'NVDA', name: 'NVIDIA', type: 'TECH' },
    { id: 'TSLA', name: 'TESLA', type: 'AUTO' },
    { id: 'COIN', name: 'COINBASE', type: 'CRYPTO' },
    { id: 'PLTR', name: 'PALANTIR', type: 'AI' },
    { id: 'AMD', name: 'AMD', type: 'CHIP' },
];

const WatchlistPanel = ({ activeSymbol, onSelect }) => {
    return (
        <div className="panel watchlist-panel" style={{ marginBottom: '20px', padding: '10px' }}>
            <div className="panel-header">TARGET_ACQUISITION</div>
            <div className="watchlist-grid">
                {ASSETS.map((asset) => (
                    <div 
                        key={asset.id}
                        className={`watchlist-item ${activeSymbol === asset.id ? 'active' : ''}`}
                        onClick={() => onSelect(asset.id)}
                    >
                        <div className="wl-tag">{asset.type}</div>
                        <div className="wl-ticker">{asset.id}</div>
                        <div className="wl-status"></div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default WatchlistPanel;