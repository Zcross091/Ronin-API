import axios from 'axios';

export interface AnimeMetadata {
    title: string;
    englishTitle?: string;
    japaneseTitle?: string;
    synonyms: string[];
    score?: string | null;
    episodes?: number;
    status?: string;
    synopsis?: string;
    image?: string;
    banner?: string;
    genres?: string[];
    nextAiringEpisode?: { episode: number; airingAt: number };
    source: 'jikan' | 'anilist' | 'kitsu' | 'shikimori';
}

/**
 * 4-Tier Anime Metadata Provider Chain:
 * 1. Jikan (api.jikan.moe) - Primary
 * 2. AniList (graphql.anilist.co) - Secondary
 * 3. Kitsu (kitsu.app/api) - Tertiary
 * 4. Shikimori (shikimori.one/api) - Quaternary
 */
export async function fetchAnimeMetadata(searchQuery: string): Promise<AnimeMetadata | null> {
    const cleanQuery = searchQuery.trim();
    if (!cleanQuery) return null;

    // ── Tier 1: Jikan API (api.jikan.moe) ──
    try {
        const jikanRes = await axios.get(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(cleanQuery)}&limit=1`, { timeout: 3500 });
        const anime = jikanRes.data?.data?.[0];
        if (anime) {
            console.log(`✅ Metadata matched via Jikan (Tier 1): "${anime.title}"`);
            return {
                title: anime.title,
                englishTitle: anime.title_english,
                japaneseTitle: anime.title_japanese,
                synonyms: anime.title_synonyms || [],
                score: anime.score ? anime.score.toFixed(1) : null,
                episodes: anime.episodes || 0,
                status: anime.status,
                synopsis: anime.synopsis,
                image: anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url,
                banner: anime.images?.jpg?.large_image_url,
                genres: anime.genres?.map((g: any) => g.name) || [],
                source: 'jikan'
            };
        }
    } catch (e: any) {
        console.warn(`⚠️ Tier 1 (Jikan) failed/timed out (${e.message}). Falling back to Tier 2 (AniList)...`);
    }

    // ── Tier 2: AniList GraphQL (graphql.anilist.co) ──
    try {
        const aniRes = await axios.post('https://graphql.anilist.co', {
            query: `query ($search: String) {
                Media (search: $search, type: ANIME) {
                    id
                    title { romaji english native }
                    synonyms
                    averageScore
                    episodes
                    status
                    description
                    coverImage { extraLarge large }
                    bannerImage
                    genres
                    nextAiringEpisode { episode airingAt }
                }
            }`,
            variables: { search: cleanQuery }
        }, { timeout: 3500 });
        
        const media = aniRes.data?.data?.Media;
        if (media) {
            console.log(`✅ Metadata matched via AniList (Tier 2): "${media.title?.english || media.title?.romaji}"`);
            return {
                title: media.title?.english || media.title?.romaji,
                englishTitle: media.title?.english,
                japaneseTitle: media.title?.native,
                synonyms: media.synonyms || [],
                score: media.averageScore ? (media.averageScore / 10).toFixed(1) : null,
                episodes: media.episodes || 0,
                status: media.status,
                synopsis: media.description?.replace(/<[^>]*>?/gm, ''),
                image: media.coverImage?.extraLarge || media.coverImage?.large,
                banner: media.bannerImage,
                genres: media.genres || [],
                nextAiringEpisode: media.nextAiringEpisode,
                source: 'anilist'
            };
        }
    } catch (e: any) {
        console.warn(`⚠️ Tier 2 (AniList) failed/blocked (${e.message}). Falling back to Tier 3 (Kitsu)...`);
    }

    // ── Tier 3: Kitsu REST API (kitsu.app/api) ──
    try {
        const kitsuRes = await axios.get(`https://kitsu.app/api/edge/anime?filter[text]=${encodeURIComponent(cleanQuery)}&page[limit]=1`, { timeout: 3500 });
        const anime = kitsuRes.data?.data?.[0]?.attributes;
        if (anime) {
            console.log(`✅ Metadata matched via Kitsu (Tier 3): "${anime.canonicalTitle}"`);
            return {
                title: anime.canonicalTitle || anime.titles?.en || anime.titles?.en_jp,
                englishTitle: anime.titles?.en,
                japaneseTitle: anime.titles?.ja_jp,
                synonyms: anime.abbreviatedTitles || [],
                score: anime.averageRating ? (parseFloat(anime.averageRating) / 10).toFixed(1) : null,
                episodes: anime.episodeCount || 0,
                status: anime.status,
                synopsis: anime.synopsis,
                image: anime.posterImage?.original || anime.posterImage?.large,
                banner: anime.coverImage?.original || anime.coverImage?.large,
                genres: [],
                source: 'kitsu'
            };
        }
    } catch (e: any) {
        console.warn(`⚠️ Tier 3 (Kitsu) failed (${e.message}). Falling back to Tier 4 (Shikimori)...`);
    }

    // ── Tier 4: Shikimori API (shikimori.one/api) ──
    try {
        const shikiRes = await axios.get(`https://shikimori.one/api/animes?search=${encodeURIComponent(cleanQuery)}&limit=1`, { timeout: 3500 });
        const anime = shikiRes.data?.[0];
        if (anime) {
            console.log(`✅ Metadata matched via Shikimori (Tier 4): "${anime.name}"`);
            return {
                title: anime.name || anime.russian,
                englishTitle: anime.name,
                japaneseTitle: anime.japanese?.[0] || anime.name,
                synonyms: [],
                score: anime.score ? parseFloat(anime.score).toFixed(1) : null,
                episodes: anime.episodes || 0,
                status: anime.status,
                synopsis: '',
                image: anime.image?.original ? `https://shikimori.one${anime.image.original}` : undefined,
                banner: anime.image?.original ? `https://shikimori.one${anime.image.original}` : undefined,
                genres: [],
                source: 'shikimori'
            };
        }
    } catch (e: any) {
        console.warn(`⚠️ Tier 4 (Shikimori) failed (${e.message}).`);
    }

    return null;
}

/**
 * Returns title search variants derived from the 4-tier provider metadata chain.
 */
export async function getSearchVariants(searchQuery: string): Promise<string[]> {
    const titles = new Set<string>();
    titles.add(searchQuery);

    const meta = await fetchAnimeMetadata(searchQuery);
    if (meta) {
        if (meta.title) titles.add(meta.title);
        if (meta.englishTitle) titles.add(meta.englishTitle);
        if (meta.japaneseTitle && !/[^\x00-\x7F]/.test(meta.japaneseTitle)) titles.add(meta.japaneseTitle);
        if (Array.isArray(meta.synonyms)) {
            meta.synonyms.forEach(s => {
                if (s && s.length < 60 && !/[^\x00-\x7F]/.test(s)) titles.add(s);
            });
        }
    }

    return Array.from(titles);
}
