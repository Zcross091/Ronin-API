// Animepahe Scraper & Multi-Domain Mirror Cluster
// Supports dynamic domain cluster via ANIMEPAHE_CLUSTER env variable
// Auto-saves extracted stream links to Supabase.

const axios = require('axios');
const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_KEY || "";
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

async function saveToSupabase(title, episode, type, url) {
    if (!supabase) return;
    const cleanTitle = (title || '').toLowerCase().trim();
    if (!cleanTitle || !url || !url.startsWith('http')) return;
    try {
        const { error } = await supabase.from('anime_links').upsert(
            { title: cleanTitle, episode: episode || 1, type: type || 'embed', url },
            { onConflict: 'title, episode, type' }
        );
        if (error) console.error("❌ Supabase Error:", error.message);
        else console.log(`✅ Cached to Supabase: [${cleanTitle}] Ep ${episode || 1} (${type}) -> ${url}`);
    } catch (e) {
        console.error("❌ Supabase Save Exception:", e.message);
    }
}

async function fetchHtml(url) {
    try {
        const res = await axios.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Referer': 'https://animepahe.ru/'
            }
        });
        return res.data;
    } catch (e) {
        if (e.response?.status === 403 || e.response?.status === 503) {
            try {
                const { fetchWithStealthBrowser } = require('../browserManager');
                const stealthRes = await fetchWithStealthBrowser(url);
                return stealthRes.html;
            } catch (err) {}
        }
        throw e;
    }
}

const ANIMEPAHE_DOMAINS = (typeof process !== 'undefined' && process.env && process.env.ANIMEPAHE_CLUSTER)
  ? process.env.ANIMEPAHE_CLUSTER.split(',').map(d => d.trim().replace(/\/$/, '')).filter(Boolean)
  : ["https://animepahe.ru", "https://animepahe.org", "https://animepahe.com", "https://animepahe.net"];

async function search(params) {
  const query = typeof params === 'string' ? params : (params?.query || '');
  const results = [];

  for (const baseUrl of ANIMEPAHE_DOMAINS) {
    try {
      const searchUrl = `${baseUrl}/api?m=search&q=${encodeURIComponent(query)}`;
      const data = await fetchHtml(searchUrl);
      const jsonObj = typeof data === 'string' ? JSON.parse(data) : data;

      if (jsonObj && Array.isArray(jsonObj.data)) {
        for (const item of jsonObj.data) {
          results.push({
            id: item.session || item.id,
            title: item.title,
            url: `${baseUrl}/anime/${item.session || item.id}`,
            coverUrl: item.poster,
            isManga: false,
            episodesCount: item.episodes || 0,
            status: item.status
          });
        }
      }
      if (results.length > 0) break;
    } catch (e) {
      // Try next mirror
    }
  }

  return JSON.stringify(results);
}

async function details(params) {
  const url = typeof params === 'string' ? params : (params?.url || '');
  const urlObj = new URL(url);
  const baseUrl = `${urlObj.protocol}//${urlObj.hostname}`;
  const session = url.split('/').pop();

  const episodes = [];
  let animeTitle = '';

  try {
    const pageHtml = await fetchHtml(url);
    const $ = cheerio.load(pageHtml);
    animeTitle = $('h1 span').text().trim() || $('h1').text().trim();

    // Fetch episode list from Animepahe API endpoint
    let page = 1;
    let totalPages = 1;

    do {
      const releaseUrl = `${baseUrl}/api?m=release&id=${session}&sort=episode_asc&page=${page}`;
      const releaseDataStr = await fetchHtml(releaseUrl);
      const releaseObj = typeof releaseDataStr === 'string' ? JSON.parse(releaseDataStr) : releaseDataStr;

      if (releaseObj && Array.isArray(releaseObj.data)) {
        totalPages = releaseObj.last_page || 1;
        for (const ep of releaseObj.data) {
          const epNum = ep.episode || 1;
          episodes.push({
            id: ep.session,
            mediaId: session,
            title: `Episode ${epNum}`,
            number: epNum,
            url: `${baseUrl}/play/${session}/${ep.session}`
          });
        }
      }
      page++;
    } while (page <= totalPages && page <= 5);

  } catch (e) {
    console.error("Animepahe details error:", e.message);
  }

  return JSON.stringify({
    anime: {
      id: session,
      title: animeTitle || 'Anime',
      url: url,
      isManga: false
    },
    episodes: episodes
  });
}

async function extractVideo(params) {
  const url = typeof params === 'string' ? params : (params?.url || params?.link || '');
  const titleParam = params?.title || '';
  const episodeParam = params?.episode || 1;

  const sources = [];

  try {
    const playHtml = await fetchHtml(url);
    const $ = cheerio.load(playHtml);

    // Extract embed player buttons (Kwik, Pahe, etc.)
    const embedLinks = [];
    $('#resolutionMenu button, #downloadMenu a').each((_, el) => {
      const src = $(el).attr('data-src') || $(el).attr('href');
      if (src && src.startsWith('http')) {
        embedLinks.push(src);
      }
    });

    // Also parse inline JS if present
    $('script').each((_, el) => {
      const content = $(el).html() || '';
      const kwikMatches = content.match(/https?:\/\/[^\s"']*(?:kwik|pahe)[^\s"']*/gi);
      if (kwikMatches) {
        embedLinks.push(...kwikMatches);
      }
    });

    const uniqueEmbeds = [...new Set(embedLinks)];
    for (const embedUrl of uniqueEmbeds) {
      sources.push({ url: embedUrl, quality: "auto", isM3U8: embedUrl.includes('.m3u8') });
      await saveToSupabase(titleParam || 'anime', episodeParam, "embed", embedUrl);
    }
  } catch (e) {
    console.error("Animepahe extractVideo error:", e.message);
  }

  return JSON.stringify({
    sources: sources.length > 0 ? sources : [{ url: "", quality: "none", isM3U8: false }],
    subtitles: []
  });
}

async function scrapeAnimepaheSingle(query, epNum = 1, domains) {
  const activeDomains = (domains && domains.length > 0) ? domains : ANIMEPAHE_DOMAINS;
  let targetStreamUrl = null;

  for (const domain of activeDomains) {
    try {
      const searchResStr = await search({ query });
      const searchResults = JSON.parse(searchResStr);
      if (!searchResults || searchResults.length === 0) continue;

      const firstAnime = searchResults[0];
      console.log(`\n🔥 ANIMEPAHE MINING: "${firstAnime.title}" (${firstAnime.url})`);

      const detailsStr = await details({ url: firstAnime.url });
      const detailsObj = JSON.parse(detailsStr);
      const episodes = detailsObj.episodes || [];
      const seriesTitle = detailsObj.anime?.title || firstAnime.title;

      const targetEp = episodes.find(e => e.number === epNum) || episodes[0];
      if (targetEp) {
        const videoResStr = await extractVideo({ url: targetEp.url, title: seriesTitle, episode: epNum });
        const videoObj = JSON.parse(videoResStr);
        const validSource = (videoObj.sources || []).find(s => s.url && s.url.startsWith('http'));
        if (validSource) {
          targetStreamUrl = validSource.url;
          console.log(`✅ Animepahe mined Ep ${epNum} for "${seriesTitle}": ${targetStreamUrl}`);
          return targetStreamUrl;
        }
      }
    } catch (e) {
      console.error(`Animepahe scraper failed on ${domain}: ${e.message}`);
    }
  }
  return targetStreamUrl;
}

async function scrapeAnimepahe(query, epNum = 1, domains) {
  const isDubQuery = query.toLowerCase().includes('dub');
  
  if (isDubQuery) {
    return await scrapeAnimepaheSingle(query, epNum, domains);
  }
  
  console.log(`\n⚡ Simultaneous Dual Sub + Dub Animepahe Mining for: "${query}"...`);
  const [subUrl, dubUrl] = await Promise.all([
    scrapeAnimepaheSingle(query, epNum, domains),
    scrapeAnimepaheSingle(`${query} dub`, epNum, domains)
  ]);

  return subUrl || dubUrl;
}

module.exports = {
  search,
  details,
  extractVideo,
  scrapeAnimepahe,
  ANIMEPAHE_DOMAINS
};

if (require.main === module) {
  const query = process.argv[2] || "naruto";
  const ep = parseInt(process.argv[3]) || 1;
  console.log(`🚀 Testing Animepahe Scraper for "${query}" Ep ${ep}...`);
  scrapeAnimepahe(query, ep).then(url => {
    console.log("Result Stream URL:", url);
  });
}
