import React from 'react';

// One wire item: symbol, the call, the headline, the model's reason, and its confidence
const SignalCard = ({ data }) => {
  if (!data) return null;
  const { symbol, verdict, sentiment_score, confidence, headline, reasoning, timestamp, id } = data;

  const score = Number(sentiment_score) || 0;
  const call = verdict || (score >= 4 ? 'BUY' : score <= -4 ? 'SELL' : 'WATCH');
  const tone = call === 'BUY' ? 'up' : call === 'SELL' ? 'down' : 'flat';
  const conf = Math.round(Number(confidence || 0) * 100);
  const reason = String(reasoning || '').replace(/^\[RISK:[^\]]*\]\s*/, '');
  const risk = (String(reasoning || '').match(/^\[RISK:\s*([^\]]*)\]/) || [])[1];

  return (
    <article className={`wire-item ${tone}`}>
      <div className="wire-top">
        <span><span className="wire-sym">{symbol || '—'}</span><span className="wire-call">{call}</span></span>
        <span>{conf}% <span className="wire-conf"><i style={{ width: `${conf}%` }} /></span></span>
      </div>
      <p className="wire-headline">{headline}</p>
      {reason && <p className="wire-reason">{reason}</p>}
      <div className="wire-foot">
        <span>{timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}{risk ? ` · RISK ${risk}` : ''}</span>
        <span>#{id}</span>
      </div>
    </article>
  );
};

export default SignalCard;
