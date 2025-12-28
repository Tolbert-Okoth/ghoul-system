import React from 'react';

const SystemManual = ({ onClose }) => {
    return (
        <div className="manual-overlay" onClick={onClose}>
            <div className="panel manual-panel" onClick={(e) => e.stopPropagation()}>
                <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>SYSTEM_OPERATOR_MANUAL_V1.0</span>
                    <button className="close-btn" onClick={onClose}>[X]</button>
                </div>

                <div className="manual-content">
                    {/* SECTION 1: THE BRAIN */}
                    <div className="manual-section">
                        <h3 className="neon-text" style={{ color: 'var(--neon-blue)' }}>1. NARRATIVE CLUSTERS (THE BRAIN)</h3>
                        <p>The "Ghoul Brain" analyzes news sentiment + technical indicators to form a consensus.</p>
                        <ul className="manual-list">
                            <li><span style={{ color: 'var(--neon-green)' }}>BULLISH</span> :: Strong positive trend. (Action: BUY)</li>
                            <li><span style={{ color: 'var(--neon-red)' }}>BEARISH</span> :: Strong negative trend. (Action: SELL/SHORT)</li>
                            <li><span style={{ color: '#888' }}>HOLD / NEUTRAL</span> :: No clear edge. Risk is undefined. (Action: WAIT)</li>
                            <li><span style={{ color: 'var(--neon-yellow)' }}>WEAK SIGNALS</span> :: Low confidence trend. (Action: CAUTION)</li>
                        </ul>
                        <div className="note-box">
                            <strong>CONFIDENCE INTERVAL:</strong> 
                            <br/>
                            • <strong>&gt; 80% (Green):</strong> High Conviction. Trust the signal.
                            <br/>
                            • <strong>&lt; 80% (Yellow):</strong> Low Conviction. The AI is unsure.
                        </div>
                    </div>

                    <hr className="manual-divider"/>

                    {/* SECTION 2: SCORING & SLIDERS */}
                    <div className="manual-section">
                        <h3 className="neon-text" style={{ color: 'var(--neon-yellow)' }}>2. MARKET DIRECTION & SCORING</h3>
                        
                        <div className="sub-section">
                            <strong>NET DIRECTION (Sentiment Slider)</strong>
                            <p>Tracks the aggregate "mood" score of the market (-10 to +10).</p>
                            <ul>
                                <li><strong>Score &gt; +2.0 (Green):</strong> Optimism. Bulls are in control.</li>
                                <li><strong>Score &lt; -2.0 (Red):</strong> Fear. Bears are in control.</li>
                                <li><strong>-2.0 to +2.0 (Grey):</strong> Chop zone. Market is undecided.</li>
                            </ul>
                        </div>

                        <div className="sub-section">
                            <strong>MEAN REVERSION (Deviation)</strong>
                            <p>Shows the gap between Current Price vs. 20-Day Average.</p>
                            <ul>
                                <li><strong>High Positive %:</strong> Overextended. Expect a pullback.</li>
                                <li><strong>High Negative %:</strong> Oversold. Expect a bounce.</li>
                            </ul>
                        </div>
                    </div>

                    <hr className="manual-divider"/>

                    {/* SECTION 3: VISUALS */}
                    <div className="manual-section">
                        <h3 className="neon-text" style={{ color: 'var(--neon-green)' }}>3. CHART & SIGNALS</h3>
                        <p><strong>PRICE ACTION:</strong> 
                        <br/>
                        • Blue Line = Live Price
                        <br/>
                        • Orange Line = 20-period Average.
                        <br/>
                        <i>Trend is UP when Blue is above Orange.</i>
                        </p>
                        
                        <p><strong>WATCHLIST:</strong> Click any ticker in the top-left box (SPY, TSLA, NVDA) to switch the entire dashboard to that asset.</p>
                    </div>

                    <div className="manual-footer">
                        SYSTEM_ADVICE: "Trust the data, not the hype." // END_OF_FILE
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SystemManual;