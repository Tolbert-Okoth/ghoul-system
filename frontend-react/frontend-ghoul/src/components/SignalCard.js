import React from 'react';
import { TrendingUp, TrendingDown, Minus, Activity, Info } from 'lucide-react';

const SignalCard = ({ data }) => {
  // 🛡️ Safety check
  if (!data) return null;

  // 1. Destructure Data
  const { 
    sentiment_score, 
    confidence, 
    headline, 
    reasoning, 
    timestamp, 
    id
  } = data;

  // 2. Logic for 3 States
  const isBullish = sentiment_score >= 4;
  const isBearish = sentiment_score <= -4;
  
  // 3. Define Colors (Cyberpunk Palette)
  const getTheme = () => {
    if (isBullish) return {
      color: '#34d399',       // Emerald Green
      borderColor: '#10b981', 
      label: 'BULLISH',
      icon: <TrendingUp size={16} />
    };
    if (isBearish) return {
      color: '#fb7185',       // Rose Red
      borderColor: '#f43f5e', 
      label: 'BEARISH',
      icon: <TrendingDown size={16} />
    };
    return {
      color: '#9ca3af',       // Gray
      borderColor: '#6b7280', 
      label: 'NEUTRAL',
      icon: <Minus size={16} />
    };
  };

  const theme = getTheme();

  return (
    <div 
      className="card mb-2 border-0 text-white" 
      style={{
        background: 'rgba(17, 24, 39, 0.7)', 
        borderLeft: `4px solid ${theme.borderColor}`,
        borderRadius: '0 4px 4px 0',
        transition: 'all 0.2s ease',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5)'
      }}
    >
      <div className="card-body p-3">
        
        {/* --- HEADER --- */}
        <div className="d-flex justify-content-between align-items-center mb-2">
          <div className="d-flex align-items-center gap-2" style={{ color: theme.color, fontWeight: 'bold', fontSize: '11px', letterSpacing: '1px' }}>
            {theme.icon}
            <span>{theme.label} ({sentiment_score})</span>
          </div>
          <span className="text-info d-flex align-items-center gap-1" style={{ fontSize: '10px', fontFamily: 'monospace' }}>
            <Activity size={12} />
            {Math.round(confidence * 100)}% CONF
          </span>
        </div>

        {/* --- HEADLINE --- */}
        <h6 className="card-title mb-2" style={{ fontSize: '13px', lineHeight: '1.4', color: '#e5e7eb', fontWeight: '600', fontFamily: 'monospace' }}>
          {headline}
        </h6>

        {/* --- REASONING BOX --- */}
        <div className="p-2 rounded" style={{ background: 'rgba(0, 0, 0, 0.3)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <p className="m-0 d-flex gap-2" style={{ fontSize: '10px', color: '#9ca3af', fontStyle: 'italic', fontFamily: 'monospace' }}>
            <Info size={12} style={{ marginTop: '2px', minWidth: '12px' }} />
            {reasoning || "Analyzing market structure..."}
          </p>
        </div>

        {/* --- FOOTER (Edited: Removed Buy/Sell Price) --- */}
        <div className="d-flex justify-content-between mt-2 pt-1" style={{ fontSize: '9px', color: '#6b7280', fontFamily: 'monospace' }}>
          <span>{new Date(timestamp).toLocaleTimeString()}</span>
          <span>ID: {id}</span> {/* 👈 Only ID is shown now */}
        </div>

      </div>
    </div>
  );
};

export default SignalCard;