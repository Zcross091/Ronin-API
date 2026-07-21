// HiAnime Scraper
// Written for the RoninX QuickJS Engine

async function search(params) {
  const query = params.query;
  const baseUrl = "https://hianime.to";
  
  // Call Dart bridge for network request
  const html = await fetchHtml(`${baseUrl}/search?keyword=${encodeURIComponent(query)}`);
  const $ = cheerio.load(html);
  
  const results = [];
  $('.film_list-wrap .flw-item').each((i, el) => {
    const a = $(el).find('.film-poster a');
    const img = $(el).find('.film-poster img').attr('data-src');
    const title = $(el).find('.film-name a').text();
    const link = baseUrl + a.attr('href');
    const id = a.attr('href').split('?')[0].replace('/', '');
    
    results.push({
      id: id,
      title: title,
      url: link,
      coverUrl: img,
      isManga: false
    });
  });
  
  return JSON.stringify(results);
}

async function details(params) {
  const url = params.url;
  const baseUrl = "https://hianime.to";
  
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  
  const title = $('.anisc-detail .film-name').text().trim();
  const id = url.split('/').pop().split('?')[0];
  const synopsis = $('.film-description .text').text().trim();
  
  // In a real scenario, HiAnime loads episodes via a secondary AJAX call using data-id.
  // For the script structure, we mock the extraction of episodes.
  const episodes = [
    { id: "ep1", mediaId: id, title: "Episode 1", number: 1, url: url + "?ep=1" }
  ];
  
  return JSON.stringify({
    anime: {
      id: id,
      title: title,
      url: url,
      synopsis: synopsis,
      isManga: false
    },
    episodes: episodes
  });
}

async function extractVideo(params) {
  const url = params.url;
  // Usually involves extracting the encrypted server iframe and decrypting it.
  
  return JSON.stringify({
    sources: [
      { url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", quality: "1080p", isM3U8: true }
    ],
    subtitles: []
  });
}

module.exports = { search, details, extractVideo };
