import path from 'path';
import fs from 'fs/promises';
import { ExtensionRunner } from './sandbox';
import { scrapeGogoanimeLight } from '../scrapers/gogoanimeLight';

// Ordered list of extension script names to try (priority order)
export const EXTENSION_WATERFALL: string[] = [
    'animeonsen',
    'sudatchi',
    'animegg',
    'animeparadise',
    'animez',
    'animetsu',
    'anikoto',
    'allanime',
    'kisskh',
    'senshi',
    'autoembed',
];

// Maximum time to spend on a single extension before giving up (ms)
const PER_SOURCE_TIMEOUT_MS = 15000;

export interface WaterfallResult {
    found: boolean;
    url: string | null;
    source: string;
    title: string;
    episode: number;
    triedSources: { name: string; status: 'success' | 'fail' | 'skipped'; error?: string }[];
}

// Helper to find extension path across all repos and language folders
async function findExtensionPath(extensionName: string): Promise<string | null> {
    const baseDirs = [
        path.join(__dirname, '..', 'extensions', 'm2k3a-extensions', 'javascript', 'anime', 'src'),
        path.join(__dirname, '..', 'extensions', 'swak-extensions', 'javascript', 'anime', 'src'),
    ];
    for (const baseDir of baseDirs) {
        try {
            const langs = await fs.readdir(baseDir);
            for (const lang of langs) {
                const langDir = path.join(baseDir, lang);
                const stat = await fs.stat(langDir);
                if (stat.isDirectory()) {
                    const files = await fs.readdir(langDir);
                    if (files.includes(`${extensionName}.js`)) {
                        return path.join(langDir, `${extensionName}.js`);
                    }
                }
            }
        } catch (e) {
            // Directory doesn't exist or is unreadable, skip
        }
    }
    return null;
}

/**
 * Attempt to run a single extension's full pipeline:
 * search(query) -> getDetail(firstResult) -> getVideoList(firstEpisode)
 */
async function tryExtension(
    extensionName: string,
    query: string,
    episode: number
): Promise<{ url: string | null; error?: string }> {
    const scriptPath = await findExtensionPath(extensionName);
    if (!scriptPath) return { url: null, error: 'Extension file not found' };

    try {
        const runner = new ExtensionRunner(scriptPath);
        await runner.load();

        // Step 1: Search for the anime
        const searchResults = await runner.search(query, 1);
        if (!searchResults?.list || searchResults.list.length === 0) {
            return { url: null, error: 'No search results' };
        }

        // Step 2: Get detail for the first matching result
        const firstResult = searchResults.list[0];
        const detailUrl = firstResult.link || firstResult.url;
        if (!detailUrl) return { url: null, error: 'No detail link in search result' };

        const detail = await runner.getDetail(detailUrl);
        if (!detail) return { url: null, error: 'Could not fetch detail' };

        // Step 3: Find the matching episode
        const episodes = detail.episodes || [];
        let episodeUrl: string | null = null;

        for (const ep of episodes) {
            // Match by episode number in the name or the url
            const epName = (ep.name || '').toLowerCase();
            const epNum = parseInt(epName.replace(/[^0-9]/g, '')) || 0;
            if (epNum === episode) {
                episodeUrl = ep.url || ep.link;
                break;
            }
        }

        // Fallback: if episode list is indexed (ep 1 = index 0)
        if (!episodeUrl && episodes.length >= episode) {
            const ep = episodes[episode - 1];
            episodeUrl = ep?.url || ep?.link;
        }

        if (!episodeUrl) return { url: null, error: `Episode ${episode} not found in ${episodes.length} episodes` };

        // Step 4: Get video stream URLs
        const videos = await runner.getVideoList(episodeUrl);
        if (!videos || (Array.isArray(videos) && videos.length === 0)) {
            return { url: null, error: 'No video sources found' };
        }

        // Return the first valid video URL
        const videoList = Array.isArray(videos) ? videos : (videos.list || [videos]);
        for (const v of videoList) {
            const videoUrl = v.url || v.link || v.videoUrl;
            if (videoUrl && videoUrl.startsWith('http')) {
                return { url: videoUrl };
            }
        }

        return { url: null, error: 'No valid video URLs in response' };
    } catch (e: any) {
        return { url: null, error: e.message || 'Unknown error' };
    }
}

/**
 * Main Waterfall Engine:
 * 1. Try native Gogoanime scraper first
 * 2. Fall through sandbox extensions in priority order
 */
export async function waterfallMine(
    query: string,
    episode: number,
    gogoDomains: string[],
    forceSource?: string
): Promise<WaterfallResult> {
    const triedSources: WaterfallResult['triedSources'] = [];

    // ── If forceSource is provided, only try that source ──
    if (forceSource) {
        if (forceSource.toLowerCase() === 'gogoanime') {
            console.log(`🔍 [Waterfall] Forcing Gogoanime for "${query}" Ep ${episode}...`);
            try {
                const gogoUrl = await scrapeGogoanimeLight(query, episode, gogoDomains);
                triedSources.push({ name: 'Gogoanime (native)', status: gogoUrl ? 'success' : 'fail' });
                if (gogoUrl) {
                    return { found: true, url: gogoUrl, source: 'Gogoanime', title: query, episode, triedSources };
                }
            } catch (e: any) {
                triedSources.push({ name: 'Gogoanime (native)', status: 'fail', error: e.message });
            }
        } else {
            console.log(`🔍 [Waterfall] Forcing extension "${forceSource}" for "${query}" Ep ${episode}...`);
            const resultPromise = tryExtension(forceSource, query, episode);
            const timeoutPromise = new Promise<{ url: null; error: string }>((resolve) =>
                setTimeout(() => resolve({ url: null, error: `Timed out after ${PER_SOURCE_TIMEOUT_MS / 1000}s` }), PER_SOURCE_TIMEOUT_MS)
            );
            const result = await Promise.race([resultPromise, timeoutPromise]);
            triedSources.push({ name: forceSource, status: result.url ? 'success' : 'fail', error: result.error });
            if (result.url) {
                return { found: true, url: result.url, source: forceSource, title: query, episode, triedSources };
            }
        }
        
        return { found: false, url: null, source: forceSource, title: query, episode, triedSources };
    }

    // ── Priority 1: Native Gogoanime Scraper ──
    try {
        console.log(`🔍 [Waterfall] Trying Gogoanime for "${query}" Ep ${episode}...`);
        const gogoUrl = await scrapeGogoanimeLight(query, episode, gogoDomains);
        triedSources.push({ name: 'Gogoanime (native)', status: gogoUrl ? 'success' : 'fail' });

        if (gogoUrl) {
            console.log(`✅ [Waterfall] Found on Gogoanime!`);
            return {
                found: true,
                url: gogoUrl,
                source: 'Gogoanime',
                title: query,
                episode,
                triedSources,
            };
        }
    } catch (e: any) {
        triedSources.push({ name: 'Gogoanime (native)', status: 'fail', error: e.message });
    }

    // ── Priority 2+: Sandbox Extension Waterfall ──
    for (const ext of EXTENSION_WATERFALL) {
        console.log(`🔍 [Waterfall] Trying extension "${ext}" for "${query}" Ep ${episode}...`);

        // Race extension against a timeout
        const resultPromise = tryExtension(ext, query, episode);
        const timeoutPromise = new Promise<{ url: null; error: string }>((resolve) =>
            setTimeout(() => resolve({ url: null, error: `Timed out after ${PER_SOURCE_TIMEOUT_MS / 1000}s` }), PER_SOURCE_TIMEOUT_MS)
        );
        const result = await Promise.race([resultPromise, timeoutPromise]);
        triedSources.push({
            name: ext,
            status: result.url ? 'success' : 'fail',
            error: result.error,
        });

        if (result.url) {
            console.log(`✅ [Waterfall] Found on ${ext}!`);
            return {
                found: true,
                url: result.url,
                source: ext,
                title: query,
                episode,
                triedSources,
            };
        } else {
            console.log(`❌ [Waterfall] ${ext} failed: ${result.error}`);
        }
    }

    // ── All sources exhausted ──
    console.log(`💀 [Waterfall] All sources exhausted for "${query}" Ep ${episode}`);
    return {
        found: false,
        url: null,
        source: 'none',
        title: query,
        episode,
        triedSources,
    };
}
