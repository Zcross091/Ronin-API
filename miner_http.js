require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const CACHE_FILE = './global_cache.json';
let globalCache = {};
if (fs.existsSync(CACHE_FILE)) {
    try { globalCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch(e){}
}
function saveCache() {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(globalCache, null, 2));
}

puppeteer.use(StealthPlugin());
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const GOGO_DOMAINS = process.env.GOGO_DOMAINS 
    ? process.env.GOGO_DOMAINS.split(',').map(d => d.trim().replace(/\/(popular|home)\/?$/i, '').replace(/\/$/, '')) 
    : ['https://gogoanime.or.at', 'https://gogoanimes.cv', 'https://gogoanime.ist'];
const HIANIME_CLUSTER = process.env.HIANIME_CLUSTER 
    ? process.env.HIANIME_CLUSTER.split(',').map(d => d.trim().replace(/\/(popular|home)\/?$/i, '').replace(/\/$/, '')) 
    : ['https://hianimes.ru', 'https://hianime.to'];
const isCI = Boolean(process.env.CI);
const headlessMode = process.env.PUPPETEER_HEADLESS === 'true'
    ? true
    : process.env.PUPPETEER_HEADLESS === 'false'
        ? false
        : isCI;

const searchQuery = process.argv[2];

async function scrapeAnimePage(browser, animeUrl, ignoreCache = false) {
    console.log(`\n📚 DEEP DIVING SERIES: ${animeUrl}`);
    const page = await browser.newPage();
    
    try {
        await page.goto(animeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        const urlObj = new URL(animeUrl);
        const baseUrl = `${urlObj.protocol}//${urlObj.hostname}`;

        const slugMatch = animeUrl.match(/\/(?:anime|category)\/(.*?)\/?$/i);
        const seriesSlug = slugMatch ? slugMatch[1].replace(/\/$/, '') : animeUrl.split('/').filter(Boolean).pop() || '';
        const cleanTitle = seriesSlug.replace(/-(20\d\d|19\d\d)$/, '').replace(/-/g, ' ').toLowerCase().trim();

        // ── 1. Extract GogoAnime AJAX Parameters (movieId & aliasId) ──
        const pageData = await page.evaluate(() => {
            const movieId = document.querySelector('#movie_id')?.getAttribute('value') || document.querySelector('input#movie_id')?.getAttribute('value') || '';
            const aliasId = document.querySelector('#alias_anime')?.getAttribute('value') || document.querySelector('input#alias_anime')?.getAttribute('value') || '';
            
            const lastEpEl = document.querySelector('ul#episode_page li:last-child a');
            const epEnd = lastEpEl ? (lastEpEl.getAttribute('ep_end') || '1') : '1';
            
            return { movieId, aliasId, epEnd };
        });

        let episodeLinks = [];

        // ── 2. Fetch AJAX Episode List (gogoanime.js pattern) ──
        if (pageData.movieId) {
            try {
                const ajaxUrl = `https://ajax.gogocdn.net/ajax/load-list-episode?ep_start=0&ep_end=${pageData.epEnd}&id=${pageData.movieId}&default_ep=0&alias=${pageData.aliasId || seriesSlug}`;
                const ajaxRes = await page.evaluate(async (url) => {
                    const res = await fetch(url);
                    return await res.text();
                }, ajaxUrl);

                // Extract episode links from AJAX response HTML
                const epHrefMatches = [...ajaxRes.matchAll(/href=["']\s*(\/?[^"']*-episode-\d+[^"']*)["']/gi)];
                for (const match of epHrefMatches) {
                    let href = match[1].trim();
                    const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;
                    episodeLinks.push(fullUrl);
                }
                episodeLinks = [...new Set(episodeLinks)];
            } catch (ajaxErr) {
                console.log(`   ⚠️ AJAX episode fetch failed, falling back to DOM extraction...`);
            }
        }

        // ── 3. Fallback: Range prediction if AJAX didn't find links ──
        if (episodeLinks.length === 0 && pageData.epEnd && parseInt(pageData.epEnd) > 0) {
            const totalEps = parseInt(pageData.epEnd);
            console.log(`   ⚡ Generating ${totalEps} direct episode URLs for ${seriesSlug}...`);
            for (let ep = 1; ep <= totalEps; ep++) {
                episodeLinks.push(`${baseUrl}/${seriesSlug}-episode-${ep}`);
            }
        }

        // ── 4. Fallback: Standard DOM scan for episode links ──
        if (episodeLinks.length === 0) {
            episodeLinks = await page.evaluate((slug) => {
                const links = Array.from(document.querySelectorAll('a'));
                return [...new Set(
                    links
                        .filter(l => l.href && l.href.includes('-episode-') && (l.href.toLowerCase().includes(slug) || l.href.includes('/category/') === false))
                        .map(l => l.href)
                )];
            }, seriesSlug.split('-')[0]);
        }
        
        console.log(`   Found ${episodeLinks.length} total episodes for this series!`);
        
        if (episodeLinks.length === 0) {
            console.log(`   ⚠️ No episodes found.`);
            await page.close();
            return;
        }

        let highestCachedEp = 0;
        if (!ignoreCache && cleanTitle && globalCache[cleanTitle] && globalCache[cleanTitle].highest_http_ep) {
            highestCachedEp = globalCache[cleanTitle].highest_http_ep;
            console.log(`   🗃️ CACHE: Found highest HTTP episode: ${highestCachedEp}`);
        }
        
        // Sort numerically by episode number
        episodeLinks.sort((a, b) => {
            const numA = parseInt((a.match(/-episode-(\d+)/i) || [])[1] || '0');
            const numB = parseInt((b.match(/-episode-(\d+)/i) || [])[1] || '0');
            return numA - numB;
        });
        
        let highestMined = highestCachedEp;

        for (let i = 0; i < episodeLinks.length; i++) {
            const url = episodeLinks[i];
            const match = url.match(/(?:.*\/)?([^\/]+)-episode-(\d+)/i);
            if (!match) continue;
            
            const rawTitle = match[1];
            const epNum = parseInt(match[2]);
            const title = rawTitle.replace(/-/g, ' ').toLowerCase().trim();
            
            if (!ignoreCache && epNum <= highestCachedEp) {
                continue;
            }
            
            try {
                const epPage = await browser.newPage();
                await epPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                
                const iframeSrc = await epPage.evaluate(() => {
                    const iframes = Array.from(document.querySelectorAll('iframe'));
                    const player = iframes.find(i => i.src && (
                        i.src.includes('streaming.php') ||
                        i.src.includes('gogoplay') ||
                        i.src.includes('gogohd') ||
                        i.src.includes('embtaku') ||
                        i.src.includes('vidstreaming') ||
                        i.src.includes('embedplus') ||
                        i.src.includes('.php?id=') ||
                        i.src.includes('.php?ep=') ||
                        i.src.includes('newplayer') ||
                        i.src.includes('embed')
                    ));
                    return player ? (player.src.startsWith('http') ? player.src : `https:${player.src}`) : null;
                });
                
                if (iframeSrc) {
                    const { error } = await supabase.from('anime_links').upsert(
                        { title: title, episode: epNum, type: 'http', url: iframeSrc },
                        { onConflict: 'title, episode, type' }
                    );
                    if (!error) {
                        console.log(`      💾 Saved [${title}] Ep ${epNum}`);
                        if (epNum > highestMined) {
                            highestMined = epNum;
                        }
                    }
                } else {
                    console.log(`         ⚠️ No compatible streaming iframe found on Ep ${epNum}.`);
                }
                
                await epPage.close();
            } catch(e) {
                console.log(`      ❌ Error on Ep ${epNum}`);
            }
        }
        
        if (!ignoreCache && cleanTitle && highestMined > highestCachedEp) {
            if (!globalCache[cleanTitle]) globalCache[cleanTitle] = {};
            globalCache[cleanTitle].highest_http_ep = highestMined;
            saveCache();
            console.log(`   🗃️ CACHE: Updated highest HTTP episode to ${highestMined}`);
        }
    } catch(e) {
        console.log(`   ❌ Failed to scrape anime page: ${e.message}`);
    }
    await page.close();
}

async function scrapeHiAnimePage(browser, animeQuery) {
    if (HIANIME_CLUSTER.length === 0) return;
    const domain = HIANIME_CLUSTER[0];
    console.log(`\n📚 HiAnime DEEP DIVE: ${animeQuery} on ${domain}`);
    
    const page = await browser.newPage();
    const url = `${domain}/search?keyword=${encodeURIComponent(animeQuery)}`;
    
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        const firstResult = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('.film_list-wrap .flw-item'));
            if (items.length === 0) return null;
            const titleEl = items[0].querySelector('.film-name a');
            return titleEl ? titleEl.href : null;
        });

        if (firstResult) {
            console.log(`   🎯 Found HiAnime match: ${firstResult}`);
            const watchUrl = firstResult.replace(domain + '/', domain + '/watch/');
            await page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            
            await page.waitForSelector('#iframe-embed', { timeout: 10000 }).catch(() => {});
            
            const iframeSrc = await page.evaluate(() => {
                const iframe = document.querySelector('#iframe-embed');
                return iframe ? iframe.src : null;
            });

            if (iframeSrc) {
                const epNum = 1;
                const cleanTitle = animeQuery.replace(/-/g, ' ').toLowerCase().trim();
                const { error } = await supabase.from('anime_links').upsert(
                    { title: cleanTitle, episode: epNum, type: 'hianime', url: iframeSrc },
                    { onConflict: 'title, episode, type' }
                );
                if (!error) {
                    console.log(`      💾 Saved HiAnime [${cleanTitle}] Ep ${epNum}`);
                }
            } else {
                console.log(`      ⚠️ No embed iframe found on watch page`);
            }
        } else {
            console.log(`   ⚠️ No HiAnime results found for ${animeQuery}`);
        }
    } catch(e) {
        console.error(`   ❌ HiAnime scrape failed:`, e.message);
    } finally {
        await page.close();
    }
}

async function mineHttp() {
    console.log(`🚀 Starting ADVANCED HTTP Stream Miner (Gogoanime.or.at)...`);
    const browser = await puppeteer.launch({
        headless: headlessMode,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=800,600'
        ]
    });
    
    if (searchQuery) {
        console.log(`\n🔍 MANUAL SEARCH MODE: "${searchQuery}"`);
        const searchPage = await browser.newPage();
        try {
            await searchPage.goto(`${GOGO_DOMAINS[0]}/?s=${encodeURIComponent(searchQuery)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
            
            const queryBase = searchQuery.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');

            const searchResults = await searchPage.evaluate((base) => {
                const links = Array.from(document.querySelectorAll('a'));
                return [...new Set(links.filter(l => l.href && l.href.includes('/anime/') && l.href.includes(base)).map(l => l.href))];
            }, queryBase);
            
            await searchPage.close();
            
            if (searchResults.length > 0) {
                console.log(`🎯 Found ${searchResults.length} matching anime series/movies!`);
                for (let i = 0; i < searchResults.length; i++) {
                    await scrapeAnimePage(browser, searchResults[i], true);
                }
            } else {
                console.log(`❌ No anime found for "${searchQuery}"`);
            }
            
            await scrapeHiAnimePage(browser, searchQuery);
        } catch(e) {
            console.log("Search failed:", e.message);
        }
    } else {
        // Trending-Scout Automation Mode
        console.log(`\n🕵️ PHASE 1: Scouting Homepage for Trending Episodes...`);
        const scoutPage = await browser.newPage();
        
        try {
            await scoutPage.goto(GOGO_DOMAINS[0], { waitUntil: 'domcontentloaded', timeout: 30000 });
            const recentEps = await scoutPage.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a'));
                return [...new Set(links.filter(l => l.href && l.href.includes('-episode-')).map(l => l.href))];
            });
            await scoutPage.close();
            
            if (recentEps.length > 0) {
                console.log(`🎯 Scout discovered ${recentEps.length} recent episodes!`);
                
                const activeAnimeUrls = new Set();
                for (const epUrl of recentEps) {
                    const match = epUrl.match(/\/\/[^\/]+\/(.*?)-episode-\d+/i);
                    if (match) {
                        activeAnimeUrls.add(`${GOGO_DOMAINS[0]}/anime/${match[1]}/`);
                    }
                }
                
                const activeList = Array.from(activeAnimeUrls);
                console.log(`\n🚀 PHASE 2: Commencing Deep Dives into ${activeList.length} Active Series...`);
                
                for (let i = 0; i < activeList.length; i++) {
                    console.log(`\n======================================`);
                    console.log(`🔥 DEEP DIVE [${i+1}/${activeList.length}]`);
                    console.log(`======================================`);
                    await scrapeAnimePage(browser, activeList[i]);
                    await new Promise(r => setTimeout(r, 5000));
                }
            } else {
                console.log("❌ Scout failed to find recent episodes.");
            }
        } catch(e) {
            console.log("Scout failed:", e.message);
        }
    }
    
    console.log("\n🎉 HTTP STREAM MINING COMPLETE!");
    await browser.close();
}

mineHttp();
