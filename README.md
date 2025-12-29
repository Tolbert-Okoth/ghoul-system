💀 GHOUL SYSTEM: AI-Powered Market IntelligenceThe Ghoul System is an autonomous, full-stack market surveillance tool. It uses a dual-service architecture to scan financial news and technical data in real-time, feeding it into a Large Language Model (Groq AI) to generate trading signals with a "Cyberpunk" tactical dashboard.Shutterstock⚡ Features🧠 AI "Brain" (Python Microservice): Analyzes market sentiment using Groq AI. Calculates technical indicators (RSI, MACD, Bollinger Bands) using Pandas/TA-Lib.🔌 "Body" (Node.js Backend): Orchestrates data flow, manages WebSockets, and handles the "Spare Tire" data failover strategy (Alpaca IEX → Yahoo Finance → Simulation).👁️ "Face" (React Frontend): A mobile-responsive, cyberpunk-themed dashboard with live charts, signal feeds, and real-time socket updates.🛡️ Self-Healing Database: Includes an automated "Garbage Collector" that purges data older than 7 days to stay within free-tier storage limits.📱 Mobile Optimized: Fully responsive layout with touch-friendly scrolling and stacked panels for Android/iOS.🛠️ Tech StackFrontendReact.js (Create React App)Recharts (Interactive charting)Socket.io-client (Real-time updates)CSS3 (Custom Cyberpunk/Neon design)Backend (The Manager)Node.js & ExpressSocket.io (WebSocket server)PostgreSQL (pg) (Data persistence)Alpaca API (Primary data feed)Yahoo Finance (Backup data feed)RSS Parser (Live news scraping)AI Service (The Brain)Python 3.10+Flask (API Interface)Groq API (LLM Inference)Pandas & TA-Lib (Technical Analysis)YFinance (Technical data fetching)🚀 Installation & Setup1. PrerequisitesNode.js (v18+)Python (v3.9+)PostgreSQL Database (Local or Neon/Render)2. Clone the RepositoryBashgit clone https://github.com/yourusername/ghoul-system.git
cd ghoul-system
3. Backend Setup (Node.js)Bashcd backend-node
npm install
Create a .env file in backend-node/:Code snippetPORT=3000
DATABASE_URL=postgresql://user:password@host/dbname
APCA_API_KEY_ID=your_alpaca_key
APCA_API_SECRET_KEY=your_alpaca_secret
PYTHON_MICROSERVICE_URL=http://127.0.0.1:5000
FRONTEND_URL=http://localhost:3001
4. AI Service Setup (Python)Bashcd ../python-microservice
pip install -r requirements.txt
Create a .env file in python-microservice/:Code snippetGROQ_API_KEY=your_groq_key
5. Frontend Setup (React)Bashcd ../frontend
npm install
🏃‍♂️ Running LocallyYou need to run all three services simultaneously (or use Docker).Terminal 1 (AI Brain):Bashcd python-microservice
python app.py
Terminal 2 (Backend Manager):Bashcd backend-node
node server.js
Terminal 3 (Frontend):Bashcd frontend
npm start
📡 API EndpointsMethodEndpointDescriptionGET/api/v1/historyFetches historical candle data for charts.GET/healthServer health check.GET/api/admin/resetADMIN: Wipes database & resets IDs (requires ?key=ghoul).🧹 Database ManagementThe system includes a Rolling Window Strategy to prevent database bloating on free tiers:Garbage Collector: Automatically runs every 24h to delete signals older than 7 days.Manual Wipe: You can trigger a full reset by visiting:https://your-app-url.com/api/admin/reset?key=ghoul📱 Mobile ViewThe application uses a custom CSS media query strategy to ensure usability on phones:Unlocks body scrolling (overflow-y: auto).Stacks control panels vertically.Forces Chart and Signal Feed to fixed heights (400px) to prevent zero-height collapse.🤝 ContributingFork the ProjectCreate your Feature Branch (git checkout -b feature/AmazingFeature)Commit your Changes (git commit -m 'Add some AmazingFeature')Push to the Branch (git push origin feature/AmazingFeature)Open a Pull Request📄 LicenseDistributed under the MIT License. See LICENSE for more information.Note: This system is for educational and research purposes only. Not financial advice. 💀
