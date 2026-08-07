const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

let sharedBrowser = null;

async function getSharedBrowser() {
    if (!sharedBrowser || !sharedBrowser.connected) {
        sharedBrowser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--window-size=1920,1080',
            ]
        });
    }
    return sharedBrowser;
}

async function closeSharedBrowser() {
    if (sharedBrowser && sharedBrowser.connected) {
        await sharedBrowser.close();
        sharedBrowser = null;
    }
}

async function fetchWithStealthBrowser(url, waitSelector, timeoutMs = 25000) {
    try {
        const browser = await getSharedBrowser();
        const page = await browser.newPage();
        
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        
        if (waitSelector) {
            await page.waitForSelector(waitSelector, { timeout: 10000 }).catch(() => {});
        } else {
            await new Promise(r => setTimeout(r, 3000));
        }

        const iframeSrc = await page.evaluate(() => {
            const iframes = Array.from(document.querySelectorAll('iframe'));
            const player = iframes.find(i => i.src && (
                i.src.includes('streaming.php') ||
                i.src.includes('embed') ||
                i.src.includes('gogohd') ||
                i.src.includes('gogoplay') ||
                i.src.includes('embtaku') ||
                i.src.includes('vidstreaming') ||
                i.src.includes('player') ||
                i.src.includes('stream')
            ));
            return player ? player.src : (iframes[0]?.src || null);
        });

        const html = await page.content();
        await page.close();

        return { html, iframeSrc: iframeSrc || undefined };
    } catch (e) {
        console.error(`⚠️ Stealth Browser fetch failed for ${url}:`, e.message);
        return { html: '' };
    }
}

module.exports = {
    getSharedBrowser,
    closeSharedBrowser,
    fetchWithStealthBrowser
};
