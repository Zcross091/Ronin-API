const axios = require('axios');

async function test() {
  try {
    console.log("Sending request to FlareSolverr...");
    const res = await axios.post('http://localhost:8191/v1', {
      cmd: 'request.get',
      url: 'https://gogoanime3.co/naruto-episode-1',
      maxTimeout: 60000
    });
    
    const html = res.data.solution.response;
    console.log("FlareSolverr returned HTML of length:", html.length);
    console.log("Preview:", html.substring(0, 500));
    
    // Check if the HTML contains the expected VidCDN link
    const hasVidCdn = html.includes('vidcdn');
    console.log("Has VidCDN class?", hasVidCdn);
    
  } catch (e) {
    console.error("Error:", e.message);
  }
}

test();
