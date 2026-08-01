// HiAnime Scraper
// Written for the RoninX QuickJS Engine
// Supports dynamic domain cluster via HIANIME_CLUSTER env variable

const HIANIME_DOMAINS = (typeof process !== 'undefined' && process.env && process.env.HIANIME_CLUSTER)
  ? process.env.HIANIME_CLUSTER.split(',').map(d => d.trim().replace(/\/(popular|home)\/?$/i, '').replace(/\/$/, '')).filter(Boolean)
  : ["https://hianime.to", "https://hianime.nz", "https://aniwatch.to"];

async function search(params) {
  const query = params.query;
  const results = [];

  for (const baseUrl of HIANIME_DOMAINS) {
    try {
      const html = await fetchHtml(`${baseUrl}/search?keyword=${encodeURIComponent(query)}`);
      const $ = cheerio.load(html);
      
      $('.film_list-wrap .flw-item').each((i, el) => {
        const a = $(el).find('.film-poster a');
        const img = $(el).find('.film-poster img').attr('data-src') || $(el).find('.film-poster img').attr('src');
        const title = $(el).find('.film-name a').text().trim();
        const href = a.attr('href') || '';
        const link = href.startsWith('http') ? href : baseUrl + href;
        const id = href.split('?')[0].replace(/^\//, '');
        
        results.push({
          id: id,
          title: title,
          url: link,
          coverUrl: img,
          isManga: false,
          _baseUrl: baseUrl
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
  // Extract base domain from the URL
  const urlObj = new URL(url);
  const baseUrl = `${urlObj.protocol}//${urlObj.hostname}`;
  
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  
  const title = $('.anisc-detail .film-name').text().trim() || $('h2.film-name').text().trim();
  const synopsis = $('.film-description .text').text().trim();
  
  // Extract anime data-id for AJAX episode list
  const animeId = url.split('-').pop() || '';
  const dataId = $('[data-id]').first().attr('data-id') || animeId;
  
  const episodes = [];

  // Use HiAnime AJAX endpoint for episode listing
  try {
    const ajaxUrl = `${baseUrl}/ajax/v2/episode/list/${dataId}`;
    const ajaxRes = await fetchHtml(ajaxUrl);
    
    // The AJAX response is JSON with an HTML property
    let ajaxData;
    try {
      ajaxData = JSON.parse(ajaxRes);
    } catch (e) {
      ajaxData = null;
    }

    if (ajaxData && ajaxData.html) {
      const ep$ = cheerio.load(ajaxData.html);
      ep$('.detail-infor-content .ss-list a, .detail-en-list .item').each((i, el) => {
        const epId = ep$(el).attr('data-id') || ep$(el).attr('data-ids') || '';
        const epNum = ep$(el).attr('data-number') || ep$(el).attr('data-num') || (i + 1).toString();
        const epTitle = ep$(el).attr('title') || ep$(el).text().trim() || `Episode ${epNum}`;
        const epHref = ep$(el).attr('href') || '';
        
        episodes.push({
          id: epId,
          mediaId: dataId,
          title: epTitle,
          number: parseInt(epNum) || i + 1,
          url: epHref.startsWith('http') ? epHref : `${baseUrl}${epHref.startsWith('/') ? '' : '/'}${epHref}`
        });
      });
    }
  } catch (e) {
    // AJAX failed, try page-based fallback
  }

  // Fallback: parse episodes from the main page
  if (episodes.length === 0) {
    $('.episodes-list a, .ss-list a.ep-item, .detail-en-list .item').each((i, el) => {
      const epNum = $(el).attr('data-number') || $(el).attr('data-num') || (i + 1).toString();
      const epHref = $(el).attr('href') || '';
      const epTitle = $(el).attr('title') || $(el).text().trim() || `Episode ${epNum}`;
      
      episodes.push({
        id: `ep-${epNum}`,
        mediaId: dataId,
        title: epTitle,
        number: parseInt(epNum) || i + 1,
        url: epHref.startsWith('http') ? epHref : `${baseUrl}${epHref.startsWith('/') ? '' : '/'}${epHref}`
      });
    });
  }

  // Sort ascending
  episodes.sort((a, b) => a.number - b.number);
  
  return JSON.stringify({
    anime: {
      id: dataId,
      title: title,
      url: url,
      synopsis: synopsis,
      isManga: false
    },
    episodes: episodes.length > 0 ? episodes : [
      { id: dataId, mediaId: dataId, title: "Episode 1", number: 1, url: url + "?ep=1" }
    ]
  });
}

async function extractVideo(params) {
  const url = params.url;
  // Extract base domain from the URL
  const urlObj = new URL(url);
  const baseUrl = `${urlObj.protocol}//${urlObj.hostname}`;
  
  const sources = [];

  // Try HiAnime's AJAX source endpoint
  try {
    // Extract episode data-id from the URL
    const urlParams = new URLSearchParams(urlObj.search);
    const epId = urlParams.get('ep') || url.split('ep=').pop() || '';
    
    if (epId) {
      // HiAnime serves sources via AJAX server endpoints
      const serverAjaxUrl = `${baseUrl}/ajax/v2/episode/servers?episodeId=${epId}`;
      const serverRes = await fetchHtml(serverAjaxUrl);
      
      let serverData;
      try {
        serverData = JSON.parse(serverRes);
      } catch (e) {
        serverData = null;
      }

      if (serverData && serverData.html) {
        const s$ = cheerio.load(serverData.html);
        
        // Get each server's source URL via AJAX
        const serverElements = s$('.server-item, .item').toArray();
        for (const serverEl of serverElements) {
          const serverId = s$(serverEl).attr('data-id') || s$(serverEl).attr('data-server-id') || '';
          const serverName = s$(serverEl).text().trim();
          
          if (serverId) {
            try {
              const sourceAjaxUrl = `${baseUrl}/ajax/v2/episode/sources?id=${serverId}`;
              const sourceRes = await fetchHtml(sourceAjaxUrl);
              
              let sourceData;
              try {
                sourceData = JSON.parse(sourceRes);
              } catch (e) {
                sourceData = null;
              }

              if (sourceData && sourceData.link) {
                sources.push({
                  url: sourceData.link,
                  quality: serverName || "auto",
                  isM3U8: sourceData.link.includes('.m3u8')
                });
              }
            } catch (e) {
              // Skip failed server
            }
          }
        }
      }
    }
  } catch (e) {
    // AJAX source extraction failed
  }

  // Fallback: Extract iframes from the page
  if (sources.length === 0) {
    try {
      const html = await fetchHtml(url);
      const $ = cheerio.load(html);
      
      $('iframe').each((i, el) => {
        const src = $(el).attr('src');
        if (src && src.startsWith('http') && !src.includes('google') && !src.includes('ads')) {
          sources.push({ url: src, quality: "embed", isM3U8: false });
        }
      });
    } catch (e) {
      // Page load failed
    }
  }

  return JSON.stringify({
    sources: sources.length > 0 ? sources : [{ url: "", quality: "none", isM3U8: false }],
    subtitles: []
  });
}

module.exports = { search, details, extractVideo };
