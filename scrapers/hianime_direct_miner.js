const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

puppeteer.use(StealthPlugin());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function mineSeries(query) {
    console.log(`🚀 Starting Full Series Mine for: ${query}`);
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();

    try {
        // 1. Search for the Anime
        await page.goto(`https://hianime.to/search?keyword=${encodeURIComponent(query)}`, { waitUntil: 'networkidle2' });
        await page.waitForSelector('.film-detail .film-name a');
        const animeLink = await page.$eval('.film-detail .film-name a', el => el.href);
        const animeId = animeLink.split('-').pop();
        const fullTitle = await page.$eval('.film-detail .film-name a', el => el.textContent.trim());

        console.log(`📌 Found Anime: ${fullTitle} (ID: ${animeId})`);

        // 2. Get Episode List via AJAX
        await page.goto(`https://hianime.to/ajax/v2/episode/list/${animeId}`, { waitUntil: 'networkidle2' });
        const epListData = await page.evaluate(() => JSON.parse(document.body.innerText));

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

        console.log(`📂 Total Episodes to mine: ${episodes.length}`);

        // 3. Loop through episodes and extract direct links
        // To prevent GitHub Action timeout, we mine in sequence but focus on speed
        for (const ep of episodes) {
            try {
                console.log(`🔍 Mining Episode ${ep.num}...`);

                // Intercept network requests to catch the .m3u8 stream
                await page.setRequestInterception(true);
                let directUrl = null;

                const requestHandler = request => {
                    const url = request.url();
                    if (url.includes('.m3u8') || (url.includes('source') && url.includes('.mp4'))) {
                        directUrl = url;
                    }
                    request.continue();
                };

                page.on('request', requestHandler);

                // Navigate to the episode page
                const epUrl = `https://hianime.to/watch/${animeId}?ep=${ep.id}`;
                await page.goto(epUrl, { waitUntil: 'networkidle2', timeout: 30000 });

                // Small delay to let the player load and trigger requests
                await new Promise(r => setTimeout(r, 5000));

                if (directUrl) {
                    console.log(`✅ SUCCESS: Ep ${ep.num} -> ${directUrl}`);
                    await supabase.from('anime_links').upsert({
                        title: query.toLowerCase().trim(),
                        episode: parseInt(ep.num),
                        url: directUrl,
                        type: 'm3u8'
                    }, { onConflict: 'title, episode, type' });
                } else {
                    console.log(`⚠️ FAILED: Could not find direct stream for Ep ${ep.num}`);
                }

                // Clean up listener for next episode
                page.off('request', requestHandler);
                await page.setRequestInterception(false);

            } catch (epErr) {
                console.error(`❌ Error mining Episode ${ep.num}:`, epErr.message);
            }
        }

    } catch (err) {
        console.error("💀 Global Mining Error:", err.message);
    } finally {
        await browser.close();
        console.log("🏁 Mining Session Finished.");
    }
}

const args = process.argv.slice(2);
if (args[0]) {
    mineSeries(args[0]);
} else {
    console.error("Usage: node hianime_direct_miner.js <anime_title>");
}
