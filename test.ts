import Gogoanime from './providers/gogoanime';

(async () => {
  const gogo = new Gogoanime();
  try {
    const search = await gogo.fetchEpisodeSources('naruto-episode-1');
    console.log(JSON.stringify(search, null, 2));
  } catch (e) {
    console.error(e);
  }
})();
