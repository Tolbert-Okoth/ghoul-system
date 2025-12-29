# 💀 GHOUL SYSTEM: AI-Powered Market Intelligence
<img width="1888" height="885" alt="Image" src="https://github.com/user-attachments/assets/4e3613b7-53a5-4309-b369-715ef86aee52" />


**The Ghoul System** is an autonomous, full-stack market surveillance tool. It uses a dual-service architecture to scan financial news and technical data in real-time, feeding it into a Large Language Model (Groq AI) to generate trading signals with a "Cyberpunk" tactical dashboard.

## ⚡ Features

* **🧠 AI "Brain" (Python Microservice):** Analyzes market sentiment using Groq AI. Calculates technical indicators (RSI, MACD, Bollinger Bands) using Pandas/TA-Lib.
* **🔌 "Body" (Node.js Backend):** Orchestrates data flow, manages WebSockets, and handles the "Spare Tire" data failover strategy (Alpaca IEX → Yahoo Finance → Simulation).
* **👁️ "Face" (React Frontend):** A mobile-responsive, cyberpunk-themed dashboard with live charts, signal feeds, and real-time socket updates.
* **🛡️ Self-Healing Database:** Includes an automated "Garbage Collector" that purges data older than 7 days to stay within free-tier storage limits.
* **📱 Mobile Optimized:** Fully responsive layout with touch-friendly scrolling and stacked panels for Android/iOS.

## 🛠️ Tech Stack

### **Frontend**
* **React.js** (Create React App)
* **Recharts** (Interactive charting)
* **Socket.io-client** (Real-time updates)
* **CSS3** (Custom Cyberpunk/Neon design)

### **Backend (The Manager)**
* **Node.js & Express**
* **Socket.io** (WebSocket server)
* **PostgreSQL (`pg`)** (Data persistence)
* **Alpaca API** (Primary data feed)
* **Yahoo Finance** (Backup data feed)
* **RSS Parser** (Live news scraping)

### **AI Service (The Brain)**
* **Python 3.10+**
* **Flask** (API Interface)
* **Groq API** (LLM Inference)
* **Pandas & TA-Lib** (Technical Analysis)
* **YFinance** (Technical data fetching)

## 🚀 Installation & Setup

### 1. Prerequisites
* Node.js (v18+)
* Python (v3.9+)
* PostgreSQL Database (Local or Neon/Render)

### 2. Clone the Repository
```bash
git clone [https://github.com/yourusername/ghoul-system.git](https://github.com/yourusername/ghoul-system.git)
cd ghoul-system
