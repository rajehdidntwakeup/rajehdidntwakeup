const https = require('https');
const fs = require('fs');

const TOKEN = process.env.GH_TOKEN;
const USERNAME = process.env.GITHUB_USERNAME || 'rajehdidntwakeup';

function escXml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function restGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.get(`https://api.github.com${path}`, {
      headers: { 'User-Agent': 'node', 'Authorization': `token ${TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
  });
}

function graphql(query) {
  const body = JSON.stringify({ query });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com', path: '/graphql', method: 'POST',
      headers: { 'Authorization': `bearer ${TOKEN}`, 'User-Agent': 'node', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { const p = JSON.parse(data); if (p.errors) reject(p.errors); else resolve(p.data); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function fetchCalendar() {
  try {
    const data = await graphql(`query { user(login:"${USERNAME}") { contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { contributionCount date color } } } } } }`);
    return data.user.contributionsCollection.contributionCalendar;
  } catch (e) {
    console.log('GraphQL calendar failed, will use REST-only stats');
    return null;
  }
}

async function fetchAllRepos() {
  let repos = [], page = 1;
  while (true) {
    const batch = await restGet(`/users/${USERNAME}/repos?per_page=100&page=${page}&sort=updated`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    repos = repos.concat(batch);
    if (batch.length < 100) break;
    page++;
  }
  return repos;
}

// ===== STATS SVG — GitHub-style card =====
function generateStatsSVG(user, repos, calendar) {
  const totalContribs = calendar ? calendar.totalContributions : user.public_repos;
  const totalStars = repos.reduce((s, r) => s + (r.stargazers_count || 0), 0);
  const totalForks = repos.reduce((s, r) => s + (r.forks_count || 0), 0);

  const w = 495, pad = 20, iconSize = 16;
  const headerH = 44, rowH = 34;
  const rows = [
    { icon: '⭐', label: 'Total Stars', value: totalStars.toLocaleString() },
    { icon: '📦', label: 'Total Repos', value: repos.length.toLocaleString() },
    { icon: '🍴', label: 'Total Forks', value: totalForks.toLocaleString() },
    { icon: '🔥', label: 'Contributions', value: typeof totalContribs === 'number' ? totalContribs.toLocaleString() : totalContribs, accent: '#58a6ff' },
  ];
  const h = pad + headerH + rows.length * rowH + pad;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif }
    .header { fill: #c9d1d9; font-size: 16px; font-weight: 700 }
    .label { fill: #8b949e; font-size: 13px }
    .value { fill: #c9d1d9; font-size: 13px; font-weight: 600; text-anchor: end }
  </style>
  <rect width="${w}" height="${h}" rx="12" fill="#0d1117" stroke="#30363d" stroke-width="1"/>
  <text x="${pad}" y="${pad + 26}" class="header">${escXml(USERNAME)}'s GitHub Stats</text>
  <line x1="${pad}" y1="${pad + headerH - 6}" x2="${w - pad}" y2="${pad + headerH - 6}" stroke="#21262d" stroke-width="1"/>`;

  rows.forEach((r, i) => {
    const y = pad + headerH + i * rowH;
    const valueFill = r.accent || '#c9d1d9';
    svg += `
  <text x="${pad}" y="${y + 20}" class="label">${r.icon} ${escXml(r.label)}</text>
  <text x="${w - pad}" y="${y + 20}" class="value" fill="${valueFill}">${escXml(String(r.value))}</text>`;
    if (i < rows.length - 1) svg += `\n  <line x1="${pad}" y1="${y + rowH}" x2="${w - pad}" y2="${y + rowH}" stroke="#21262d" stroke-width="0.5"/>`;
  });

  svg += `\n</svg>`;
  return svg;
}

// ===== STREAK SVG =====
function generateStreakSVG(calendar) {
  if (!calendar) return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="60"><rect width="495" height="60" rx="12" fill="#0d1117" stroke="#30363d" stroke-width="1"/><text x="20" y="35" fill="#8b949e" font-size="13" font-family="sans-serif">Streak data unavailable</text></svg>`;

  const weeks = calendar.weeks;
  const allDays = weeks.flatMap(w => w.contributionDays);

  let longestStreak = 0, streak = 0;
  for (let i = allDays.length - 1; i >= 0; i--) {
    if (allDays[i].contributionCount > 0) { streak++; longestStreak = Math.max(longestStreak, streak); }
    else streak = 0;
  }

  streak = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (let i = allDays.length - 1; i >= 0; i--) {
    if (allDays[i].contributionCount > 0) streak++;
    else if (allDays[i].date === today) continue;
    else break;
  }
  const currentStreak = streak;

  const w = 495, pad = 20, headerH = 44;
  const items = [
    { label: '🔥 Current Streak', value: `${currentStreak} days` },
    { label: '⚡ Longest Streak', value: `${longestStreak} days` },
  ];
  const h = pad + headerH + items.length * 30 + pad;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <style>text { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif }</style>
  <rect width="${w}" height="${h}" rx="12" fill="#0d1117" stroke="#30363d" stroke-width="1"/>
  <text x="${pad}" y="${pad + 26}" fill="#c9d1d9" font-size="16" font-weight="700">🔥 Streak Stats</text>
  <line x1="${pad}" y1="${pad + headerH - 6}" x2="${w - pad}" y2="${pad + headerH - 6}" stroke="#21262d" stroke-width="1"/>`;

  items.forEach((item, i) => {
    const y = pad + headerH + i * 30;
    svg += `
  <text x="${pad}" y="${y + 20}" fill="#8b949e" font-size="13">${escXml(item.label)}</text>
  <text x="${w - pad}" y="${y + 20}" fill="#c9d1d9" font-size="13" font-weight="600" text-anchor="end">${escXml(item.value)}</text>`;
  });

  svg += `\n</svg>`;
  return svg;
}

// ===== TOP LANGUAGES SVG =====
function generateTopLangsSVG(repos) {
  const langColors = {
    'Java': '#b07219', 'Python': '#3572A5', 'JavaScript': '#f1e05a', 'TypeScript': '#3178c6',
    'CSS': '#563d7c', 'HTML': '#e34c26', 'Shell': '#89e051', 'SQL': '#e38c00',
    'Rust': '#dea584', 'Go': '#00ADD8', 'Kotlin': '#A97BFF', 'Ruby': '#701516',
    'C++': '#f34b7d', 'C': '#555555', 'PHP': '#4F5D95', 'Swift': '#F05138',
    'Dart': '#00B4AB', 'Scala': '#c22d40', 'Vue': '#41b883', 'Dockerfile': '#384d54'
  };

  const langBytes = {};
  repos.forEach(r => { if (r.language && r.size) langBytes[r.language] = (langBytes[r.language] || 0) + r.size; });
  const sorted = Object.entries(langBytes).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!sorted.length) return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="60"><rect width="495" height="60" rx="12" fill="#0d1117" stroke="#30363d"/><text x="20" y="35" fill="#8b949e" font-size="13" font-family="sans-serif">No language data</text></svg>`;
  const total = sorted.reduce((s, [, v]) => s + v, 0) || 1;

  const w = 495, pad = 20, headerH = 44, rowH = 26, barH = 10;
  const h = pad + headerH + sorted.length * rowH + barH + 14 + pad;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <style>text { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif }</style>
  <rect width="${w}" height="${h}" rx="12" fill="#0d1117" stroke="#30363d" stroke-width="1"/>
  <text x="${pad}" y="${pad + 26}" fill="#c9d1d9" font-size="16" font-weight="700">Most Used Languages</text>
  <line x1="${pad}" y1="${pad + headerH - 6}" x2="${w - pad}" y2="${pad + headerH - 6}" stroke="#21262d" stroke-width="1"/>`;

  sorted.forEach(([lang, bytes], i) => {
    const y = pad + headerH + i * rowH;
    const pct = ((bytes / total) * 100).toFixed(1);
    const c = langColors[lang] || '#8b949e';
    svg += `
  <circle cx="${pad + 6}" cy="${y + 9}" r="5" fill="${c}"/>
  <text x="${pad + 18}" y="${y + 13}" fill="#c9d1d9" font-size="12">${escXml(lang)}</text>
  <text x="${w - pad}" y="${y + 13}" fill="#8b949e" font-size="12" text-anchor="end">${pct}%</text>`;
  });

  // Combined progress bar
  const barY = pad + headerH + sorted.length * rowH + 8;
  let barX = pad;
  const barWidth = w - pad * 2;
  sorted.forEach(([lang, bytes]) => {
    const segW = Math.max(1, barWidth * (bytes / total));
    svg += `\n  <rect x="${barX.toFixed(1)}" y="${barY}" width="${segW.toFixed(1)}" height="${barH}" rx="5" fill="${langColors[lang] || '#8b949e'}"/>`;
    barX += segW;
  });

  svg += `\n</svg>`;
  return svg;
}

// ===== ACTIVITY GRAPH =====
function generateActivityGraphSVG(calendar) {
  if (!calendar) return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="60"><rect width="495" height="60" rx="12" fill="#0d1117" stroke="#30363d"/><text x="20" y="35" fill="#8b949e" font-size="13" font-family="sans-serif">Activity data unavailable</text></svg>`;

  const weeks = calendar.weeks;
  const lastN = Math.min(weeks.length, 20);
  const recentWeeks = weeks.slice(-lastN);

  const cellSize = 12, gap = 3, pad = 20, headerH = 38;
  const offsetY = pad + headerH;
  const gridH = 7 * (cellSize + gap);
  const w = Math.max(lastN * (cellSize + gap) + pad * 2 + 32, 495);
  const h = offsetY + gridH + 28;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <style>text { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif }</style>
  <rect width="${w}" height="${h}" rx="12" fill="#0d1117" stroke="#30363d" stroke-width="1"/>
  <text x="${pad}" y="${pad + 20}" fill="#c9d1d9" font-size="14" font-weight="700">${calendar.totalContributions.toLocaleString()} contributions in the last year</text>`;

  ['Mon', 'Wed', 'Fri'].forEach((label, idx) => {
    const i = [1, 3, 5][idx];
    svg += `\n  <text x="${pad}" y="${offsetY + i * (cellSize + gap) + cellSize}" fill="#8b949e" font-size="9" text-anchor="end">${label}</text>`;
  });

  recentWeeks.forEach((week, wk) => {
    week.contributionDays.forEach((day, dy) => {
      svg += `\n  <rect x="${pad + 30 + wk * (cellSize + gap)}" y="${offsetY + dy * (cellSize + gap)}" width="${cellSize}" height="${cellSize}" rx="2" fill="${day.color}"/>`;
    });
  });

  const legendY = offsetY + gridH + 18;
  const legendX = w - pad - 130;
  svg += `\n  <text x="${legendX}" y="${legendY}" fill="#8b949e" font-size="10">Less</text>`;
  ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'].forEach((c, i) => {
    svg += `\n  <rect x="${legendX + 30 + i * 16}" y="${legendY - 10}" width="12" height="12" rx="2" fill="${c}"/>`;
  });
  svg += `\n  <text x="${legendX + 30 + 5 * 16 + 4}" y="${legendY}" fill="#8b949e" font-size="10">More</text>`;

  svg += `\n</svg>`;
  return svg;
}

async function main() {
  console.log('Fetching user data...');
  const user = await restGet(`/users/${USERNAME}`);
  console.log(`User: ${user.login}, Public repos: ${user.public_repos}`);

  console.log('Fetching repos...');
  const repos = await fetchAllRepos();
  console.log(`Found ${repos.length} repos`);

  console.log('Fetching contribution calendar...');
  const calendar = await fetchCalendar();
  if (calendar) console.log(`Total contributions: ${calendar.totalContributions}`);

  // Ensure dist dir exists for snake workflow
  if (!fs.existsSync('dist')) fs.mkdirSync('dist');

  console.log('\nGenerating SVGs...');
  fs.writeFileSync('stats.svg', generateStatsSVG(user, repos, calendar));
  fs.writeFileSync('dist/stats.svg', generateStatsSVG(user, repos, calendar));
  console.log('✓ stats.svg');

  fs.writeFileSync('streak.svg', generateStreakSVG(calendar));
  fs.writeFileSync('dist/streak.svg', generateStreakSVG(calendar));
  console.log('✓ streak.svg');

  fs.writeFileSync('top-langs.svg', generateTopLangsSVG(repos));
  fs.writeFileSync('dist/top-langs.svg', generateTopLangsSVG(repos));
  console.log('✓ top-langs.svg');

  fs.writeFileSync('activity-graph.svg', generateActivityGraphSVG(calendar));
  fs.writeFileSync('dist/activity-graph.svg', generateActivityGraphSVG(calendar));
  console.log('✓ activity-graph.svg');

  console.log('\nAll SVGs generated!');
}

main().catch(e => { console.error(e); process.exit(1); });