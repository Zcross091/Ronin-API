import axios from 'axios';
import * as cheerio from 'cheerio';
import MangaParser from '../models/manga-parser';
import { IMangaInfo, IMangaChapterPage, IMangaResult, ISearch, IMangaChapter, MediaStatus } from '../models/types';

class MangaRead extends MangaParser {
  override readonly name = 'MangaRead';
  protected override baseUrl = 'https://www.mangaread.org';
  protected override logo = 'https://www.mangaread.org/favicon.ico';
  protected override classPath = 'MANGA.MangaRead';

  private headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  override async search(query: string, page: number = 1): Promise<ISearch<IMangaResult>> {
    try {
      const url = `${this.baseUrl}/page/${page}/?s=${encodeURIComponent(query)}&post_type=wp-manga`;
      const { data } = await axios.get(url, { headers: this.headers });
      const $ = cheerio.load(data);
      const results: IMangaResult[] = [];

      $('.c-tabs-item__content').each((_, el) => {
        const titleNode = $(el).find('.post-title h3 a');
        const title = titleNode.text().trim();
        const url = titleNode.attr('href') || '';
        const id = url.split('/manga/')[1]?.replace(/\/$/, '') || '';
        const image = $(el).find('.tab-thumb a img').attr('data-src') || $(el).find('.tab-thumb a img').attr('src') || '';

        if (id && title) {
          results.push({
            id,
            title,
            image,
            status: MediaStatus.ONGOING, 
            altTitles: [],
            description: ''
          });
        }
      });

      return { currentPage: page, hasNextPage: results.length > 0, results };
    } catch (err: any) {
      throw new Error(`MangaRead search failed: ${err.message}`);
    }
  }

  // Helper method exclusively for the Top 300 Daily Miner
  async fetchTopManga(page: number = 1): Promise<IMangaResult[]> {
    const url = `${this.baseUrl}/manga/page/${page}/?m_orderby=views`;
    const { data } = await axios.get(url, { headers: this.headers });
    const $ = cheerio.load(data);
    const results: IMangaResult[] = [];

    $('.page-item-detail').each((_, el) => {
      const titleNode = $(el).find('.post-title h3 a');
      const id = titleNode.attr('href')?.split('/manga/')[1]?.replace(/\/$/, '') || '';
      results.push({
        id,
        title: titleNode.text().trim(),
        image: $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || '',
        altTitles: [], description: '', status: MediaStatus.UNKNOWN
      });
    });
    return results;
  }

  override async fetchMangaInfo(mangaId: string): Promise<IMangaInfo> {
    try {
      const url = `${this.baseUrl}/manga/${mangaId}/`;
      const { data } = await axios.get(url, { headers: this.headers });
      const $ = cheerio.load(data);

      const title = $('.post-title h1').text().trim();
      const image = $('.summary_image img').attr('data-src') || $('.summary_image img').attr('src') || '';
      const description = $('.description-summary .summary__content').text().trim();
      
      const chapters: IMangaChapter[] = [];
      $('.wp-manga-chapter').each((_, el) => {
        const chapNode = $(el).find('a');
        const chapTitle = chapNode.text().trim();
        const chapUrl = chapNode.attr('href') || '';
        const chapId = chapUrl.replace(this.baseUrl, ''); 

        chapters.push({
          id: chapId, 
          title: chapTitle,
        });
      });

      return {
        id: mangaId,
        title,
        description,
        image,
        chapters: chapters.reverse(), // Madara themes list newest first, reverse for chronological
        genres: [], authors: [], altTitles: [], status: MediaStatus.ONGOING
      };
    } catch (err: any) {
      throw new Error(`MangaRead fetchInfo failed: ${err.message}`);
    }
  }

  override async fetchChapterPages(chapterPath: string): Promise<IMangaChapterPage[]> {
    try {
      const url = `${this.baseUrl}${chapterPath}`;
      const { data } = await axios.get(url, { headers: this.headers });
      const $ = cheerio.load(data);
      const pages: IMangaChapterPage[] = [];

      $('.reading-content img').each((index, el) => {
        const img = $(el).attr('data-src') || $(el).attr('src') || '';
        if (img) {
          pages.push({ img: img.trim(), page: index + 1 });
        }
      });
      return pages;
    } catch (err: any) {
      throw new Error(`MangaRead fetchPages failed: ${err.message}`);
    }
  }
}

export default MangaRead;
