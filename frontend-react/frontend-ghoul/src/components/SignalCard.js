import React from 'react';
import { TrendingUp, TrendingDown, Info } from 'lucide-react';

const SignalCard = ({ signal }) => {
  const isBullish = signal.sentiment > 0;
  
  return (
    <div className={`terminal-card p-3 mb-3 ${isBullish ? 'glow-purple' : 'glow-red'}`}>
      <div className="d-flex justify-content-between align-items-start mb-2">
        <h6 className="headline small fw-bold m-0 text-uppercase">{signal.headline}</h6>
        {isBullish ? <TrendingUp size={16} className="text-purple" /> : <TrendingDown size={16} className="text-danger" />}
      </div>
      
      <div className="d-flex justify-content-between align-items-center">
        <span className={`badge ${isBullish ? 'bg-purple-dim' : 'bg-red-dim'}`}>
          {isBullish ? 'BULL' : 'BEAR'} {Math.abs(signal.sentiment).toFixed(2)}
        </span>
        <span className="text-muted" style={{fontSize: '10px'}}>
          CONFIDENCE: {(signal.confidence * 100).toFixed(0)}%
        </span>
      </div>

      <div className="mt-2 p-2 bg-black-thin rounded">
        <p className="reasoning m-0 small fst-italic text-secondary">
          <Info size={10} className="me-1"/> {signal.reasoning}
        </p>
      </div>
    </div>
  );
};

export default SignalCard;