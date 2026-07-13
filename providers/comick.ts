import axios from 'axios';
import MangaParser from '../models/manga-parser';
import { IMangaInfo, IMangaChapterPage, IMangaResult, ISearch } from '../models/types';
import { IMangaChapter } from '../models/types';

class Comick extends MangaParser {
  override readonly name = 'Comick';
  protected override baseUrl = 'https://comick.io';
  protected override logo = 'https://comick.io/static/icons/unicorn-256_maskable.png';
  protected override classPath = 'MANGA.Comick';

  private apiUrl = 'https://api.comick.fun';

  override async search(query: string, page: number = 1): Promise<ISearch<IMangaResult>> {
    const url = `${this.apiUrl}/v1.0/search?q=${encodeURIComponent(query)}&tachiyomi=true&page=${page}`;
    
    try {
      const { data } = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      const results = data.map((item: any) => ({
        id: item.slug,
        title: item.title,
        altTitles: item.md_titles ? item.md_titles.map((t: any) => t.title) : [],
        description: item.desc,
        image: item.cover_url ? item.cover_url : `https://meo.comick.pictures/${item.md_covers?.[0]?.b2key}`,
        status: undefined,
        releaseDate: item.year,
      }));

      return {
        currentPage: page,
        hasNextPage: data.length === 30, // Assuming 30 is the limit
        results,
      };
    } catch (err: any) {
      throw new Error(`Comick search failed: ${err.message}`);
    }
  }

  override async fetchMangaInfo(mangaId: string): Promise<IMangaInfo> {
    try {
      const comicUrl = `${this.apiUrl}/comic/${mangaId}?tachiyomi=true`;
      const { data } = await axios.get(comicUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      const lang = '&lang=en';
      const chapUrlReq = `${this.apiUrl}/comic/${mangaId}/chapters?${lang}&tachiyomi=true&page=1`;
      
      const chapInitRes = await axios.get(chapUrlReq);
      const total = chapInitRes.data.total;
      
      const newChapUrlReq = `${this.apiUrl}/comic/${mangaId}/chapters?limit=${total}${lang}&tachiyomi=true&page=1`;
      const chapRes = await axios.get(newChapUrlReq);
      
      const chapters: IMangaChapter[] = chapRes.data.chapters.map((chapter: any) => {
        let title = chapter.title || `Chapter ${chapter.chap}`;
        if (chapter.vol && chapter.chap) {
           title = `Vol. ${chapter.vol} Ch. ${chapter.chap} ${chapter.title ? '- ' + chapter.title : ''}`;
        }
        
        return {
          id: chapter.hid,
          title: title.trim(),
          volume: chapter.vol ? Number(chapter.vol) : undefined,
          releaseDate: chapter.created_at,
          scanlator: chapter.group_name ? chapter.group_name[0] : undefined
        };
      });

      return {
        id: mangaId,
        title: data.comic.title,
        altTitles: data.comic.md_titles ? data.comic.md_titles.map((t: any) => t.title) : [],
        description: data.comic.desc,
        image: `https://meo.comick.pictures/${data.comic.md_covers?.[0]?.b2key}`,
        authors: data.authors?.map((a: any) => a.name) || [],
        genres: data.comic.md_comic_md_genres?.map((g: any) => g.md_genres.name) || [],
        status: data.comic.status === 1 ? 'Ongoing' : data.comic.status === 2 ? 'Completed' : 'Unknown' as any,
        chapters,
      };
    } catch (err: any) {
      throw new Error(`Comick fetchMangaInfo failed: ${err.message}`);
    }
  }

  override async fetchChapterPages(chapterId: string): Promise<IMangaChapterPage[]> {
    try {
      const url = `${this.apiUrl}/chapter/${chapterId}?tachiyomi=true`;
      const { data } = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      return data.chapter.images.map((image: any, index: number) => ({
        img: image.url,
        page: index + 1
      }));
    } catch (err: any) {
      throw new Error(`Comick fetchChapterPages failed: ${err.message}`);
    }
  }
}

export default Comick;
