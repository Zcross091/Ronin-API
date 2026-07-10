import Gogoanime from './providers/gogoanime';
import axios from 'axios';

// The URL to the Google Apps Script database you set up earlier
const GAS_URL = "https://script.google.com/macros/s/AKfycbyhFjwqrHqFGkk3XEyM2vPu4HrhQeumywvh-krtdMYHBenQS97z8-fj_ne5eEk4zg/exec";

async function syncEpisodes(animeId: string, title: string, startEp: number, endEp: number) {
  const gogo = new Gogoanime();
  
  console.log(`\n[SYNC] Starting sync for ${title} (${startEp} to ${endEp}) using FlareSolverr...`);
  
  for (let i = startEp; i <= endEp; i++) {
    const episodeSlug = `${animeId}-episode-${i}`;
    console.log(`[SYNC] Fetching Episode ${i} (${episodeSlug})...`);
    
    try {
      const search = await gogo.fetchEpisodeSources(episodeSlug);
      
      if (!search || !search.sources || search.sources.length === 0) {
        console.error(`[SYNC] Failed to find sources for Episode ${i}`);
        continue;
      }
      
      // Get the highest quality M3U8 source (usually 1080p, or "default")
      const source = search.sources.find(s => s.quality === '1080p' || s.quality === 'default') || search.sources[0];
      
      console.log(`[SYNC] Success! Pushing ${source.url} to Database...`);
      
      // Push to GAS Database
      await axios.post(GAS_URL, {
        action: 'saveAnimeLink',
        title: title,
        episode: i.toString(),
        type: 'sub', // default to sub for now
        url: source.url
      });
      
      console.log(`[SYNC] Episode ${i} saved to database!`);
    } catch (e: any) {
      console.error(`[SYNC] Error on Episode ${i}:`, e.message);
    }
    
    // Add a small delay so we don't overwhelm FlareSolverr or Gogoanime
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log(`[SYNC] Sync complete for ${title}!`);
}

// Example usage: You can change these to sync whatever you want!
(async () => {
  // Sync Naruto Episodes 3 to 10
  await syncEpisodes('naruto', 'Naruto', 3, 5);
})();
