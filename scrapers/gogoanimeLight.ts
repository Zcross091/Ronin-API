import axios from 'axios';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fetchWithStealthBrowser } from './browserManager';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_KEY || "";
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

async function saveToSupabase(title: string, episode: number, type: string, url: string) {
    if (!supabase) return;
    const { error } = await supabase.from('anime_links').upsert(
        { title: title.toLowerCase().trim(), episode, type, url },
        { onConflict: 'title, episode, type' }
    );
    if (error) console.error("❌ Supabase Error:", error);
    else console.log(`✅ Cached to Supabase: [${title}] Ep ${episode} -> ${url}`);
}

export async function scrapeGogoanimeLight(query: string, epNum: number, domains: string[]): Promise<string | null> {
    const cleanQuery = query.toLowerCase().trim();
    const querySlug = cleanQuery.replace(/[^a-z0-9]+/g, '-');

    for (const domain of domains) {
        try {
            // ── Stage 1: Try direct episode URL prediction first for maximum speed ──
            const directEpUrl = `${domain}/${querySlug}-episode-${epNum}`;
            try {
                const epRes = await axios.get(directEpUrl, {
                    timeout: 6000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                        'Referer': `${domain}/`
                    }
                });
                const ep$ = cheerio.load(epRes.data);
                const iframe = ep$('.play-video iframe, iframe').attr('src');
                if (iframe) {
                    const videoUrl = iframe.startsWith('http') ? iframe : `https:${iframe}`;
                    console.log(`⚡ Instant Direct Gogo Match: [${query}] Ep ${epNum} -> ${videoUrl}`);
                    await saveToSupabase(query, epNum, "embed", videoUrl);
                    return videoUrl;
                }
            } catch (directErr: any) {
                // If 403 or blocked, fallback to Puppeteer Stealth
                if (directErr.response?.status === 403 || directErr.response?.status === 503) {
                    console.log(`⚠️ Stage 1 GET 403/503 on ${directEpUrl}. Triggering Puppeteer Stealth fallback...`);
                    const { iframeSrc } = await fetchWithStealthBrowser(directEpUrl, '.play-video iframe, iframe');
                    if (iframeSrc) {
                        const videoUrl = iframeSrc.startsWith('http') ? iframeSrc : `https:${iframeSrc}`;
                        console.log(`⚡ Stealth Browser Direct Match: [${query}] Ep ${epNum} -> ${videoUrl}`);
                        await saveToSupabase(query, epNum, "embed", videoUrl);
                        return videoUrl;
                    }
                }
            }

            // ── Stage 2: Search Gogoanime catalogue via HTTP ──
            const searchUrl = `${domain}/search.html?keyword=${encodeURIComponent(query)}`;
            let searchHtml = '';
            try {
                const res = await axios.get(searchUrl, {
                    timeout: 8000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                        'Referer': `${domain}/`
                    }
                });
                searchHtml = res.data;
            } catch (e: any) {
                console.log(`⚠️ Search HTTP failed on ${searchUrl} (${e.message}). Falling back to Stealth Browser search...`);
                const stealthRes = await fetchWithStealthBrowser(searchUrl, 'ul.items li p.name a');
                searchHtml = stealthRes.html;
            }

            if (!searchHtml) continue;

            const $ = cheerio.load(searchHtml);
            let chosenResult = $('ul.items li p.name a').first();
            $('ul.items li p.name a').each((_, el) => {
                const text = $(el).text().toLowerCase().trim();
                const href = $(el).attr('href') || '';
                if (text === cleanQuery || href.includes(querySlug)) {
                    chosenResult = $(el);
                }
            });

            if (!chosenResult.length) continue;
            const href = chosenResult.attr('href') || '';
            const seriesSlug = href.replace('/category/', '').replace('/anime/', '').replace(/\/$/, '');
            const episodeUrl = `${domain}/${seriesSlug}-episode-${epNum}`;
            
            let iframeUrl: string | undefined = undefined;

            try {
                const epRes = await axios.get(episodeUrl, {
                    timeout: 8000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                        'Referer': searchUrl
                    }
                });
                const ep$ = cheerio.load(epRes.data);
                const iframe = ep$('.play-video iframe, iframe').attr('src');
                if (iframe) {
                    iframeUrl = iframe.startsWith('http') ? iframe : `https:${iframe}`;
                }
            } catch (epErr) {
                // Fallback to Stealth Browser for episode page
                console.log(`⚠️ Episode HTTP GET failed on ${episodeUrl}. Retrying via Stealth Browser...`);
                const stealthRes = await fetchWithStealthBrowser(episodeUrl, '.play-video iframe, iframe');
                if (stealthRes.iframeSrc) {
                    iframeUrl = stealthRes.iframeSrc.startsWith('http') ? stealthRes.iframeSrc : `https:${stealthRes.iframeSrc}`;
                }
            }
            
            if (iframeUrl) {
                console.log(`✅ Gogo Mined: [${query}] Ep ${epNum} -> ${iframeUrl}`);
                await saveToSupabase(query, epNum, "embed", iframeUrl);
                return iframeUrl;
            }
        } catch (e: any) {
            console.error(`Gogo Light failed on ${domain}: ${e.message}`);
        }
    }
    return null;
}
