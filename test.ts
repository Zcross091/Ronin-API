import axios from 'axios';

(async () => {
  const embedUrl = 'https://gogohd.net/streaming.php?id=OTc2MDg1';
  try {
    console.log(`Fetching: ${embedUrl}`);
    const res = await axios.get(embedUrl, {
      headers: {
        'Referer': 'https://anitaku.to/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    console.log('Status:', res.status);
    console.log('Headers:', res.headers);
    console.log('Body snippet:', res.data.substring(0, 1000));
  } catch (e: any) {
    console.error('Error Status:', e.response?.status);
    console.error('Error Message:', e.message);
    if (e.response) {
      console.error('Error Body snippet:', e.response.data?.substring?.(0, 1000) || e.response.data);
    }
  }
})();
