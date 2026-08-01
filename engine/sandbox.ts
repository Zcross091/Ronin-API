import vm from 'vm';
import fs from 'fs/promises';
import axios from 'axios';
import * as cheerio from 'cheerio';

class DocumentPolyfill {
    constructor(html: string = '') {
        const $ = cheerio.load(html || '');
        const wrapNode = (node: any): any => {
            if (!node || node.length === 0) {
                const emptyArr: any[] = [];
                (emptyArr as any).select = () => [];
                (emptyArr as any).selectFirst = () => null;
                (emptyArr as any).getSrc = '';
                (emptyArr as any).getHref = '';
                (emptyArr as any).text = '';
                return emptyArr;
            }
            const el = $(node);
            const resNode: any = {
                select: (sel: string) => {
                    const found = el.find(sel).toArray().map((child: any) => wrapNode(child));
                    (found as any).select = (s: string) => el.find(s).toArray().map((c: any) => wrapNode(c));
                    return found;
                },
                selectFirst: (sel: string) => wrapNode(el.find(sel).first()),
                get getSrc() { return el.attr('src') || el.attr('data-src') || ''; },
                get getHref() { return el.attr('href') || ''; },
                get text() { return el.text().trim(); },
                attr: (name: string) => el.attr(name),
                textStr: el.text().trim(),
                length: el.length
            };
            return resNode;
        };
        return wrapNode($.root());
    }
}

class DOMParserPolyfill {
    parseFromString(html: string) {
        return new DocumentPolyfill(html);
    }
}

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

let sharedBrowser: any = null;

async function getSharedBrowser() {
    if (!sharedBrowser || !sharedBrowser.connected) {
        sharedBrowser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
            ]
        });
    }
    return sharedBrowser;
}

async function fetchWithPuppeteer(url: string, extraHeaders: any = {}): Promise<string> {
    try {
        const browser = await getSharedBrowser();
        const page = await browser.newPage();
        if (extraHeaders && Object.keys(extraHeaders).length > 0) {
            await page.setExtraHTTPHeaders(extraHeaders);
        }
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await new Promise(r => setTimeout(r, 2500));
        const content = await page.evaluate(() => {
            const pre = document.querySelector('pre');
            if (pre) return pre.innerText;
            return document.body ? document.body.innerText : '';
        });
        await page.close();
        return content.trim();
    } catch (e: any) {
        console.error(`Puppeteer fetch failed for ${url}:`, e.message);
        return '';
    }
}

// Polyfills for Mangayomi JS environment
class Client {
    async get(url: string, headersArg: any = {}) {
        let headers = headersArg.headers || headersArg || {};
        if (url.startsWith('/')) {
            const baseUrl = headers["Referer"] || headers["Origin"] || "https://kisskh.co";
            url = baseUrl.replace(/\/$/, '') + url;
        }
        headers["User-Agent"] = headers["User-Agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
        if (url.includes('allanime')) {
            headers["Referer"] = "https://allanime.to";
            headers["Origin"] = "https://allanime.to";
        }
        try {
            const res = await axios.get(url, { headers, timeout: 10000 });
            return { body: typeof res.data === 'string' ? res.data : JSON.stringify(res.data) };
        } catch (e: any) {
            if (e.response?.status === 403 || e.code === 'ECONNRESET' || url.includes('allanime') || url.includes('sudatchi') || url.includes('animeonsen')) {
                console.log(`⚠️ Client GET status ${e.response?.status || e.code} on ${url}. Attempting Puppeteer Stealth fallback...`);
                const body = await fetchWithPuppeteer(url, headers);
                if (body && (body.startsWith('{') || body.startsWith('['))) {
                    return { body };
                }
            }
            console.error("Client GET Error:", url, e.message);
            return { body: '{"data":null}' };
        }
    }
    async post(url: string, headersArg: any = {}, body: any = null) {
        let headers = headersArg.headers || headersArg || {};
        if (url.startsWith('/')) {
            const baseUrl = headers["Referer"] || headers["Origin"] || "https://kisskh.co";
            url = baseUrl.replace(/\/$/, '') + url;
        }
        headers["User-Agent"] = headers["User-Agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
        if (url.includes('allanime')) {
            headers["Referer"] = "https://allanime.to";
            headers["Origin"] = "https://allanime.to";
        }
        try {
            const res = await axios.post(url, body, { headers, timeout: 10000 });
            return { body: typeof res.data === 'string' ? res.data : JSON.stringify(res.data) };
        } catch (e: any) {
            if (e.response?.status === 403 || e.code === 'ECONNRESET' || url.includes('allanime') || url.includes('sudatchi') || url.includes('animeonsen')) {
                console.log(`⚠️ Client POST status ${e.response?.status || e.code} on ${url}. Attempting Puppeteer Stealth fallback...`);
                const puppeteerBody = await fetchWithPuppeteer(url, headers);
                if (puppeteerBody && (puppeteerBody.startsWith('{') || puppeteerBody.startsWith('['))) {
                    return { body: puppeteerBody };
                }
            }
            return { body: '{"data":null}' };
        }
    }
}

class SharedPreferences {
    get(key: string) { 
        if (key === "preferred_title_style") return "eng";
        if (key === "preferred_sub") return "sub";
        if (key === "alt_hoster_selection1") return ["player", "vidstreaming", "dood", "okru", "mp4upload"];
        if (key.includes("kisskh") || key.includes("kiss")) return "https://kisskh.co";
        if (key.includes("animetsu")) return "https://animetsu.bz";
        if (key.includes("animeonsen")) return "https://animeonsen.xyz";
        if (key.includes("sudatchi")) return "https://sudatchi.com";
        if (key.includes("animegg")) return "https://www.animegg.org";
        if (key.includes("base_url") || key === "baseUrl" || key === "domain" || key === "host") return "https://kisskh.co";
        return "";
    }
    getString(key: string) { return this.get(key) || ""; }
    getStringList(key: string) { return this.get(key) || []; }
    getInt(key: string) { return 0; }
    set(key: string, value: string) {}
}

class MProvider {
    source: any;
    constructor() {}
    decryptSource(url: string) { return url; } // Helper for AllAnime
    parseStatus(status: string) { return 0; }
}

// Extractor Stubs (For JS files that rely on Mangayomi internal extractors)
const gogoCdnExtractor = async (url: string) => { return [{ url, quality: "auto", originalUrl: url }]; };
const doodExtractor = async (url: string) => { return [{ url, quality: "dood", originalUrl: url }]; };
const okruExtractor = async (url: string) => { return [{ url, quality: "okru", originalUrl: url }]; };
const mp4UploadExtractor = async (url: string) => { return [{ url, quality: "mp4upload", originalUrl: url }]; };

class AllAnimeExtractor {
    constructor(private headers: any, private url: string) {}
    async videoFromUrl(url: string, quality: string) {
        return [{ url, quality, originalUrl: url }];
    }
}

export class ExtensionRunner {
    private scriptPath: string;
    private context: any;
    private instance: any;

    constructor(scriptPath: string) {
        this.scriptPath = scriptPath;
    }

    async load() {
        const code = await fs.readFile(this.scriptPath, 'utf8');
        
        const contextObj = {
            Client,
            SharedPreferences,
            MProvider,
            AllAnimeExtractor,
            gogoCdnExtractor,
            doodExtractor,
            okruExtractor,
            mp4UploadExtractor,
            console: console,
            JSON: JSON,
            parseInt: parseInt,
            parseFloat: parseFloat,
            Document: DocumentPolyfill,
            DOMParser: DOMParserPolyfill,
            mangayomiSources: []
        };

        this.context = vm.createContext(contextObj);

        // String Prototypes Polyfills required by Mangayomi JS scripts
        const polyfillCode = `
            String.prototype.substringAfter = function(str) { return this.split(str)[1] || ""; };
            String.prototype.substringBefore = function(str) { return this.split(str)[0] || ""; };
            String.prototype.substringAfterLast = function(str) { const parts = this.split(str); return parts[parts.length - 1] || ""; };
            String.prototype.substringBeforeLast = function(str) { const parts = this.split(str); return parts.slice(0, -1).join(str) || ""; };
        `;

        const instanceCode = `
            const instance = new DefaultExtension();
            if (typeof mangayomiSources !== 'undefined' && mangayomiSources.length > 0) {
                instance.source = mangayomiSources[0];
            }
            instance;
        `;

        // Execute all code in one go so 'const mangayomiSources' is in the same scope
        this.instance = vm.runInContext(polyfillCode + '\n' + code + '\n' + instanceCode, this.context);
    }

    async search(query: string, page: number = 1) {
        if (!this.instance.search) throw new Error("Extension does not support search");
        return await this.instance.search(query, page, []);
    }

    async getPopular(page: number = 1) {
        if (!this.instance.getPopular) throw new Error("Extension does not support getPopular");
        return await this.instance.getPopular(page);
    }

    async getLatestUpdates(page: number = 1) {
        if (!this.instance.getLatestUpdates) throw new Error("Extension does not support getLatestUpdates");
        return await this.instance.getLatestUpdates(page);
    }

    async getDetail(url: string) {
        if (!this.instance.getDetail) throw new Error("Extension does not support getDetail");
        return await this.instance.getDetail(url);
    }

    async getVideoList(url: string) {
        if (!this.instance.getVideoList) throw new Error("Extension does not support getVideoList");
        return await this.instance.getVideoList(url);
    }
}
