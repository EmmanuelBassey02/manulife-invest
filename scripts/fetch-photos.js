'use strict';
// Downloads the demo property photos from Wikimedia Commons into public/assets/img/properties.
const fs = require('fs');
const path = require('path');

const MAP = {
  'lagos-waterfront-residences': ['The Breakers Mansion (Newport RI).jpg', 'Marble House Newport RI.JPG', 'Biltmore House, Biltmore Estate, Asheville, NC (32852473858).jpg'],
  'eko-business-tower': ['At New York City 2025 001 - Hudson Yards skyline, New York, at night.jpg', 'Midtown Manhattan from Weehawken September 2021 HDR.jpg', 'Chicago Skyline Oct 2022 2.jpg'],
  'abuja-green-city': ['Brickell Miami Florida Skyline 31 August 2023.jpg', 'Hudson Yards Plaza March 2019 62.jpg', 'Brickell skyline 2012.jpg'],
  'lekki-pearl-hotel-and-suites': ['Fontainebleau Miami Beach Aerial 2025.jpg', 'Miami Beach - Fountain, Fontainebleau Hotel.jpg', 'DSC33205, Bellagio Hotel and Casino, Las Vegas, Nevada, USA (11687921984).jpg'],
  'ikoyi-crest-apartments': ['Greystone Mansion.JPG', 'Front facade - Casa Grande (Hearst Castle) - DSC06600.JPG', 'Greystone Mansion in Los Angeles-11080895964.jpg'],
  'accra-ridge-offices': ['Chicago (ILL) Willis Tower ( Ex. SEARS Tower ) 1974, N-E side " the loop " (4800298745).jpg', 'Hearst Tower August 2021.jpg', 'Chicago Skyline Oct 2022 2.jpg'],
};
const UA = { 'User-Agent': 'estateinvest-dev/1.0 (demo asset fetch)' };
const dir = path.join(__dirname, '..', 'public', 'assets', 'img', 'properties');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(dir, { recursive: true });
  const credits = [];
  for (const [slug, titles] of Object.entries(MAP)) {
    let i = 0;
    for (const t of titles) {
      i++;
      const api = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1600&titles=' + encodeURIComponent('File:' + t);
      const j = await (await fetch(api, { headers: UA })).json();
      const ii = Object.values(j.query.pages)[0].imageinfo[0];
      const res = await fetch(ii.thumburl, { headers: UA });
      if (!res.ok) throw new Error(`${t}: HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(path.join(dir, `${slug}-${i}.jpg`), buf);
      credits.push(`${slug}-${i}.jpg | ${t} | ${ii.extmetadata.LicenseShortName.value} | ${ii.descriptionurl}`);
      console.log(slug, i, buf.length);
      await sleep(1500);
    }
  }
  fs.writeFileSync(path.join(dir, 'ATTRIBUTION.txt'), credits.join('\n') + '\n');
})().catch((e) => { console.error(e); process.exit(1); });
