import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import MangaRead from './providers/mangaread'; // Correct relative path from root

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_KEY || '');
const mangaread = new MangaRead();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function mineTop100Manga() {
    console.log('🚀 Starting Smart Top 100 Manga Miner for MangaRead...');
    
    // 1. PRE-FETCH BOT MEMORY: Grab current chapter counts from Supabase
    console.log('🧠 Loading bot memory from Supabase...');
    const { data: existingRecords, error: fetchError } = await supabase
        .from('manga_links')
        .select('manga_id, chapters_data');
        
    if (fetchError) {
        console.error('❌ Failed to load bot memory:', fetchError.message);
        return;
    }

    // Map manga_id -> number of chapters currently saved
    const dbMemory = new Map<string, number>();
    existingRecords?.forEach(record => {
        const chapCount = record.chapters_data ? record.chapters_data.length : 0;
        dbMemory.set(record.manga_id, chapCount);
    });
    console.log(`✅ Memory loaded! Bot remembers the chapter counts for ${dbMemory.size} manga series.`);

    let totalMined = 0;
    const targetAmount = 100; // Reduced from 300 to 100
    let page = 1;

    try {
        while (totalMined < targetAmount) {
            console.log(`\n📄 Fetching trending page ${page}...`);
            const mangaList = await mangaread.fetchTopManga(page);
            
            if (mangaList.length === 0) break; 

            for (const manga of mangaList) {
                if (totalMined >= targetAmount) break;

                const mangaTitle = typeof manga.title === 'string' ? manga.title : (manga.title.english || Object.values(manga.title)[0] || 'Unknown Title');
                console.log(`⏳ [${totalMined + 1}/100] Checking: ${mangaTitle}`);
                try {
                    // Fetch the latest info from the website
                    const fullInfo = await mangaread.fetchMangaInfo(manga.id);
                    const scrapedChapterCount = fullInfo.chapters?.length || 0;
                    
                    // Check what the bot remembers for this specific manga ID
                    const savedChapterCount = dbMemory.get(manga.id) || 0;

                    // 2. THE SMART SKIP LOGIC
                    if (savedChapterCount === scrapedChapterCount && scrapedChapterCount > 0) {
                        console.log(`   ⏭️ SKIPPED: Already up to date (Has all ${savedChapterCount} chapters).`);
                    } else {
                        console.log(`   🆕 UPDATE FOUND: DB had ${savedChapterCount} chapters, now has ${scrapedChapterCount}! Saving...`);
                        
                        const { error } = await supabase.from('manga_links').upsert({ 
                            title: mangaTitle.toLowerCase().trim(), 
                            manga_id: manga.id, 
                            provider: mangaread.name,
                            chapters_data: fullInfo.chapters,
                            updated_at: new Date()
                        }, { onConflict: 'title, provider' });

                        if (error) throw error;
                        console.log(`   ✅ DB Updated successfully.`);
                    }

                } catch (err: any) {
                    console.error(`   ❌ Failed to process ${mangaTitle}: ${err.message}`);
                }
                
                totalMined++;
                await delay(1500); // 1.5s delay to prevent IP bans
            }
            page++;
        }
        console.log('\n🎉 Smart Top 100 Daily Manga Miner completed successfully!');
    } catch (err: any) {
        console.error(`❌ Miner failed: ${err.message}`);
    }
}

mineTop100Manga();
