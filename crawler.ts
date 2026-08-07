import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { scrapeGogoanime } from './scrapers/anime/gogoanime';
import { scrapeAnimepahe } from './scrapers/anime/animepahe';
import { closeSharedBrowser } from './scrapers/browserManager';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_KEY || "";
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

async function fetchTop50TrendingFromAniList(): Promise<string[]> {
    try {
        console.log(`\n🌟 Fetching Top 50 Trending & Popular Airing Anime from AniList GraphQL...`);
        const query = `
            query {
                Page(page: 1, perPage: 50) {
                    media(type: ANIME, sort: [TRENDING_DESC, POPULARITY_DESC]) {
                        title {
                            romaji
                            english
                        }
                    }
                }
            }
        `;
        const res = await axios.post('https://graphql.anilist.co', { query }, { timeout: 10000 });
        const mediaList = res.data?.data?.Page?.media || [];
        const titles: string[] = [];
        for (const item of mediaList) {
            const title = item.title?.english || item.title?.romaji;
            if (title && !titles.includes(title)) {
                titles.push(title);
            }
        }
        console.log(`✅ Retrieved ${titles.length} top trending titles from AniList.`);
        return titles;
    } catch (e: any) {
        console.error(`⚠️ Failed to fetch top 50 from AniList:`, e.message);
        return [];
    }
}

async function runCrawler() {
    console.log(`\n🕸️ Starting Ronin Fast Auto-Crawler (Top 50 AniList Pipeline) 🕸️`);
    
    const GOGO_DOMAINS = (process.env.GOGO_DOMAINS || '')
        .split(',')
        .map(d => d.trim().replace(/\/(popular|home)\/?$/i, '').replace(/\/$/, ''))
        .filter(Boolean);

    const top50Titles = await fetchTop50TrendingFromAniList();

    if (top50Titles.length > 0) {
        let totalMined = 0;
        for (let i = 0; i < top50Titles.length; i++) {
            const title = top50Titles[i];
            console.log(`\n=================================================`);
            console.log(`💎 [${i + 1}/${top50Titles.length}] Auto-Mining Series Streams: "${title}"`);
            console.log(`=================================================`);

            try {
                // Step 1: Deep mine via Gogoanime direct scraper (Sub & Dub)
                const gogoStream = await scrapeGogoanime(title, 1, GOGO_DOMAINS);
                let mined = !!gogoStream;

                // Step 2: Fallback to Animepahe Direct scraper if Gogo stream was null
                if (!mined) {
                    console.log(`⏳ Gogo stream unconfirmed for "${title}". Trying Animepahe Direct...`);
                    const paheStream = await scrapeAnimepahe(title, 1);
                    mined = !!paheStream;
                }

                if (mined) {
                    totalMined++;
                    console.log(`🎉 Successfully mined streams for [${i + 1}/${top50Titles.length}] "${title}"`);
                } else {
                    console.log(`⚠️ Completed pass for "${title}".`);
                }
            } catch (err: any) {
                console.error(`❌ Mining failed for "${title}":`, err.message);
            }
        }
        console.log(`\n🎉 Top 50 AniList Auto-Crawl Finished! Mined stream links for ${totalMined}/${top50Titles.length} series.`);
    } else {
        console.log(`⚠️ Fallback: No titles fetched from AniList.`);
    }
}

runCrawler()
    .then(async () => {
        await closeSharedBrowser();
        process.exit(0);
    })
    .catch(async (err) => {
        console.error(err);
        await closeSharedBrowser();
        process.exit(1);
    });
