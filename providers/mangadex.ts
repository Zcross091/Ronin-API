import axios from 'axios';
import MangaParser from '../models/manga-parser';
import { IMangaInfo, IMangaChapterPage, IMangaResult, ISearch } from '../models/types';
import { IMangaChapter } from '../models/types';

class MangaDex extends MangaParser {
  override readonly name = 'MangaDex';
  protected override baseUrl = 'https://mangadex.org';
  protected override logo = 'https://mangadex.org/favicon.ico';
  protected override classPath = 'MANGA.MangaDex';

  private apiUrl = 'https://api.mangadex.org';

  override async search(query: string, page: number = 1): Promise<ISearch<IMangaResult>> {
    const limit = 20;
    const offset = (page - 1) * limit;
    const url = `${this.apiUrl}/manga?title=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}&includes[]=cover_art`;
    
    try {
      const { data } = await axios.get(url);

      const results = data.data.map((item: any) => {
        const coverRel = item.relationships.find((rel: any) => rel.type === 'cover_art');
        const coverFileName = coverRel ? coverRel.attributes?.fileName : null;
        const coverUrl = coverFileName ? `https://uploads.mangadex.org/covers/${item.id}/${coverFileName}` : '';

        return {
          id: item.id,
          title: item.attributes.title.en || Object.values(item.attributes.title)[0],
          altTitles: item.attributes.altTitles.map((t: any) => Object.values(t)[0]),
          description: item.attributes.description.en || Object.values(item.attributes.description)[0] || '',
          image: coverUrl,
          status: item.attributes.status,
          releaseDate: item.attributes.year,
        };
      });

      return {
        currentPage: page,
        hasNextPage: data.total > (offset + limit),
        results,
      };
    } catch (err: any) {
      throw new Error(`MangaDex search failed: ${err.message}`);
    }
  }

  override async fetchMangaInfo(mangaId: string): Promise<IMangaInfo> {
    try {
      const comicUrl = `${this.apiUrl}/manga/${mangaId}?includes[]=cover_art&includes[]=author&includes[]=artist`;
      const { data } = await axios.get(comicUrl);
      const item = data.data;

      const coverRel = item.relationships.find((rel: any) => rel.type === 'cover_art');
      const coverFileName = coverRel ? coverRel.attributes?.fileName : null;
      const coverUrl = coverFileName ? `https://uploads.mangadex.org/covers/${item.id}/${coverFileName}` : '';

      const authors = item.relationships
        .filter((rel: any) => rel.type === 'author' || rel.type === 'artist')
        .map((rel: any) => rel.attributes?.name)
        .filter(Boolean);

      const chaptersUrl = `${this.apiUrl}/manga/${mangaId}/feed?translatedLanguage[]=en&order[chapter]=desc&limit=500&includes[]=scanlation_group`;
      const chapRes = await axios.get(chaptersUrl);
      
      const chapters: IMangaChapter[] = chapRes.data.data.map((chapter: any) => {
        let title = `Chapter ${chapter.attributes.chapter}`;
        if (chapter.attributes.volume) {
           title = `Vol. ${chapter.attributes.volume} ` + title;
        }
        if (chapter.attributes.title) {
            title += ` - ${chapter.attributes.title}`;
        }
        
        const scanlatorRel = chapter.relationships.find((rel: any) => rel.type === 'scanlation_group');
        
        return {
          id: chapter.id,
          title: title.trim(),
          volume: chapter.attributes.volume ? Number(chapter.attributes.volume) : undefined,
          releaseDate: chapter.attributes.publishAt,
          scanlator: scanlatorRel ? scanlatorRel.attributes?.name : undefined
        };
      });

      return {
        id: mangaId,
        title: item.attributes.title.en || Object.values(item.attributes.title)[0],
        altTitles: item.attributes.altTitles.map((t: any) => Object.values(t)[0]),
        description: item.attributes.description.en || Object.values(item.attributes.description)[0] || '',
        image: coverUrl,
        authors: [...new Set(authors)] as string[],
        genres: item.attributes.tags.map((tag: any) => tag.attributes.name.en),
        status: item.attributes.status,
        chapters,
      };
    } catch (err: any) {
      throw new Error(`MangaDex fetchMangaInfo failed: ${err.message}`);
    }
  }

  override async fetchChapterPages(chapterId: string): Promise<IMangaChapterPage[]> {
    try {
      const url = `${this.apiUrl}/at-home/server/${chapterId}`;
      const { data } = await axios.get(url);

      const baseUrl = data.baseUrl;
      const hash = data.chapter.hash;

      return data.chapter.data.map((fileName: string, index: number) => ({
        img: `${baseUrl}/data/${hash}/${fileName}`,
        page: index + 1
      }));
    } catch (err: any) {
      throw new Error(`MangaDex fetchChapterPages failed: ${err.message}`);
    }
  }
}

export default MangaDex;
