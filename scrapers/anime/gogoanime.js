// GogoAnime Scraper (Primary Priority Engine for Ronin API)
// Supports search(), details(), extractVideo() for QuickJS engine
// AND scrapeGogoanime() / scrapeGogoanimeLight() for Ronin API backend waterfall

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
    const { error } = await supabase.from('anime_links').upsert(
        { title: title.toLowerCase().trim(), episode, type, url },
        { onConflict: 'title, episode, type' }
    );
    if (error) console.error("❌ Supabase Error:", error);
    else console.log(`✅ Cached to Supabase: [${title}] Ep ${episode} -> ${url}`);
}

async function fetchHtml(url) {
    try {
        const res = await axios.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Referer': 'https://gogoanime3.co/'
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

const GOGO_DOMAINS = (typeof process !== 'undefined' && process.env && process.env.GOGO_DOMAINS)
  ? process.env.GOGO_DOMAINS.split(',').map(d => d.trim().replace(/\/(popular|home)\/?$/i, '').replace(/\/$/, '')).filter(Boolean)
  : ["https://anitaku.pe", "https://gogoanime3.co", "https://gogoanime.or.at"];

async function search(params) {
  const query = params.query;
  const results = [];

  for (const baseUrl of GOGO_DOMAINS) {
    try {
      const html = await fetchHtml(`${baseUrl}/search.html?keyword=${encodeURIComponent(query)}`);
      const $ = cheerio.load(html);
      
      $('ul.items li').each((i, el) => {
        const a = $(el).find('p.name a');
        const img = $(el).find('div.img a img').attr('src');
        const title = a.text();
        const href = a.attr('href') || '';
        const link = baseUrl + href;
        const id = href.split('/').pop();
        
        results.push({
          id: id,
          title: title,
          url: link,
          coverUrl: img,
          isManga: false
        });
      });

      if (results.length > 0) break;
    } catch (e) {
      // Try next domain
    }
  }
  
  return JSON.stringify(results);
}

async function details(params) {
  const url = params.url;
  const urlObj = new URL(url);
  const baseUrl = `${urlObj.protocol}//${urlObj.hostname}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  
  const title = $('div.anime_info_body_bg h1').text();
  const id = url.split('/').pop();

  const movieId = $('#movie_id').attr('value') || $('input#movie_id').attr('value') || '';
  const aliasId = $('#alias_anime').attr('value') || $('input#alias_anime').attr('value') || id;
  
  const episodes = [];

  if (movieId) {
    try {
      const lastEpEl = $('ul#episode_page li a').last();
      const epEnd = lastEpEl.attr('ep_end') || '1';
      
      const ajaxUrl = `https://ajax.gogocdn.net/ajax/load-list-episode?ep_start=0&ep_end=${epEnd}&id=${movieId}&default_ep=0&alias=${aliasId}`;
      const ajaxRes = await fetchHtml(ajaxUrl);
      const ajax$ = cheerio.load(ajaxRes);
      
      ajax$('#episode_related li a').each((i, el) => {
        const epHref = ajax$(el).attr('href')?.trim() || '';
        const epNumMatch = epHref.match(/-episode-(\d+)/);
        const epNum = epNumMatch ? parseInt(epNumMatch[1]) : i + 1;
        
        episodes.push({
          id: `ep-${epNum}`,
          mediaId: id,
          title: `Episode ${epNum}`,
          number: epNum,
          url: epHref.startsWith('http') ? epHref : `${baseUrl}${epHref.startsWith('/') ? '' : '/'}${epHref}`
        });
      });
    } catch (e) {
      // Fallback
    }
  }

  if (episodes.length === 0) {
    $('ul#episode_page li a').each((i, el) => {
      const epStart = parseInt($(el).attr('ep_start') || '0');
      const epEnd = parseInt($(el).attr('ep_end') || '0');
      for (let n = epStart || 1; n <= epEnd; n++) {
        episodes.push({
          id: `ep-${n}`,
          mediaId: id,
          title: `Episode ${n}`,
          number: n,
          url: `${baseUrl}/${id}-episode-${n}`
        });
      }
    });
  }

  episodes.sort((a, b) => a.number - b.number);
  
  return JSON.stringify({
    anime: {
      id: id,
      title: title,
      url: url,
      isManga: false
    },
    episodes: episodes
  });
}

async function extractVideo(params) {
  const url = params.url;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  
  const sources = [];

  $('div.anime_video_body iframe, .play-video iframe, iframe').each((i, el) => {
    const src = $(el).attr('src');
    if (src && (
      src.includes('streaming.php') ||
      src.includes('embedplus') ||
      src.includes('embtaku') ||
      src.includes('gogoplay') ||
      src.includes('gogohd') ||
      src.includes('sbplay') ||
      src.includes('vidstreaming')
    )) {
      const iframeUrl = src.startsWith('http') ? src : `https:${src}`;
      sources.push({ url: iframeUrl, quality: "auto", isM3U8: false });
    }
  });

  if (sources.length === 0) {
    $('iframe').each((i, el) => {
      const src = $(el).attr('src');
      if (src && src.startsWith('http') && !src.includes('google') && !src.includes('ads')) {
        sources.push({ url: src, quality: "fallback", isM3U8: false });
      }
    });
  }

  if (sources.length === 0) {
    $('div.anime_muti_link li a, .dowloads a, .cf-download a').each((i, el) => {
      const href = $(el).attr('href');
      if (href && href.startsWith('http')) {
        const quality = $(el).text().trim() || "download";
        sources.push({ url: href, quality: quality, isM3U8: false });
      }
    });
  }

  return JSON.stringify({
    sources: sources.length > 0 ? sources : [{ url: "", quality: "none", isM3U8: false }],
    subtitles: []
  });
}

async function scrapeGogoanime(query, epNum, domains) {
  const activeDomains = (domains && domains.length > 0) ? domains : GOGO_DOMAINS;
  const cleanQuery = query.toLowerCase().trim();
  const querySlug = cleanQuery.replace(/[^a-z0-9]+/g, '-');

  for (const domain of activeDomains) {
    try {
      // Stage 1: Try direct episode URL prediction first
      const directEpUrl = `${domain}/${querySlug}-episode-${epNum}`;
      try {
        const epHtml = await fetchHtml(directEpUrl);
        const ep$ = cheerio.load(epHtml);
        const iframe = ep$('.play-video iframe, iframe').attr('src');
        if (iframe) {
          const videoUrl = iframe.startsWith('http') ? iframe : `https:${iframe}`;
          console.log(`⚡ Instant Direct Gogo Match: [${query}] Ep ${epNum} -> ${videoUrl}`);
          await saveToSupabase(query, epNum, "embed", videoUrl);
          return videoUrl;
        }
      } catch (err) {}

      // Stage 2: Full gogoanime.js search() & details() pipeline
      const searchResStr = await search({ query });
      const searchResults = JSON.parse(searchResStr);
      if (!searchResults || searchResults.length === 0) continue;

      const firstAnime = searchResults[0];
      const detailsStr = await details({ url: firstAnime.url });
      const detailsObj = JSON.parse(detailsStr);
      const episodes = detailsObj.episodes || [];

      const targetEp = episodes.find(e => e.number === epNum);
      if (targetEp && targetEp.url) {
        const videoResStr = await extractVideo({ url: targetEp.url });
        const videoObj = JSON.parse(videoResStr);
        const videoSources = videoObj.sources || [];
        const validSource = videoSources.find(s => s.url && s.url.startsWith('http'));
        if (validSource) {
          console.log(`✅ Gogo Mined via gogoanime.js: [${query}] Ep ${epNum} -> ${validSource.url}`);
          await saveToSupabase(query, epNum, "embed", validSource.url);
          return validSource.url;
        }
      }
    } catch (e) {
      console.error(`Gogoanime scraper failed on ${domain}: ${e.message}`);
    }
  }
  return null;
}

module.exports = {
  search,
  details,
  extractVideo,
  scrapeGogoanime,
  scrapeGogoanimeLight: scrapeGogoanime
};
