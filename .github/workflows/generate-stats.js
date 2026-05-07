const https = require('https');

function fetch(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'node' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function getRepos(username) {
  const repos = [];
  let page = 1;
  while (true) {
    const { status, data } = await fetch(`https://api.github.com/users/${username}/repos?per_page=100&page=${page}&sort=updated`);
    if (status !== 200) throw new Error(`GitHub API ${status}: ${data.slice(0, 200)}`);
    const parsed = JSON.parse(data);
    repos.push(...parsed);
    if (parsed.length < 100) break;
    page++;
  }
  return repos;
}

async function getEvents(username) {
  const { status, data } = await fetch(`https://api.github.com/users/${username}/events?per_page=100`);
  if (status !== 200) return [];
  return JSON.parse(data);
}

function langColor(lang) {
  const colors = {
    'Java': '#b07219', 'Python': '#3572A5', 'JavaScript': '#f1e05a', 'TypeScript': '#3178c6',
    'CSS': '#563d7c', 'HTML': '#e34c26', 'Shell': '#89e051', 'Dockerfile': '#384d54',
    'SQL': '#e38c00', 'Rust': '#dea584', 'Go': '#00ADD8', 'Kotlin': '#A97BFF',
    'Ruby': '#701516', 'C++': '#f34b7d', 'C': '#555555', 'PHP': '#4F5D95',
    'Swift': '#F05138', 'Dart': '#00B4AB', 'Scala': '#c22d40'
  };
  return colors[lang] || '#8b949e';
}

function escXml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function generateStatsSVG(username, repos) {
  const totalStars = repos.reduce((s, r) => s + r.stargazers_count, 0);
  const totalForks = repos.reduce((s, r) => s + r.forks_count, 0);
  const totalSize = repos.reduce((s, r) => s + r.size, 0);

  const stats = [
    { label: 'Total Repos', value: repos.length, icon: '📚' },
    { label: 'Total Stars', value: totalStars, icon: '⭐' },
    { label: 'Total Forks', value: totalForks, icon: '🍴' },
    { label: 'Total Size', value: (totalSize / 1024).toFixed(1) + ' MB', icon: '💾' },
  ];

  const w = 450, rowH = 38, pad = 20;
  const h = pad + 30 + stats.length * rowH + pad;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><style>text{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif}</style></defs>
  <rect width="${w}" height="${h}" rx="11" fill="#0d1117"/>
  <rect x="0" y="0" width="${w}" height="4" rx="11" fill="#58a6ff"/>
  <text x="${pad}" y="42" fill="#58a6ff" font-size="14" font-weight="600">${escXml(username)}'s GitHub Stats</text>`;

  stats.forEach((s, i) => {
    const y = 65 + i * rowH;
    svg += `
  <text x="${pad}" y="${y}" fill="#c9d1d9" font-size="13">${s.icon} ${escXml(s.label)}</text>
  <text x="${w - pad}" y="${y}" fill="#58a6ff" font-size="13" text-anchor="end" font-weight="600">${escXml(String(s.value))}</text>`;
  });

  svg += `\n</svg>`;
  return svg;
}

function generateTopLangsSVG(repos) {
  const langBytes = {};
  repos.forEach(r => { if (r.language) langBytes[r.language] = (langBytes[r.language] || 0) + r.size; });
  
  const sorted = Object.entries(langBytes).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!sorted.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="450" height="80"><rect width="450" height="80" rx="11" fill="#0d1117"/><text x="20" y="45" fill="#8b949e" font-size="14">No languages found</text></svg>`;
  }

  const total = sorted.reduce((s, [, v]) => s + v, 0) || 1;
  const w = 450, rowH = 28, pad = 20;
  const h = pad + 30 + sorted.length * rowH + pad;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><style>text{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif}</style></defs>
  <rect width="${w}" height="${h}" rx="11" fill="#0d1117"/>
  <rect x="0" y="0" width="${w}" height="4" rx="11" fill="#58a6ff"/>
  <text x="${pad}" y="42" fill="#58a6ff" font-size="14" font-weight="600">Most Used Languages</text>`;

  sorted.forEach(([lang, bytes], i) => {
    const pct = ((bytes / total) * 100).toFixed(1);
    const y = 65 + i * rowH;
    const c = langColor(lang);
    const barW = Math.max(2, (bytes / total) * 170);
    svg += `
  <circle cx="${pad + 6}" cy="${y - 4}" r="5" fill="${c}"/>
  <text x="${pad + 18}" y="${y}" fill="#c9d1d9" font-size="12">${escXml(lang)}</text>
  <text x="${w - pad}" y="${y}" fill="#8b949e" font-size="12" text-anchor="end">${pct}%</text>
  <rect x="${pad + 18}" y="${y + 4}" width="${barW}" height="4" rx="2" fill="${c}" opacity="0.7"/>`;
  });

  svg += `\n</svg>`;
  return svg;
}

async function generateStreakSVG(username) {
  let currentStreak = 0, longestStreak = 0, streak = 0;
  const events = await getEvents(username);
  
  const days = {};
  events.forEach(e => {
    const day = e.created_at?.slice(0, 10);
    if (day) days[day] = true;
  });

  // Also count today
  days[new Date().toISOString().slice(0, 10)] = true;

  const sorted = Object.keys(days).sort().reverse();
  
  if (sorted.length > 0) {
    // Calculate current streak from today backwards
    const today = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      if (days[key]) {
        currentStreak++;
      } else if (i > 0) {
        break;
      }
    }
  }

  longestStreak = Math.max(currentStreak, sorted.length > 0 ? 1 : 0);

  const w = 450, h = 120;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><style>text{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif}</style></defs>
  <rect width="${w}" height="${h}" rx="11" fill="#0d1117"/>
  <rect x="0" y="0" width="${w}" height="4" rx="11" fill="#ff6b6b"/>
  <text x="20" y="42" fill="#58a6ff" font-size="14" font-weight="600">🔥 GitHub Streak Stats</text>`;

  const items = [
    { label: 'Current Streak', value: `${currentStreak} days`, color: '#ff6b6b' },
    { label: 'Longest Streak', value: `${longestStreak} days`, color: '#58a6ff' },
    { label: 'Active Days', value: `${sorted.length}`, color: '#c9d1d9' },
  ];

  items.forEach((item, i) => {
    const y = 72 + i * 22;
    svg += `
  <text x="20" y="${y}" fill="${item.color}" font-size="12" font-weight="600">${escXml(item.label)}</text>
  <text x="${w - 20}" y="${y}" fill="#c9d1d9" font-size="12" text-anchor="end">${escXml(item.value)}</text>`;
  });

  svg += `\n</svg>`;
  return svg;
}

async function generateActivityGraphSVG(username) {
  const events = await getEvents(username);
  
  // Count contributions per day (last 12 weeks)
  const dayCounts = {};
  events.forEach(e => {
    const day = e.created_at?.slice(0, 10);
    if (day) dayCounts[day] = (dayCounts[day] || 0) + 1;
  });

  const w = 450, h = 150;
  const weeks = 12, cellSize = 8, gap = 2;
  const gridW = weeks * (cellSize + gap);
  const gridH = 7 * (cellSize + gap);
  const offsetX = 20, offsetY = 35;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><style>text{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif}</style></defs>
  <rect width="${w}" height="${h}" rx="11" fill="#0d1117"/>
  <text x="20" y="25" fill="#58a6ff" font-size="14" font-weight="600">📅 Contribution Activity</text>`;

  const today = new Date();
  for (let wk = 0; wk < weeks; wk++) {
    for (let dy = 0; dy < 7; dy++) {
      const d = new Date(today);
      d.setDate(d.getDate() - ((weeks - 1 - wk) * 7 + (6 - dy)));
      const key = d.toISOString().slice(0, 10);
      const count = dayCounts[key] || 0;
      let fill = '#161b22';
      if (count > 0) fill = '#0e4429';
      if (count >= 3) fill = '#006d32';
      if (count >= 6) fill = '#26a641';
      if (count >= 9) fill = '#39d353';
      
      const x = offsetX + wk * (cellSize + gap);
      const y = offsetY + dy * (cellSize + gap);
      svg += `\n  <rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="2" fill="${fill}"/>`;
    }
  }

  svg += `\n</svg>`;
  return svg;
}

async function main() {
  const username = process.env.GITHUB_USERNAME || 'rajehdidntwakeup';
  console.log(`Fetching data for ${username}...`);
  
  const repos = await getRepos(username);
  console.log(`Found ${repos.length} repos`);

  const statsSVG = generateStatsSVG(username, repos);
  require('fs').writeFileSync('stats.svg', statsSVG);
  console.log('Generated stats.svg');

  const langsSVG = generateTopLangsSVG(repos);
  require('fs').writeFileSync('top-langs.svg', langsSVG);
  console.log('Generated top-langs.svg');

  const streakSVG = await generateStreakSVG(username);
  require('fs').writeFileSync('streak.svg', streakSVG);
  console.log('Generated streak.svg');

  const graphSVG = await generateActivityGraphSVG(username);
  require('fs').writeFileSync('activity-graph.svg', graphSVG);
  console.log('Generated activity-graph.svg');

  console.log('All SVGs generated successfully!');
}

main().catch(e => { console.error(e); process.exit(1); });