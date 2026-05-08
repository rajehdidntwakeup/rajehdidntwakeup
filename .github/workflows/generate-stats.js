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

// ===== SHARED DEFS =====
const ACCENT = '#58a6ff';
const ACCENT2 = '#bc8cff';
const BG = '#0d1117';
const CARD_BG = '#161b22';
const BORDER = '#30363d';
const TEXT_PRIMARY = '#e6edf3';
const TEXT_SECONDARY = '#8b949e';
const W = 495;

function cardDefs(id) {
  return `
  <defs>
    <linearGradient id="${id}-bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#161b22"/>
      <stop offset="100%" stop-color="#0d1117"/>
    </linearGradient>
    <linearGradient id="${id}-accentGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${ACCENT}"/>
      <stop offset="100%" stop-color="${ACCENT2}"/>
    </linearGradient>
    <linearGradient id="${id}-topBar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${ACCENT}"/>
      <stop offset="50%" stop-color="${ACCENT2}"/>
      <stop offset="100%" stop-color="#f778ba"/>
    </linearGradient>
    <filter id="${id}-shadow" x="-5%" y="-5%" width="110%" height="120%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000" flood-opacity="0.3"/>
    </filter>
    <filter id="${id}-glow">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>`;
}

// ===== STATS SVG =====
function generateStatsSVG(user, repos, calendar) {
  const totalContribs = calendar ? calendar.totalContributions : user.public_repos;
  const totalStars = repos.reduce((s, r) => s + (r.stargazers_count || 0), 0);
  const totalForks = repos.reduce((s, r) => s + (r.forks_count || 0), 0);

  const pad = 24, headerH = 50, rowH = 40;
  const rows = [
    { icon: '⭐', label: 'Total Stars', value: totalStars.toLocaleString() },
    { icon: '📦', label: 'Total Repos', value: repos.length.toLocaleString() },
    { icon: '🍴', label: 'Total Forks', value: totalForks.toLocaleString() },
    { icon: '🔥', label: 'Contributions', value: typeof totalContribs === 'number' ? totalContribs.toLocaleString() : totalContribs },
  ];
  const h = pad + headerH + rows.length * rowH + pad;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}">
  ${cardDefs('stats')}
  <rect width="${W}" height="${h}" rx="16" fill="url(#stats-bgGrad)" stroke="${BORDER}" stroke-width="1" filter="url(#stats-shadow)"/>
  <rect x="0" y="0" width="${W}" height="4" rx="2" fill="url(#stats-topBar)"/>
  <text x="${pad}" y="${pad + 30}" fill="${TEXT_PRIMARY}" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="17" font-weight="700">${escXml(USERNAME)}'s GitHub Stats</text>
  <line x1="${pad}" y1="${pad + headerH - 8}" x2="${W - pad}" y2="${pad + headerH - 8}" stroke="#21262d" stroke-width="1"/>`;

  rows.forEach((r, i) => {
    const y = pad + headerH + i * rowH;
    const isAccent = i === rows.length - 1;
    const valueFill = isAccent ? ACCENT : TEXT_PRIMARY;
    svg += `
  <text x="${pad}" y="${y + 14}" fill="${TEXT_SECONDARY}" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="13">${r.icon}  ${escXml(r.label)}</text>
  <text x="${W - pad}" y="${y + 14}" fill="${valueFill}" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="14" font-weight="700" text-anchor="end"${isAccent ? ' filter="url(#stats-glow)"' : ''}>${escXml(String(r.value))}</text>`;
    if (i < rows.length - 1) svg += `\n  <line x1="${pad}" y1="${y + rowH - 4}" x2="${W - pad}" y2="${y + rowH - 4}" stroke="#21262d" stroke-width="0.5" stroke-dasharray="2,2"/>`;
  });

  svg += `\n</svg>`;
  return svg;
}

// ===== STREAK SVG =====
function generateStreakSVG(calendar) {
  if (!calendar) return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="80"><rect width="${W}" height="80" rx="16" fill="${CARD_BG}" stroke="${BORDER}"/><text x="24" y="45" fill="${TEXT_SECONDARY}" font-family="'Segoe UI', sans-serif" font-size="13">Streak data unavailable</text></svg>`;

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

  const pad = 24, headerH = 50, itemH = 44;
  const items = [
    { icon: '🔥', label: 'Current Streak', value: `${currentStreak} days`, accent: true },
    { icon: '⚡', label: 'Longest Streak', value: `${longestStreak} days`, accent: false },
  ];
  const h = pad + headerH + items.length * itemH + pad;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}">
  ${cardDefs('streak')}
  <rect width="${W}" height="${h}" rx="16" fill="url(#streak-bgGrad)" stroke="${BORDER}" stroke-width="1" filter="url(#streak-shadow)"/>
  <rect x="0" y="0" width="${W}" height="4" rx="2" fill="url(#streak-topBar)"/>
  <text x="${pad}" y="${pad + 30}" fill="${TEXT_PRIMARY}" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="17" font-weight="700">🔥 Streak Stats</text>
  <line x1="${pad}" y1="${pad + headerH - 8}" x2="${W - pad}" y2="${pad + headerH - 8}" stroke="#21262d" stroke-width="1"/>`;

  items.forEach((item, i) => {
    const y = pad + headerH + i * itemH;
    const valueFill = item.accent ? ACCENT : TEXT_PRIMARY;
    const glowFilter = item.accent ? ' filter="url(#streak-glow)"' : '';
    // Mini fire bar visualization
    const barWidth = Math.min(200, Math.max(8, parseInt(item.value) * 2));
    svg += `
  <text x="${pad}" y="${y + 16}" fill="${TEXT_SECONDARY}" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="13">${item.icon}  ${escXml(item.label)}</text>
  <text x="${W - pad}" y="${y + 16}" fill="${valueFill}" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="15" font-weight="700" text-anchor="end"${glowFilter}>${escXml(item.value)}</text>
  <rect x="${pad}" y="${y + 26}" width="${barWidth}" height="6" rx="3" fill="url(#streak-accentGrad)" opacity="0.6"/>`;
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
  if (!sorted.length) return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="80"><rect width="${W}" height="80" rx="16" fill="${CARD_BG}" stroke="${BORDER}"/><text x="24" y="45" fill="${TEXT_SECONDARY}" font-family="'Segoe UI', sans-serif" font-size="13">No language data</text></svg>`;
  const total = sorted.reduce((s, [, v]) => s + v, 0) || 1;

  const pad = 24, headerH = 50, rowH = 32;
  const h = pad + headerH + sorted.length * rowH + 24 + pad;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}">
  ${cardDefs('langs')}
  <rect width="${W}" height="${h}" rx="16" fill="url(#langs-bgGrad)" stroke="${BORDER}" stroke-width="1" filter="url(#langs-shadow)"/>
  <rect x="0" y="0" width="${W}" height="4" rx="2" fill="url(#langs-topBar)"/>
  <text x="${pad}" y="${pad + 30}" fill="${TEXT_PRIMARY}" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="17" font-weight="700">🎨 Most Used Languages</text>
  <line x1="${pad}" y1="${pad + headerH - 8}" x2="${W - pad}" y2="${pad + headerH - 8}" stroke="#21262d" stroke-width="1"/>`;

  sorted.forEach(([lang, bytes], i) => {
    const y = pad + headerH + i * rowH;
    const pct = ((bytes / total) * 100).toFixed(1);
    const c = langColors[lang] || '#8b949e';
    // Individual bar per language
    const barMaxWidth = W - pad * 2 - 80;
    const barWidth = Math.max(4, barMaxWidth * (bytes / total));
    svg += `
  <text x="${pad}" y="${y + 14}" fill="${TEXT_PRIMARY}" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="13" font-weight="500">${escXml(lang)}</text>
  <rect x="${pad + 80}" y="${y + 3}" width="${barWidth.toFixed(1)}" height="8" rx="4" fill="${c}" opacity="0.8"/>
  <text x="${W - pad}" y="${y + 14}" fill="${TEXT_SECONDARY}" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="12" text-anchor="end">${pct}%</text>`;
  });

  // Combined progress bar
  const barY = pad + headerH + sorted.length * rowH + 12;
  const barWidth = W - pad * 2;
  let barX = pad;
  svg += `\n  <rect x="${pad}" y="${barY}" width="${barWidth}" height="12" rx="6" fill="#21262d"/>`;
  sorted.forEach(([lang, bytes]) => {
    const segW = Math.max(2, barWidth * (bytes / total));
    const c = langColors[lang] || '#8b949e';
    svg += `\n  <rect x="${barX.toFixed(1)}" y="${barY}" width="${segW.toFixed(1)}" height="12" rx="${barX === pad ? 6 : 0}" fill="${c}" opacity="0.9"/>`;
    barX += segW;
  });

  svg += `\n</svg>`;
  return svg;
}

// ===== ACTIVITY GRAPH =====
function generateActivityGraphSVG(calendar) {
  if (!calendar) return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="80"><rect width="${W}" height="80" rx="16" fill="${CARD_BG}" stroke="${BORDER}"/><text x="24" y="45" fill="${TEXT_SECONDARY}" font-family="'Segoe UI', sans-serif" font-size="13">Activity data unavailable</text></svg>`;

  const weeks = calendar.weeks;
  const lastN = Math.min(weeks.length, 20);
  const recentWeeks = weeks.slice(-lastN);

  const cellSize = 13, gap = 3, pad = 24, headerH = 48;
  const offsetY = pad + headerH;
  const gridH = 7 * (cellSize + gap);
  const graphW = lastN * (cellSize + gap) + 32;
  const w = Math.max(graphW + pad * 2, W);
  const h = offsetY + gridH + 40;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  ${cardDefs('activity')}
  <rect width="${w}" height="${h}" rx="16" fill="url(#activity-bgGrad)" stroke="${BORDER}" stroke-width="1" filter="url(#activity-shadow)"/>
  <rect x="0" y="0" width="${w}" height="4" rx="2" fill="url(#activity-topBar)"/>
  <text x="${pad}" y="${pad + 32}" fill="${TEXT_PRIMARY}" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="15" font-weight="700">${calendar.totalContributions.toLocaleString()} contributions in the last year</text>
  <text x="${w - pad}" y="${pad + 32}" fill="${TEXT_SECONDARY}" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="11" text-anchor="end">${lastN} weeks</text>`;

  ['Mon', 'Wed', 'Fri'].forEach((label, idx) => {
    const i = [1, 3, 5][idx];
    svg += `\n  <text x="${pad}" y="${offsetY + i * (cellSize + gap) + cellSize}" fill="${TEXT_SECONDARY}" font-family="'Segoe UI', sans-serif" font-size="9" text-anchor="end" opacity="0.6">${label}</text>`;
  });

  recentWeeks.forEach((week, wk) => {
    week.contributionDays.forEach((day, dy) => {
      svg += `\n  <rect x="${pad + 28 + wk * (cellSize + gap)}" y="${offsetY + dy * (cellSize + gap)}" width="${cellSize}" height="${cellSize}" rx="3" fill="${day.color}" opacity="0.9"/>`;
    });
  });

  // Legend
  const legendY = offsetY + gridH + 24;
  const legendX = w - pad - 150;
  svg += `\n  <text x="${legendX}" y="${legendY}" fill="${TEXT_SECONDARY}" font-family="'Segoe UI', sans-serif" font-size="10">Less</text>`;
  ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'].forEach((c, i) => {
    svg += `\n  <rect x="${legendX + 30 + i * 18}" y="${legendY - 10}" width="13" height="13" rx="3" fill="${c}"/>`;
  });
  svg += `\n  <text x="${legendX + 30 + 5 * 18 + 4}" y="${legendY}" fill="${TEXT_SECONDARY}" font-family="'Segoe UI', sans-serif" font-size="10">More</text>`;

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

  if (!fs.existsSync('dist')) fs.mkdirSync('dist');

  console.log('\nGenerating SVGs...');
  const svgPairs = [
    ['stats.svg', generateStatsSVG(user, repos, calendar)],
    ['streak.svg', generateStreakSVG(calendar)],
    ['top-langs.svg', generateTopLangsSVG(repos)],
    ['activity-graph.svg', generateActivityGraphSVG(calendar)],
  ];

  svgPairs.forEach(([name, content]) => {
    fs.writeFileSync(name, content);
    fs.writeFileSync(`dist/${name}`, content);
    console.log(`✓ ${name}`);
  });

  console.log('\nAll SVGs generated!');
}

main().catch(e => { console.error(e); process.exit(1); });