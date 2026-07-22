import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

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

if (!query) {
    console.error('❌ Usage: ts-node runQuery.ts "anime title" [server] [episode]');
    process.exit(1);
}

async function saveToSupabase(title: string, episode: number, type: string, url: string) {
    const { error } = await supabase.from('anime_links').upsert(
        { title: title.toLowerCase().trim(), episode, type, url },
        { onConflict: 'title, episode, type' }
    );
    if (error) console.error(`❌ Supabase error:`, error.message);
    else console.log(`✅ Saved: [${title}] Ep ${episode} (${type})`);
}

async function scrapeAnimePage(browser: any, animeUrl: string, domain: string): Promise<number> {
    console.log(`\n📚 Scraping series: ${animeUrl}`);
    const page = await browser.newPage();
    let savedCount = 0;

    try {
        await page.goto(animeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        const slugMatch = animeUrl.match(/\/anime\/(.*?)\/?$/i);
        const slugBase = slugMatch ? slugMatch[1].split('-')[0] : '';

        let episodeLinks: string[] = await page.evaluate((base: string) => {
            const links = Array.from(document.querySelectorAll('a')) as HTMLAnchorElement[];
            return [...new Set(
                links
                    .filter(l => l.href && l.href.includes('-episode-') && l.href.includes(base))
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

    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
        ]
    });

    let totalSaved = 0;

    for (const domain of GOGO_DOMAINS) {
        try {
            const searchUrl = `${domain}/?s=${encodeURIComponent(query)}`;
            console.log(`\n🌐 Searching: ${searchUrl}`);

            const searchPage = await browser.newPage();
            await searchPage.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

            const queryBase = query.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');

            const searchResults: string[] = await searchPage.evaluate((base: string) => {
                const links = Array.from(document.querySelectorAll('a')) as HTMLAnchorElement[];
                return [...new Set(
                    links
                        .filter(l => l.href && l.href.includes('/anime/') && l.href.toLowerCase().includes(base))
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

    await browser.close();

    if (totalSaved > 0) {
        console.log(`\n✅ GogoAnime: ${totalSaved} episodes saved.`);
        return true;
    }
    return false;
}

async function mineFromNyaa(query: string): Promise<boolean> {
    try {
        const nyaaUrl = `https://nyaa.si/?f=0&c=1_2&q=${encodeURIComponent(query)}`;
        console.log(`\n🔍 Nyaa.si search: ${nyaaUrl}`);
        const res = await axios.get(nyaaUrl, { timeout: 10000 });
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
            console.log(`✅ Nyaa: ${savedCount} torrent links saved.`);
            return true;
        }
    } catch (e: any) {
        console.log(`❌ Nyaa.si failed: ${e.message}`);
    }
    return false;
}

async function mineFromAniwave(query: string, episodeStr: string): Promise<boolean> {
    const epNum = parseInt(episodeStr) || 1;
    console.log(`\n🔍 Aniwave Puppeteer search for: "${query}" Ep: ${epNum}`);
    
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    let success = false;

    for (const domain of ANIWAVE_CLUSTER) {
        try {
            const searchUrl = `${domain}/?s=${encodeURIComponent(query)}`;
            console.log(`\n🌐 Searching: ${searchUrl}`);
            
            const searchPage = await browser.newPage();
            await searchPage.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            
            const firstResult = await searchPage.evaluate(() => {
                const link = document.querySelector('.item a.name, .bsx a, .film-name a') as HTMLAnchorElement;
                return link ? link.href : null;
            });
            await searchPage.close();

            if (!firstResult) {
                console.log(`⚠️  No results on ${domain}`);
                continue;
            }

            console.log(`🎯 Found anime on ${domain}: ${firstResult}`);
            
            const epPage = await browser.newPage();
            await epPage.goto(firstResult, { waitUntil: 'domcontentloaded', timeout: 30000 });

            // Sometimes episodes are in a list, sometimes we're already on the episode page.
            await epPage.waitForSelector('.episodes a, .eplister ul li a, .ss-list a', { timeout: 10000 }).catch(() => {});
            
            const episodeUrl = await epPage.evaluate((ep) => {
                // Common selectors for animestream, wp themes, and aniwave clones
                const eps = Array.from(document.querySelectorAll('.episodes a, .eplister ul li a, .ss-list a.ep-item')) as HTMLAnchorElement[];
                const target = eps.find(e => 
                    e.getAttribute('data-num') === ep.toString() || 
                    e.getAttribute('data-number') === ep.toString() ||
                    e.innerText.trim().includes(ep.toString()) ||
                    e.querySelector('.epl-num')?.textContent?.includes(ep.toString())
                );
                return target ? target.href : null;
            }, epNum);

            if (!episodeUrl) {
                console.log(`⚠️ Episode ${epNum} not found on ${domain}`);
                // if not found, we might already be on the episode page (if search returned episode direct link)
                // Let's just check if there's an iframe here
            } else {
                console.log(`🎬 Go to Episode: ${episodeUrl}`);
                await epPage.goto(episodeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            }

            await epPage.waitForSelector('iframe', { timeout: 15000 }).catch(() => {});
            
            const iframeSrc = await epPage.evaluate(() => {
                const iframe = document.querySelector('iframe') as HTMLIFrameElement;
                return iframe ? iframe.src : null;
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

    await browser.close();
    return success;
}

async function mineFromHianimeDirect(query: string, episodeStr: string): Promise<boolean> {
    console.log(`\n🚀 Starting HiAnime Direct Series Mine for: ${query} (Ep: ${episodeStr || 'All'})`);
    
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    
    let success = false;
    // Fallback to hianime.to if HIANIME_CLUSTER is empty
    const domains = HIANIME_CLUSTER.length > 0 ? HIANIME_CLUSTER : ['https://hianime.to'];

    for (const domain of domains) {
        const page = await browser.newPage();
        try {
            // 1. Search for the Anime
            const searchUrl = `${domain}/search?keyword=${encodeURIComponent(query)}`;
            console.log(`🌐 Searching: ${searchUrl}`);
            await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            await page.waitForSelector('.flw-item .film-name a', { timeout: 15000 });
            
            const animeLink = await page.$eval('.flw-item .film-name a', (el: any) => el.href);
            const animeId = animeLink.split('-').pop();
            const fullTitle = await page.$eval('.flw-item .film-name a', (el: any) => el.textContent.trim());

            console.log(`🎯 Found Anime: ${fullTitle} (ID: ${animeId})`);

            // 2. Get Episode List via AJAX
            const ajaxUrl = `${domain}/ajax/v2/episode/list/${animeId}`;
            const epListData = await page.evaluate(async (url) => {
                const response = await fetch(url, {
                    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }
                });
                return await response.json();
            }, ajaxUrl);

            // Use a temporary page to parse the HTML from JSON
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

            console.log(`📂 Total Episodes found: ${episodes.length}`);

            let episodesToMine = episodes;
            if (episodeStr) {
                const targetEp = parseInt(episodeStr);
                episodesToMine = episodes.filter(ep => parseInt(ep.num || '') === targetEp);
                if (episodesToMine.length === 0) {
                    console.log(`⚠️ Requested episode ${episodeStr} not found in episode list.`);
                }
            }

            // 3. Loop through episodes and extract direct links & iframe links
            for (const ep of episodesToMine) {
                if (!ep.num || !ep.id) continue;
                try {
                    console.log(`🔍 Mining Episode ${ep.num}...`);

                    // Intercept network requests to catch the .m3u8 stream
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

                    // Navigate to the episode page
                    const epUrl = `${domain}/watch/${animeId}?ep=${ep.id}`;
                    await page.goto(epUrl, { waitUntil: 'networkidle2', timeout: 30000 });

                    // Small delay to let the player load and trigger requests
                    await new Promise(r => setTimeout(r, 6000));

                    // Grab iframe embed URL too
                    const iframeSrc = await page.evaluate(() => {
                        const iframe = document.querySelector('#iframe-embed') as HTMLIFrameElement;
                        return iframe ? iframe.src : null;
                    });

                    // Save direct stream url if found
                    if (directUrl) {
                        console.log(`✅ SUCCESS: Ep ${ep.num} direct stream -> ${directUrl}`);
                        await saveToSupabase(query, parseInt(ep.num || ''), 'm3u8', directUrl);
                        success = true;
                    } else {
                        console.log(`⚠️ Could not find direct stream for Ep ${ep.num}`);
                    }

                    // Save embed iframe if found
                    if (iframeSrc) {
                        console.log(`✅ SUCCESS: Ep ${ep.num} iframe -> ${iframeSrc}`);
                        await saveToSupabase(query, parseInt(ep.num || ''), 'embed', iframeSrc);
                        success = true;
                    }

                    // Clean up listener for next episode
                    page.off('request', requestHandler);
                    await page.setRequestInterception(false);

                } catch (epErr: any) {
                    console.error(`❌ Error mining Episode ${ep.num}:`, epErr.message);
                }
            }

            if (success) {
                await page.close();
                break; // Stop after first successful domain
            }
        } catch (e: any) {
            console.log(`❌ ${domain} failed: ${e.message}`);
        }
        await page.close();
    }

    await browser.close();
    return success;
}

(async () => {
    console.log(`\n🚀 Ronin API One-Shot Query: "${query}" Server: ${serverStr} Ep: ${episodeStr}\n`);

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
        // Run prioritized HiAnime Direct miner first, and fallback to GogoAnime
        console.log(`\n⏳ Step 1: Trying HiAnime Direct Scraper...`);
        const hianimeDirectSuccess = await mineFromHianimeDirect(query, episodeStr);
        
        let gogoSuccess = false;
        if (!hianimeDirectSuccess) {
            console.log(`\n⚠️ HiAnime Direct failed or returned no episodes. Falling back to GogoAnime...`);
            gogoSuccess = await mineFromGogo(query);
        } else {
            console.log(`\n🎉 HiAnime Direct successfully mined episodes. Skipping GogoAnime fallback.`);
        }

        console.log(`\n⏳ Step 2: Mining Nyaa & Aniwave (As alternatives)...`);
        const [nyaaSuccess, aniwaveSuccess] = await Promise.all([
            mineFromNyaa(query),
            mineFromAniwave(query, episodeStr)
        ]);

        if (!hianimeDirectSuccess && !gogoSuccess && !nyaaSuccess && !aniwaveSuccess) {
            console.error(`❌ All sources failed for: "${query}"`);
            process.exit(1);
        }
    }

    console.log(`\n✅ Mining completed for: "${query}"`);
    process.exit(0);
})();
