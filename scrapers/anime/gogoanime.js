// GogoAnime Scraper
// Converted from Puppeteer to Cheerio for RoninX QuickJS Bridge
// Supports dynamic domain cluster via GOGO_DOMAINS env variable

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

      if (results.length > 0) break; // Stop after first successful domain
    } catch (e) {
      // Try next domain
    }
  }
  
  return JSON.stringify(results);
}

async function details(params) {
  const url = params.url;
  // Extract base domain from the URL
  const urlObj = new URL(url);
  const baseUrl = `${urlObj.protocol}//${urlObj.hostname}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  
  const title = $('div.anime_info_body_bg h1').text();
  const id = url.split('/').pop();

  // Extract anime ID from the page for AJAX episode listing
  const movieId = $('#movie_id').attr('value') || $('input#movie_id').attr('value') || '';
  const aliasId = $('#alias_anime').attr('value') || $('input#alias_anime').attr('value') || id;
  
  const episodes = [];

  if (movieId) {
    // Use GogoAnime AJAX endpoint for proper episode listing
    try {
      // First get total episode count from ep_start/ep_end
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
      // Fallback to page-based extraction
    }
  }

  // Fallback: extract from page range if AJAX failed
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

  // Sort ascending by episode number
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

  // Primary: find the streaming.php / gogoplay / gogohd / embtaku iframe
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

  // Secondary: grab any other video iframes as fallback
  if (sources.length === 0) {
    $('iframe').each((i, el) => {
      const src = $(el).attr('src');
      if (src && src.startsWith('http') && !src.includes('google') && !src.includes('ads')) {
        sources.push({ url: src, quality: "fallback", isM3U8: false });
      }
    });
  }

  // Fallback: check for direct download links
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

module.exports = { search, details, extractVideo };
