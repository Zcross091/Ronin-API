import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import MangaDex from './providers/mangadex';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_KEY env variables.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const mangadex = new MangaDex();

// Simple delay function to prevent rate limits
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function saveMangaToSupabase(title: string, mangaId: string, provider: string) {
    const { error } = await supabase.from('manga_links').upsert(
        { title: title.toLowerCase().trim(), manga_id: mangaId, provider },
        { onConflict: 'title, provider' }
    );
    if (error) {
        console.error(`❌ Supabase manga error for ${title}:`, error.message);
    } else {
        console.log(`✅ Saved Manga: [${title}] (${provider})`);
    }
}

async function mineTrendingManga() {
    console.log('🚀 Starting Manga Miner...');
    
    // Check for search query argument (e.g., ts-node manga_miner.ts "One Piece")
    const args = process.argv.slice(2);
    const query = args[0] || '';
    
    try {
        if (query) {
            console.log(`🔍 Fetching manga matching "${query}" from MangaDex...`);
        } else {
            console.log('🔍 Fetching top trending manga from MangaDex...');
        }
        
        const searchResults = await mangadex.search(query, 1);
        
        const mangaList = searchResults.results.slice(0, 30); // Grab top 30
        
        console.log(`📚 Found ${mangaList.length} manga. Commencing deep dive...`);
        
        for (let i = 0; i < mangaList.length; i++) {
            const manga = mangaList[i];
            const title = typeof manga.title === 'string' ? manga.title : (manga.title.english || Object.values(manga.title)[0] || 'Unknown Title');
            
            console.log(`\n⏳ [${i+1}/${mangaList.length}] Deep diving into: ${title} (${manga.id})`);
            
            try {
                // Fetch full info which includes all chapters
                const fullInfo = await mangadex.fetchMangaInfo(manga.id);
                console.log(`   📖 Fetched details & ${fullInfo.chapters?.length || 0} chapters successfully.`);
                
                // Save to database
                await saveMangaToSupabase(title, manga.id, mangadex.name);
            } catch (err: any) {
                console.error(`   ❌ Failed to fetch info for ${title}: ${err.message}`);
            }
            
            // Sleep for 2 seconds to avoid rate limiting
            await delay(2000);
        }
        
        console.log('\n🎉 Daily Manga Miner completed successfully!');
    } catch (err: any) {
        console.error(`❌ Miner failed: ${err.message}`);
    }
}

mineTrendingManga();
