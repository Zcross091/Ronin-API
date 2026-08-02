import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { waterfallMine, mineExtensionAllEpisodes, EXTENSION_WATERFALL } from './engine/waterfall';
import { scrapeGogoanimeLight } from './scrapers/anime/gogoanime';
import { getSharedBrowser, closeSharedBrowser } from './scrapers/browserManager';

dotenv.config();
puppeteer.use(StealthPlugin());

const GOGO_DOMAINS = (process.env.GOGO_DOMAINS || '')
    .split(',')
    .map(d => d.trim().replace(/\/(popular|home)\/?$/i, '').replace(/\/$/, ''))
    .filter(Boolean);

const ANIWAVE_CLUSTER = (process.env.ANIWAVE_CLUSTER || '')
    .split(',')
    .map(d => d.trim().replace(/\/$/, ''))
    .filter(Boolean);

const HIANIME_CLUSTER = (process.env.HIANIME_CLUSTER || '')
    .split(',')
    .map(d => d.trim().replace(/\/(popular|home)\/?$/i, '').replace(/\/$/, ''))
    .filter(Boolean);

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_KEY env variables.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const query = process.argv[2];
const serverStr = process.argv[3] || '1';
const episodeStr = process.argv[4] || '';
const forceSource = process.argv[5] || '';

let primaryQueryTitle = query || '';

if (!query) {
    console.error('❌ Usage: ts-node runQuery.ts "anime title" [server] [episode] [forceSource]');
    process.exit(1);
}

// ── Automated Title Variant Resolver ──
async function getSearchVariants(searchQuery: string): Promise<string[]> {
    const titles = new Set<string>();
    titles.add(searchQuery);
    try {
        const res = await axios.post('https://graphql.anilist.co', {
            query: `query ($search: String) {
                Media (search: $search, type: ANIME) {
                    title { romaji english native }
                    synonyms
                }
            }`,
            variables: { search: searchQuery }
        }, { timeout: 3500 });
        
        const media = res.data?.data?.Media;
        if (media) {
            if (media.title?.romaji) titles.add(media.title.romaji);
            if (media.title?.english) titles.add(media.title.english);
            if (Array.isArray(media.synonyms)) {
                media.synonyms.forEach((s: string) => {
                    if (s && s.length < 60 && !/[^\x00-\x7F]/.test(s)) titles.add(s);
                });
            }
        }
    } catch (e) {
        // Fallback to initial query if AniList offline
    }
    return Array.from(titles);
}

async function saveToSupabase(title: string, episode: number, type: string, url: string) {
    const cleanTitle = title.toLowerCase().trim();
    const { error } = await supabase.from('anime_links').upsert(
        { title: cleanTitle, episode, type, url },
        { onConflict: 'title, episode, type' }
    );
    if (error) console.error(`❌ Supabase error:`, error.message);
    else console.log(`✅ Saved: [${cleanTitle}] Ep ${episode} (${type})`);

    // Save under primary query title as well if variant differs
    if (primaryQueryTitle && primaryQueryTitle.toLowerCase().trim() !== cleanTitle) {
        const primaryClean = primaryQueryTitle.toLowerCase().trim();
        try {
            await supabase.from('anime_links').upsert(
                { title: primaryClean, episode, type, url },
                { onConflict: 'title, episode, type' }
            );
        } catch (e) {}
    }
}

async function scrapeAnimePage(browser: any, animeUrl: string, domain: string): Promise<number> {
    console.log(`\n📚 Scraping series: ${animeUrl}`);
    const page = await browser.newPage();
    let savedCount = 0;

    try {
        await page.goto(animeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        const slugMatch = animeUrl.match(/\/(?:anime|category)\/(.*?)\/?$/i);
        const slugBase = slugMatch ? slugMatch[1].split('-')[0].toLowerCase() : '';

        let episodeLinks: string[] = await page.evaluate((base: string) => {
            const links = Array.from(document.querySelectorAll('a')) as HTMLAnchorElement[];
            return [...new Set(
                links
                    .filter(l => l.href && (l.href.includes('-episode-') || l.href.includes('ep-')) && l.href.toLowerCase().includes(base))
                    .map(l => l.href)
            )];
        }, slugBase);

        episodeLinks = episodeLinks.reverse();
        console.log(`   📺 Found ${episodeLinks.length} episodes`);

        for (const url of episodeLinks) {
            const domainHost = new URL(domain).hostname.replace('.', '\\.');
            const match = url.match(new RegExp(`${domainHost}\\/(.*?)-episode-(\\d+)`, 'i'));
            if (!match) continue;

            const rawTitle = match[1];
            const epNum = parseInt(match[2]);
            const title = rawTitle.replace(/-/g, ' ').toLowerCase().trim();

            try {
                const epPage = await browser.newPage();
                await epPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

                const iframeSrc: string | null = await epPage.evaluate(() => {
                    const iframes = Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[];
                    const player = iframes.find(i => i.src && (
                        i.src.includes('.php?id=') ||
                        i.src.includes('.php?ep=') ||
                        i.src.includes('newplayer') ||
                        i.src.includes('embed') ||
                        i.src.includes('gogohd') ||
                        i.src.includes('gogoplay')
                    ));
                    return player ? player.src : null;
                });

                if (iframeSrc) {
                    await saveToSupabase(title, epNum, 'http', iframeSrc);
                    savedCount++;
                }
                await epPage.close();
            } catch {
                console.log(`   ⚠️  Failed ep ${epNum}`);
            }
        }
    } catch (e: any) {
        console.log(`   ❌ Series scrape failed: ${e.message}`);
    }

    await page.close();
    return savedCount;
}

async function mineFromGogo(query: string): Promise<boolean> {
    console.log(`\n🔍 GogoAnime Puppeteer search for: "${query}"`);

    const browser = await getSharedBrowser();
    let totalSaved = 0;

    for (const domain of GOGO_DOMAINS) {
        try {
            const searchUrl = `${domain}/search.html?keyword=${encodeURIComponent(query)}`;
            console.log(`\n🌐 Searching: ${searchUrl}`);

            const searchPage = await browser.newPage();
            await searchPage.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

            const queryBase = query.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');

            const searchResults: string[] = await searchPage.evaluate((base: string) => {
                const primaryLinks = Array.from(document.querySelectorAll('p.name a, .items li a')) as HTMLAnchorElement[];
                const allLinks = Array.from(document.querySelectorAll('a')) as HTMLAnchorElement[];
                
                const linksToSearch = primaryLinks.length > 0 ? primaryLinks : allLinks;
                
                return [...new Set(
                    linksToSearch
                        .filter(l => l.href && (l.href.includes('/category/') || l.href.includes('/anime/')) && l.href.toLowerCase().includes(base))
                        .map(l => l.href)
                )];
            }, queryBase);

            await searchPage.close();

            if (searchResults.length === 0) {
                console.log(`⚠️  No results on ${domain}`);
                continue;
            }

            console.log(`🎯 Found ${searchResults.length} matching anime on ${domain}`);

            for (const animeUrl of searchResults) {
                const count = await scrapeAnimePage(browser, animeUrl, domain);
                totalSaved += count;
            }

            if (totalSaved > 0) break; // Stop after first successful domain
        } catch (e: any) {
            console.log(`❌ ${domain} failed: ${e.message}`);
        }
    }

    if (totalSaved > 0) {
        console.log(`\n✅ GogoAnime: ${totalSaved} episodes saved.`);
        return true;
    }
    return false;
}

async function mineFromNyaa(query: string): Promise<boolean> {
    const nyaaMirrors = ['https://nyaa.si', 'https://nyaa.land'];
    for (const mirror of nyaaMirrors) {
        try {
            const nyaaUrl = `${mirror}/?f=0&c=1_2&q=${encodeURIComponent(query)}`;
            console.log(`\n🔍 Nyaa search: ${nyaaUrl}`);
            const res = await axios.get(nyaaUrl, {
                timeout: 10000,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            });
            const $ = cheerio.load(res.data);

            let savedCount = 0;
            $('table.torrent-list tbody tr').each((_, row) => {
                const title = $(row).find('td[colspan="2"] a').last().text().trim();
                const magnet = $(row).find('td.text-center a[href^="magnet:?"]').attr('href');
                const epMatch = title.match(/(?:ep|episode|e)\s*(\d+)/i) || title.match(/\s(\d{1,3})\s/);
                const epNum = epMatch ? parseInt(epMatch[1]) : 1;
                if (magnet && title) {
                    saveToSupabase(query, epNum, 'torrent', magnet);
                    savedCount++;
                }
            });

            if (savedCount > 0) {
                console.log(`✅ Nyaa: ${savedCount} torrent links saved via ${mirror}.`);
                return true;
            }
        } catch (e: any) {
            console.log(`❌ Nyaa mirror ${mirror} failed: ${e.message}`);
        }
    }
    return false;
}

async function mineFromAniwave(query: string, episodeStr: string): Promise<boolean> {
    const epNum = parseInt(episodeStr) || 1;
    console.log(`\n🔍 Aniwave Puppeteer search for: "${query}" Ep: ${epNum}`);
    
    const browser = await getSharedBrowser();
    let success = false;

    for (const domain of ANIWAVE_CLUSTER) {
        try {
            const searchUrls = [
                `${domain}/?s=${encodeURIComponent(query)}`,
                `${domain}/search?keyword=${encodeURIComponent(query)}`,
                `${domain}/filter?keyword=${encodeURIComponent(query)}`
            ];
            
            let searchPage = await browser.newPage();
            let firstResult: string | null = null;

            for (const searchUrl of searchUrls) {
                console.log(`\n🌐 Searching: ${searchUrl}`);
                try {
                    await searchPage.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                    await new Promise(r => setTimeout(r, 2000));

                    firstResult = await searchPage.evaluate((q: any) => {
                        const links = Array.from(document.querySelectorAll('.item a.name, .bsx a, .film-name a, .card a, a')) as HTMLAnchorElement[];
                        const querySlug = q.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
                        const target = links.find(l => {
                            if (!l.href) return false;
                            const h = l.href.toLowerCase();
                            const cleanHref = h.split('?')[0].split('#')[0];
                            const currentClean = window.location.href.toLowerCase().split('?')[0].split('#')[0];
                            
                            return (h.includes('/anime/') || h.includes('/watch/') || h.includes('/tv/')) && 
                                   h.includes(querySlug) && 
                                   !h.includes('/search') &&
                                   !h.includes('?s=') &&
                                   !h.includes('?keyword=') &&
                                   cleanHref !== currentClean;
                        });
                        return target ? target.href : null;
                    }, query);

                    if (firstResult) break;
                } catch (e) {
                    continue;
                }
            }

            await searchPage.close();

            if (!firstResult) {
                console.log(`⚠️  No results on ${domain}`);
                continue;
            }

            console.log(`🎯 Found anime on ${domain}: ${firstResult}`);
            
            const epPage = await browser.newPage();
            await epPage.goto(firstResult, { waitUntil: 'domcontentloaded', timeout: 30000 });

            await epPage.waitForSelector('.episodes a, .eplister ul li a, .ss-list a', { timeout: 10000 }).catch(() => {});
            
            const episodeUrl = await epPage.evaluate((ep: any) => {
                const eps = Array.from(document.querySelectorAll('.episodes a, .eplister ul li a, .ss-list a.ep-item, a')) as HTMLAnchorElement[];
                const target = eps.find(e => {
                    const text = e.innerText.trim().toLowerCase();
                    const href = e.href.toLowerCase();
                    return (
                        e.getAttribute('data-num') === ep.toString() || 
                        e.getAttribute('data-number') === ep.toString() ||
                        text === ep.toString() ||
                        text === `ep ${ep}` ||
                        text === `episode ${ep}` ||
                        href.endsWith(`-episode-${ep}`) ||
                        href.endsWith(`-ep-${ep}`) ||
                        e.querySelector('.epl-num')?.textContent?.trim() === ep.toString()
                    );
                });
                return target ? target.href : null;
            }, epNum);

            if (episodeUrl) {
                console.log(`🎬 Go to Episode: ${episodeUrl}`);
                await epPage.goto(episodeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            }

            await epPage.waitForSelector('iframe', { timeout: 10000 }).catch(() => {});
            
            const iframeSrc = await epPage.evaluate(() => {
                const iframes = Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[];
                const player = iframes.find(i => i.src && (
                    i.src.includes('embed') || 
                    i.src.includes('vid') || 
                    i.src.includes('player') || 
                    i.src.includes('stream') || 
                    i.src.includes('mega') ||
                    i.src.includes('drive') ||
                    i.src.includes('php?id=') ||
                    i.src.includes('php?ep=')
                ));
                return player ? player.src : null;
            });

            await epPage.close();

            if (iframeSrc) {
                console.log(`✅ Found embed: ${iframeSrc}`);
                await saveToSupabase(query, epNum, 'embed', iframeSrc);
                success = true;
                break;
            }
        } catch (e: any) {
            console.log(`❌ ${domain} failed: ${e.message}`);
        }
    }

    return success;
}

async function mineFromHianimeDirect(query: string, episodeStr: string): Promise<boolean> {
    console.log(`\n🚀 Starting HiAnime Direct Series Mine for: ${query} (Ep: ${episodeStr || 'All'})`);
    
    const browser = await getSharedBrowser();
    let success = false;
    const domains = HIANIME_CLUSTER.length > 0 ? HIANIME_CLUSTER : ['https://hianime.to'];

    for (const domain of domains) {
        const page = await browser.newPage();
        try {
            let searchUrls = [
                `${domain}/search?keyword=${encodeURIComponent(query)}`,
                `${domain}/?s=${encodeURIComponent(query)}`
            ];
            
            let animeLink: string | null = null;
            for (const searchUrl of searchUrls) {
                console.log(`🌐 Searching: ${searchUrl}`);
                try {
                    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                    await new Promise(r => setTimeout(r, 2000));
                    
                    animeLink = await page.evaluate((q: any) => {
                        const primaryLinks = Array.from(document.querySelectorAll('.flw-item .film-name a, .film-detail .film-name a, .item a.name')) as HTMLAnchorElement[];
                        const allLinks = Array.from(document.querySelectorAll('a')) as HTMLAnchorElement[];
                        
                        const linksToSearch = primaryLinks.length > 0 ? primaryLinks : allLinks;
                        
                        const cleanQuery = q.toLowerCase().trim();
                        const querySlug = cleanQuery.replace(/[^a-z0-9]+/g, '-');
                        const queryNoSpace = cleanQuery.replace(/[^a-z0-9]/g, '');

                        let target = linksToSearch.find(l => {
                            if (!l.href) return false;
                            const h = l.href.toLowerCase();
                            const text = (l.innerText || l.textContent || '').toLowerCase().trim();
                            const cleanHref = h.split('?')[0].split('#')[0];
                            const currentClean = window.location.href.toLowerCase().split('?')[0].split('#')[0];
                            
                            const isMatch = text === cleanQuery || h.includes(`/watch/${querySlug}-`) || h.includes(`/${querySlug}`);
                            return isMatch && !h.includes('/search') && !h.includes('?keyword=') && cleanHref !== currentClean;
                        });

                        if (!target) {
                            target = linksToSearch.find(l => {
                                if (!l.href) return false;
                                const h = l.href.toLowerCase();
                                return (h.includes(querySlug) || h.replace(/[^a-z0-9]/g, '').includes(queryNoSpace)) && !h.includes('/search') && !h.includes('?keyword=');
                            });
                        }

                        return target ? target.href : null;
                    }, query);
                    if (animeLink) break;
                } catch (e) {
                    continue;
                }
            }

            if (!animeLink) {
                console.log(`⚠️  No results on ${domain}`);
                await page.close();
                continue;
            }

            console.log(`🎯 Found Anime Link: ${animeLink}`);
            const animeId = animeLink.split('-').pop() || '';

            let episodesToMine: any[] = [];
            
            try {
                const ajaxUrl = `${domain}/ajax/v2/episode/list/${animeId}`;
                const epListData = await page.evaluate((url: string) => {
                    return fetch(url, {
                        headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }
                    }).then(res => res.json());
                }, ajaxUrl);

                if (epListData && epListData.html) {
                    const epPage = await browser.newPage();
                    await epPage.setContent(epListData.html);
                    const episodes = await epPage.evaluate(() => {
                        return Array.from(document.querySelectorAll('.detail-en-list .item')).map(el => ({
                            id: el.getAttribute('data-id'),
                            num: el.getAttribute('data-number'),
                            title: el.getAttribute('title')
                        }));
                    });
                    await epPage.close();
                    episodesToMine = episodes;
                }
            } catch (e) {
                console.log(`⚠️ HiAnime AJAX fetch failed, attempting generic fallback...`);
            }

            if (episodesToMine.length === 0) {
                await page.goto(animeLink, { waitUntil: 'networkidle2', timeout: 30000 });
                await new Promise(r => setTimeout(r, 1500));
                
                const parsedEps = await page.evaluate(() => {
                    const eps = Array.from(document.querySelectorAll('.episodes a, .eplister ul li a, .ss-list a.ep-item, .ss-list a, a')) as HTMLAnchorElement[];
                    const parsedEpisodes: { num: string, url: string }[] = [];
                    for (const e of eps) {
                        const text = e.innerText.trim().toLowerCase();
                        const href = e.href.toLowerCase();
                        let epNum = e.getAttribute('data-num') || e.getAttribute('data-number') || e.getAttribute('data-ep');
                        
                        if (!epNum) {
                            const match = text.match(/ep(?:isode)?\s*(\d+)/) || href.match(/-ep(?:isode)?-(\d+)/) || href.match(/\/ep-(\d+)/);
                            if (match) epNum = match[1];
                        }
                        
                        if (epNum && e.href && !e.href.includes('/search') && !e.href.includes('?keyword=')) {
                            parsedEpisodes.push({ num: epNum, url: e.href });
                        }
                    }
                    return Array.from(new Map(parsedEpisodes.map(item => [item.num, item])).values());
                });
                
                if (parsedEps.length > 0) {
                    episodesToMine = parsedEps.sort((a: any, b: any) => parseInt(a.num) - parseInt(b.num));
                } else {
                    const match = animeLink.match(/-ep(?:isode)?-(\d+)/) || animeLink.match(/\/ep-(\d+)/);
                    const epNum = match ? match[1] : (episodeStr || '1');
                    episodesToMine.push({ num: epNum, url: animeLink });
                }
            }

            console.log(`📂 Total Episodes found: ${episodesToMine.length}`);
            console.log(`⚡ Deep-Dive Series Mining: Mining ${episodesToMine.length} episodes of "${query}"...`);

            for (const ep of episodesToMine) {
                if (!ep.num) continue;
                try {
                    console.log(`🔍 Mining Episode ${ep.num}...`);

                    await page.setRequestInterception(true);
                    let directUrl: string | null = null;

                    const requestHandler = (request: any) => {
                        const url = request.url();
                        if (url.includes('.m3u8') || (url.includes('source') && url.includes('.mp4'))) {
                            directUrl = url;
                        }
                        request.continue();
                    };

                    page.on('request', requestHandler);

                    const epUrl = ep.url ? ep.url : `${domain}/watch/${animeId}?ep=${ep.id}`;
                    await page.goto(epUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

                    // Event-driven fast wait (2.5s instead of 6s static sleep)
                    await new Promise(r => setTimeout(r, 2500));

                    const iframeSrc = await page.evaluate(() => {
                        const iframes = Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[];
                        const player = iframes.find(i => i.src && (
                            i.src.includes('embed') || 
                            i.src.includes('vid') || 
                            i.src.includes('player') || 
                            i.src.includes('stream') || 
                            i.src.includes('mega') ||
                            i.src.includes('drive') ||
                            i.src.includes('php?id=') ||
                            i.src.includes('php?ep=')
                        ));
                        return player ? player.src : null;
                    });

                    if (directUrl) {
                        console.log(`✅ SUCCESS: Ep ${ep.num} direct stream -> ${directUrl}`);
                        await saveToSupabase(query, parseInt(ep.num || ''), 'm3u8', directUrl);
                        success = true;
                    }

                    if (iframeSrc) {
                        console.log(`✅ SUCCESS: Ep ${ep.num} iframe -> ${iframeSrc}`);
                        await saveToSupabase(query, parseInt(ep.num || ''), 'embed', iframeSrc);
                        success = true;
                    }

                    page.off('request', requestHandler);
                    await page.setRequestInterception(false);

                } catch (epErr: any) {
                    console.error(`❌ Error mining Episode ${ep.num}:`, epErr.message);
                }
            }

            await page.close();
            if (success) break;
        } catch (e: any) {
            console.log(`❌ ${domain} failed: ${e.message}`);
            await page.close();
        }
    }

    return success;
}

(async () => {
    console.log(`\n🚀 Ronin API One-Shot Query: "${query}" Server: ${serverStr} Ep: ${episodeStr} ForceSource: ${forceSource}\n`);

    // Always mine Nyaa torrents first regardless of source mode
    try {
        console.log(`\n🏴‍☠️ Always-On Nyaa Torrent Extraction for "${query}"...`);
        await mineFromNyaa(query);
    } catch (e: any) {
        console.log(`⚠️ Nyaa torrent pass note: ${e.message}`);
    }

    if (forceSource && forceSource.toLowerCase() !== 'ronin' && forceSource.toLowerCase() !== 'main server') {
        console.log(`\n⏳ Forcing Deep-Dive extraction from source "${forceSource}" for "${query}" (Requested Ep: ${episodeStr || '1'})...`);
        const targetEpNum = parseInt(episodeStr) || 1;
        try {
            if (forceSource.toLowerCase() === 'gogoanime' || forceSource.toLowerCase() === 'gogoanime direct') {
                console.log(`\n⏳ Mining from GogoAnime Light...`);
                await scrapeGogoanimeLight(query, targetEpNum, GOGO_DOMAINS);
                process.exit(0);
            } else {
                const { minedCount } = await mineExtensionAllEpisodes(forceSource, query, targetEpNum, saveToSupabase);
                if (minedCount > 0) {
                    console.log(`\n✅ Deep-Dive extension mining completed successfully for: "${query}" (${minedCount} episodes saved via "${forceSource}")`);
                    process.exit(0);
                } else {
                    console.error(`❌ Forced extension source "${forceSource}" failed to find streams for: "${query}"`);
                    process.exit(1);
                }
            }
        } catch (err: any) {
            console.error(`❌ Forced source mining crashed:`, err.message);
            process.exit(1);
        }
    }

    if (serverStr === '2') {
        const success = await mineFromAniwave(query, episodeStr);
        if (!success) {
            console.error(`❌ Aniwave failed for: "${query}"`);
            process.exit(1);
        }
    } else if (serverStr === '3') {
        const success = await mineFromHianimeDirect(query, episodeStr);
        if (!success) {
            console.error(`❌ HiAnime failed for: "${query}"`);
            process.exit(1);
        }
    } else {
        const titleVariants = await getSearchVariants(query);
        console.log(`\n🔍 Resolved Title Variants for "${query}":`, titleVariants);

        let overallMined = false;
        for (const titleVar of titleVariants) {
            console.log(`\n=================================================`);
            console.log(`🚀 Mining Pass with Title Variant: "${titleVar}"`);
            console.log(`=================================================`);

            console.log(`\n⏳ Step 1: Running Instant Gogoanime Scraper...`);
            const targetEp = parseInt(episodeStr) || 1;
            const fastGogoResult = await scrapeGogoanimeLight(titleVar, targetEp, GOGO_DOMAINS);
            let gogoSuccess = !!fastGogoResult;

            let hianimeDirectSuccess = false;
            if (!gogoSuccess) {
                console.log(`\n⏳ Trying HiAnime Direct Scraper for "${titleVar}"...`);
                hianimeDirectSuccess = await mineFromHianimeDirect(titleVar, episodeStr);
                if (!hianimeDirectSuccess) {
                    console.log(`\n⚠️ Falling back to GogoAnime Puppeteer for "${titleVar}"...`);
                    gogoSuccess = await mineFromGogo(titleVar);
                }
            }

            let extensionSuccess = false;
            if (!hianimeDirectSuccess && !gogoSuccess) {
                console.log(`\n⏳ Step 2: Running Extension Waterfall for "${titleVar}"...`);
                const targetEp = parseInt(episodeStr) || 1;
                for (const extName of EXTENSION_WATERFALL) {
                    try {
                        const { minedCount } = await mineExtensionAllEpisodes(extName, titleVar, targetEp, saveToSupabase);
                        if (minedCount > 0) {
                            console.log(`🎉 Extension "${extName}" successfully mined ${minedCount} episodes for "${titleVar}"!`);
                            extensionSuccess = true;
                            break;
                        }
                    } catch (e: any) {
                        console.log(`❌ Extension "${extName}" failed for "${titleVar}": ${e.message}`);
                    }
                }
            }

            console.log(`\n⏳ Step 3: Mining Nyaa & Aniwave...`);
            const [nyaaSuccess, aniwaveSuccess] = await Promise.all([
                mineFromNyaa(titleVar),
                mineFromAniwave(titleVar, episodeStr)
            ]);

            if (hianimeDirectSuccess || gogoSuccess || extensionSuccess || nyaaSuccess || aniwaveSuccess) {
                overallMined = true;
                console.log(`🎉 Successfully mined streams using title variant: "${titleVar}"!`);
                
                // Mine Dub version for this successful title variant
                if (!query.toLowerCase().endsWith(' dub')) {
                    console.log(`\n🎙️ Step 4: Checking and mining Dub version for "${titleVar}"...`);
                    try {
                        const targetEp = parseInt(episodeStr) || 1;
                        await mineFromGogo(`${titleVar} dub`);
                        await mineExtensionAllEpisodes('allanime', `${titleVar} dub`, targetEp, saveToSupabase);
                    } catch (dubErr: any) {
                        console.log(`ℹ️ Dub mining notice: ${dubErr.message}`);
                    }
                }
                break;
            }
        }

        if (!overallMined) {
            console.error(`❌ All sources failed for: "${query}" across all title variants.`);
            process.exit(1);
        }
    }

    console.log(`\n✅ Mining completed for: "${query}"`);
    process.exit(0);
})();
