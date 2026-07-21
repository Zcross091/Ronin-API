const fs = require('fs');
const path = require('path');
const axios = require('axios');
const esbuild = require('esbuild');
const crypto = require('crypto');
const yaml = require('js-yaml');

const OUTPUT_DIR = path.join(__dirname, '../extensions');
const BUNDLE_NAME = 'roninx_master.js';
const MANIFEST_NAME = 'latest.json';
const SOURCES_FILE = path.join(__dirname, '../sources.yml');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function fetchSources() {
  if (!fs.existsSync(SOURCES_FILE)) {
    throw new Error('sources.yml not found. Please run discovery script first.');
  }
  const fileContents = fs.readFileSync(SOURCES_FILE, 'utf8');
  return yaml.load(fileContents);
}

async function downloadExtension(url) {
  const response = await axios.get(url);
  return response.data;
}

async function build() {
  console.log('Starting RoninX Extension Aggregation...');

  const sources = await fetchSources();
  let masterCode = `
    const cheerio = require('cheerio'); 
    const extensions = { anime: {}, manga: {} };
  `;

  // Process Anime extensions
  if (sources.anime) {
    for (const source of sources.anime) {
      console.log(`Downloading anime extension: ${source.name}`);
      try {
        const code = await downloadExtension(source.url);
        masterCode += `
          extensions['anime']['${source.name.toLowerCase()}'] = (function() {
            ${code}
            // Ensure the module exports its functions if it uses module.exports
            if (typeof module !== 'undefined' && module.exports) return module.exports;
            return { search, details, extractVideo };
          })();
        `;
      } catch (err) {
        console.error(`Failed to download ${source.name}: ${err.message}`);
      }
    }
  }

  // Process Manga extensions
  if (sources.manga) {
    for (const source of sources.manga) {
      console.log(`Downloading manga extension: ${source.name}`);
      try {
        const code = await downloadExtension(source.url);
        masterCode += `
          extensions['manga']['${source.name.toLowerCase()}'] = (function() {
            ${code}
            if (typeof module !== 'undefined' && module.exports) return module.exports;
            return { search, details, extractPages };
          })();
        `;
      } catch (err) {
        console.error(`Failed to download ${source.name}: ${err.message}`);
      }
    }
  }

  // Inject the global RoninX router
  masterCode += `
    globalThis.RoninX = {
      route: function(category, sourceId, action, params) {
        if (extensions[category] && extensions[category][sourceId] && extensions[category][sourceId][action]) {
          return extensions[category][sourceId][action](params);
        }
        throw new Error('Action ' + action + ' not found on source ' + sourceId);
      }
    };
  `;

  // Write temporary source file
  const tempPath = path.join(OUTPUT_DIR, 'temp_bundle.js');
  fs.writeFileSync(tempPath, masterCode);

  // 3. Compile with esbuild
  console.log('Compiling bundle with esbuild...');
  await esbuild.build({
    entryPoints: [tempPath],
    bundle: true,
    minify: true,
    outfile: path.join(OUTPUT_DIR, BUNDLE_NAME),
    format: 'iife',
    globalName: 'RoninXEngine',
    external: ['cheerio'],
  });

  // Cleanup temp file
  fs.unlinkSync(tempPath);

  // 4. Cryptography: Sign the bundle
  console.log('Signing bundle...');
  const bundleContent = fs.readFileSync(path.join(OUTPUT_DIR, BUNDLE_NAME));
  
  let privateKey;
  if (process.env.ED25519_PRIVATE_KEY) {
    privateKey = crypto.createPrivateKey({
      key: Buffer.from(process.env.ED25519_PRIVATE_KEY, 'base64'),
      format: 'der',
      type: 'pkcs8'
    });
  } else {
    console.log('No private key provided in env. Generating ephemeral keypair for testing...');
    const { privateKey: tempPriv, publicKey: tempPub } = crypto.generateKeyPairSync('ed25519');
    privateKey = tempPriv;
    console.log('Public Key (Base64 SPKI):', tempPub.export({ format: 'der', type: 'spki' }).toString('base64'));
  }

  const signature = crypto.sign(null, bundleContent, privateKey);
  const signatureBase64 = signature.toString('base64');

  // 5. Generate Manifest (latest.json)
  const timestamp = Date.now().toString();
  const manifest = {
    version: timestamp,
    bundleUrl: \`https://raw.githubusercontent.com/\${process.env.GITHUB_REPOSITORY || 'Zcross091/RoninX-Anime-Client'}/main/extensions/\${BUNDLE_NAME}\`,
    signature: signatureBase64,
    buildDate: new Date().toISOString()
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, MANIFEST_NAME), JSON.stringify(manifest, null, 2));

  console.log('Build complete. Manifest generated.');
}

build().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
