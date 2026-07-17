import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import MangaRead from './providers/mangaread'; // Correct relative path from root

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_KEY || '');
const mangaread = new MangaRead();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function onDemandDeepDive(title: string, requestedChapterNum: string) {
    console.log(`🚀 On-Demand Triggered: ${title} - Chapter ${requestedChapterNum}`);
    
    try {
        // 1. Search for the exact Manga
        const searchRes = await mangaread.search(title, 1);
        if (!searchRes.results.length) throw new Error("Manga not found.");
        
        const manga = searchRes.results[0];
        console.log(`✅ Found: ${manga.title} (${manga.id})`);

        // 2. Fetch full chapter list
        const info = await mangaread.fetchMangaInfo(manga.id);
        const chapters = info.chapters || [];
        
        // Find the specific chapter the user is waiting for
        const targetChap = chapters.find((c: any) => c.title.toLowerCase().includes(`chapter ${requestedChapterNum}`));

        // 3. PRIORITY ACTION: Fetch and save the requested chapter's images immediately!
        if (targetChap) {
            console.log(`⚡ PRIORITY: Mining images for ${targetChap.title}...`);
            await mineAndSaveChapterPages(title, manga.id, targetChap);
        } else {
            console.log(`⚠️ Warning: Chapter ${requestedChapterNum} not found in list.`);
        }

        // 4. BACKGROUND CACHING: Cache all other chapters
        console.log(`\n🔄 Moving to background caching for remaining chapters...`);
        for (const chap of chapters) {
            if (targetChap && chap.id === targetChap.id) continue;
            
            console.log(`Caching ${chap.title}...`);
            await mineAndSaveChapterPages(title, manga.id, chap);
            await delay(1000); 
        }

        console.log(`✅ Fully cached series: ${title}`);

    } catch (e: any) {
        console.error("🔴 On-Demand Mining Failed:", e.message);
    }
}

async function mineAndSaveChapterPages(title: string, mangaId: string, chapter: any) {
    try {
        const pages = await mangaread.fetchChapterPages(chapter.id);
        
        const { error } = await supabase.from('manga_pages').upsert({
            title: title.toLowerCase().trim(),
            manga_id: mangaId,
            chapter_id: chapter.id,
            chapter_title: chapter.title,
            pages_data: pages,
            updated_at: new Date()
        }, { onConflict: 'manga_id, chapter_id' }); 

        if (error) throw error;
        console.log(`   Saved ${pages.length} images for ${chapter.title}.`);
    } catch (err: any) {
        console.log(`   ❌ Failed to process ${chapter.title}: ${err.message}`);
    }
}

const args = process.argv.slice(2);
onDemandDeepDive(args[0], args[1]);
