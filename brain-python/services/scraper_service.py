import requests
from bs4 import BeautifulSoup
import time

class GhoulScraper:
    def __init__(self):
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        self.seen_headlines = set()

    def get_latest_headlines(self):
        headlines = []
        # Target: CNBC Finance (Faster and more ticker-friendly than Reuters)
        url = "https://www.cnbc.com/world-markets/"
        
        try:
            response = requests.get(url, headers=self.headers)
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # CNBC specific selectors for world market headlines
            links = soup.select('.Card-title')
            
            for link in links:
                text = link.get_text().strip()
                if text and text not in self.seen_headlines:
                    headlines.append(text)
                    self.seen_headlines.add(text)
                    
            return headlines
        except Exception as e:
            print(f"[SCRAPE_ERROR] Could not reach news source: {e}")
            return []

    def clean_old_data(self):
        # Keep the set from growing too large for your RAM
        if len(self.seen_headlines) > 500:
            self.seen_headlines.clear()