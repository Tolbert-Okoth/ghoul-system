import React, { useEffect, useState } from 'react';
import './App.css';
import SmaDeviationPanel from './components/SmaDeviationPanel'; 
import GhoulVisuals from './components/GhoulVisuals'; 
import NetDirectionPanel from './components/NetDirectionPanel';
import GhoulChart from './components/GhoulChart';
import SignalFeed from './components/SignalFeed';
import WatchlistPanel from './components/WatchlistPanel';

function App() {
  const [activeSymbol, setActiveSymbol] = useState('SPY'); 

  useEffect(() => {
    // Inject Cyberpunk Fonts
    const link = document.createElement('link');
    link.href = "https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Share+Tech+Mono&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }, []);

  return (
    <div className="app-container">
      {/* Visual Polish: CRT Scanline Overlay */}
      <div className="scanlines"></div> 
      
      {/* Header Section */}
      <header className="app-header">
        <h1 className="app-title">GHOUL_COMMAND <span className="highlight">{"// " + activeSymbol}</span></h1>
        <div className="status-bar">
          <div className="status-item">
            <span className="status-label">SYSTEM_STATUS</span>
            <span className="status-val status-online">ONLINE</span>
          </div>
          <div className="status-item">
            <span className="status-label">MODE</span>
            <span className="status-val">SENTIMENT_TRACKING</span>
          </div>
        </div>
      </header>

      {/* Main Grid Layout */}
      <div className="main-dashboard">
        
        {/* LEFT COLUMN: Controls & Intelligence */}
        <aside className="left-column">
            {/* 1. Target Selector (Watchlist) */}
            <WatchlistPanel activeSymbol={activeSymbol} onSelect={setActiveSymbol} />
            
            {/* 2. AI Narrative Visuals (With Confidence Bar) */}
            <GhoulVisuals symbol={activeSymbol} />
            
            {/* 3. Net Direction (Bull/Bear Slider) */}
            <NetDirectionPanel symbol={activeSymbol} />
            
            {/* 4. SMA Deviation (Restored) */}
            <SmaDeviationPanel symbol={activeSymbol} />
        </aside>

        {/* RIGHT COLUMN: Data & Charts (Now Scrollable) */}
        <main className="right-column">
            {/* 1. Interactive Price Chart */}
            <GhoulChart symbol={activeSymbol} />
            
            {/* 2. Incoming Signal Feed (Grid Layout) */}
            <SignalFeed />
        </main>

      </div>
    </div>
  );
}

export default App;