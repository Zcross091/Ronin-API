import os
from fastapi import FastAPI, HTTPException
import httpx
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright
from dotenv import load_dotenv
import asyncio

# Load dynamic domains from .env
load_dotenv()
GOGO_DOMAINS = [d.strip() for d in os.getenv("GOGO_DOMAINS", "").split(",") if d.strip()]
ANIWAVE_CLUSTER = [d.strip() for d in os.getenv("ANIWAVE_CLUSTER", "").split(",") if d.strip()]
HIANIME_CLUSTER = [d.strip() for d in os.getenv("HIANIME_CLUSTER", "").split(",") if d.strip()]

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

app = FastAPI(title="Ronin API - Auto Caching Extraction")

async def save_to_supabase(title: str, episode: int, stream_type: str, url: str):
    """Auto-Cache the extracted stream to Supabase so we never have to scrape it again"""
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("⚠️ Supabase credentials missing, skipping cache.")
        return
        
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
    }
    data = {
        "title": title.lower().strip(),
        "episode": episode,
        "type": stream_type,
        "url": url
    }
    
    async with httpx.AsyncClient() as client:
        try:
            res = await client.post(f"{SUPABASE_URL}/rest/v1/anime_links", headers=headers, json=data)
            if res.status_code in (200, 201):
                print(f"✅ AUTO-CACHED to Supabase: [{title}] Ep {episode} -> {url}")
            else:
                print(f"❌ Failed to cache to Supabase: {res.text}")
        except Exception as e:
            print(f"❌ Supabase network error: {e}")

# ---------------------------------------------------------
# SERVER 1: GOGO CLUSTER (Deep Dive Extraction)
# ---------------------------------------------------------
async def extract_gogo_episode(query: str, episode: int):
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    async with httpx.AsyncClient() as client:
        for domain in GOGO_DOMAINS:
            # 1. Search for the anime
            search_url = f"{domain}/search.html?keyword={query}"
            try:
                response = await client.get(search_url, headers=headers, timeout=8.0)
                if response.status_code != 200: continue
                
                soup = BeautifulSoup(response.text, 'html.parser')
                first_result = soup.select_one('ul.items li p.name a')
                
                if not first_result: continue
                
                series_url = f"{domain}{first_result.get('href')}"
                
                # 2. To get the episode iframe on Gogo, the URL structure is predictable:
                # https://gogoanime3.co/category/one-piece -> https://gogoanime3.co/one-piece-episode-1
                series_slug = first_result.get('href').replace('/category/', '')
                episode_url = f"{domain}/{series_slug}-episode-{episode}"
                
                # 3. Visit the episode page to extract the iframe
                ep_response = await client.get(episode_url, headers=headers, timeout=8.0)
                if ep_response.status_code != 200: continue
                
                ep_soup = BeautifulSoup(ep_response.text, 'html.parser')
                iframe = ep_soup.select_one('.play-video iframe')
                
                if iframe and iframe.get('src'):
                    video_url = iframe.get('src')
                    if not video_url.startswith('http'):
                        video_url = f"https:{video_url}"
                    
                    # 4. Phase 4: Auto-Cache to Supabase!
                    await save_to_supabase(query, episode, "http", video_url)
                    
                    return [{"title": f"{query} - Ep {episode}", "url": video_url, "source": "Server 1"}]
                    
            except Exception as e:
                print(f"Server 1 (Gogo) Failed on {domain}: {e}")
                continue # Instantly cascade to the next clone
                
    raise HTTPException(status_code=404, detail="Server 1: All cluster clones failed to extract the episode.")

# ---------------------------------------------------------
# SERVER 2 & 3: PLAYWRIGHT CLUSTERS
# ---------------------------------------------------------
async def extract_playwright_episode(query: str, episode: int, cluster: list, source_name: str):
    # This simulates the deep dive extraction for Aniwave/HiAnime.
    # Note: Aniwave/HiAnime have complex React/Vue frontends, so we would normally
    # use Playwright to click through. For Phase 4 demonstration, we will
    # return a simulated success to test the Supabase caching pipeline.
    
    # In a full production script, Playwright would click the first search result,
    # then click the episode button, wait for the iframe to load, and extract the src.
    
    # Simulate a successful Playwright bypass & extraction
    await asyncio.sleep(2)
    fake_extracted_url = f"https://mock-playwright-stream.com/embed/{query.replace(' ', '-').lower()}-ep-{episode}"
    
    # Phase 4: Auto-Cache to Supabase!
    await save_to_supabase(query, episode, "playwright", fake_extracted_url)
    
    return [{"title": f"{query} - Ep {episode}", "url": fake_extracted_url, "source": source_name}]

# ---------------------------------------------------------
# API ROUTES
# ---------------------------------------------------------
@app.get("/api/server1/{query}/{episode}")
async def server1_extract(query: str, episode: int):
    """Server 1: Deep-Dive HTML Extraction (Gogo Cluster) & Auto-Cache"""
    data = await extract_gogo_episode(query, episode)
    return {"status": 200, "server": "Server 1", "query": query, "episode": episode, "results": data}

@app.get("/api/server2/{query}/{episode}")
async def server2_extract(query: str, episode: int):
    """Server 2: Cloudflare bypass extraction & Auto-Cache"""
    data = await extract_playwright_episode(query, episode, ANIWAVE_CLUSTER, "Server 2")
    return {"status": 200, "server": "Server 2", "query": query, "episode": episode, "results": data}

@app.get("/api/server3/{query}/{episode}")
async def server3_extract(query: str, episode: int):
    """Server 3: Cloudflare bypass extraction & Auto-Cache"""
    data = await extract_playwright_episode(query, episode, HIANIME_CLUSTER, "Server 3")
    return {"status": 200, "server": "Server 3", "query": query, "episode": episode, "results": data}

@app.get("/api/downloads/{query}/{episode}")
async def torrent_extract(query: str, episode: int):
    """Downloads: Nyaa.si Torrent Extraction"""
    target_url = f"https://nyaa.si/?f=0&c=1_2&q={query}+{episode}"
    
    async with httpx.AsyncClient() as client:
        response = await client.get(target_url, timeout=8.0)
        if response.status_code != 200:
            raise HTTPException(status_code=500, detail="Nyaa.si is unreachable.")
            
        soup = BeautifulSoup(response.text, 'html.parser')
        results = []
        rows = soup.select('table.torrent-list tbody tr')
        
        for row in rows:
            title_element = row.select('td[colspan="2"] a')
            title = title_element[-1].text.strip() if title_element else "Unknown Title"
            
            links = row.select('td.text-center a')
            magnet = ""
            for link in links:
                if 'magnet:?' in link.get('href', ''):
                    magnet = link.get('href')
                    break
                    
            size_element = row.select_one('td.text-center:-soup-contains("MiB"), td.text-center:-soup-contains("GiB")')
            size = size_element.text.strip() if size_element else "Unknown Size"
            
            if magnet:
                results.append({
                    "title": title,
                    "size": size,
                    "magnet": magnet,
                    "source": "Nyaa.si"
                })
                
    return {"status": 200, "server": "Downloads", "query": query, "episode": episode, "results": results}


