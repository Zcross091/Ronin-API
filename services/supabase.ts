import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';

export const supabase: SupabaseClient | null = (supabaseUrl && supabaseKey) 
    ? createClient(supabaseUrl, supabaseKey) 
    : null;

export function buildVariants(input: string | string[]): string[] {
    if (!input) return [];
    const titles = Array.isArray(input) ? input : [input];
    const allVariants: string[] = [];

    titles.forEach(t => {
        if (!t) return;
        const base = t.toLowerCase().trim();

        const withSpaces = base.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
        const noSymbols = base.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
        const noSpaces = withSpaces.replace(/\s+/g, '');
        const noSeason = withSpaces.replace(/\s*(season|part|tv|cour)\s*\d*\s*$/i, '').trim();
        const withHyphens = withSpaces.replace(/\s+/g, '-');
        const baseHyphenated = base.replace(/\s+/g, '-');
        const pureAlphaNumeric = base.replace(/[^a-z0-9]/g, '');

        const subs = [base, withSpaces, noSymbols, noSpaces, noSeason, withHyphens, baseHyphenated, pureAlphaNumeric];
        allVariants.push(...subs, ...subs.map(s => `${s} dub`));
    });

    return [...new Set(allVariants)];
}

export async function getCachedStreams(title: string, episode: number, isDub = false) {
    if (!supabase) return null;

    const variants = buildVariants(isDub ? `${title} dub` : title);
    try {
        const { data, error } = await supabase
            .from('anime_links')
            .select('title, episode, type, url')
            .in('title', variants)
            .eq('episode', episode);

        if (error || !data || data.length === 0) return null;
        return data;
    } catch (e: any) {
        console.error('❌ Supabase getCachedStreams error:', e.message);
        return null;
    }
}

export async function saveStreamToSupabase(title: string, episode: number, type: string, url: string) {
    if (!supabase) return;

    try {
        const { error } = await supabase.from('anime_links').upsert(
            { title: title.toLowerCase().trim(), episode, type, url },
            { onConflict: 'title, episode, type' }
        );
        if (error) console.error('❌ Supabase Save Error:', error.message);
        else console.log(`✅ Cached to Supabase: [${title}] Ep ${episode} (${type})`);
    } catch (e: any) {
        console.error('❌ Supabase Save Exception:', e.message);
    }
}
