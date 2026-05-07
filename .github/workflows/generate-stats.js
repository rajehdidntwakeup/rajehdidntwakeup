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
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
  });
}

function graphql(query) {
  const body = JSON.stringify({ query });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com',
      path: '/graphql',
      method: 'POST',
      headers: {
        'Authorization': `bearer ${TOKEN}`,
        'User-Agent': 'node',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.errors) reject(new Error(JSON.stringify(parsed.errors)));
          else resolve(parsed.data);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Try GraphQL calendar, fall back to REST-only
async function fetchCalendar() {
  try {
    // Minimal calendar-only query
    const calQuery = `query { user(login:"${USERNAME}") { contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { contributionCount date color } } } } } }`;
    const data = await graphql(calQuery);
    return data.user.contributionsCollection.contributionCalendar;
  } catch (e) {
    console.log('GraphQL calendar failed, using REST events fallback');
    return null;
  }
}

async function fetchAllRepos() {
  let repos = [];
  let page = 1;
  while (true) {
    const batch = await restGet(`/users/${USERNAME}/repos?per_page=100&page=${page}&sort=updated`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    repos = repos.concat(batch);
    if (batch.length < 100) break;
    page++;
  }
  return repos;
}

function generateStatsSVG(user, repos, calendar) {
  const totalContribs = calendar ? calendar.totalContributions : '—';
  const totalStars = repos.reduce((s, r) => s + (r.stargazers_count || 0), 0);
  const totalForks = repos.reduce((s, r) => s + (r.forks_count || 0), 0);

  const stats = [
    { label: 'Total Contributions', value: typeof totalContribs === 'number' ? totalContribs.toLocaleString() : totalContribs },
    { label: 'Repositories', value: repos.length.toLocaleString() },
    { label: 'Stars Earned', value: totalStars.toLocaleString() },
    { label: 'Forks Created', value: totalForks.toLocaleString() },
  ];

  const w = 450, rowH = 30, pad = 16, headerH = 40;
  const h = pad + headerH + stats.length * rowH + pad;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <style>text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}</style>
  <rect width="${w}" height="${h}" rx="12" fill="#0d1117"/>
  <rect width="${w}" height="4" rx="12" fill="#58a6ff"/>
  <rect y="4" width="${w}" height="4" fill="#0d1117"/>
  <text x="${pad}" y="${pad + 24}" fill="#c9d1d9" font-size="15" font-weight="700">${escXml(USERNAME)}'s GitHub Stats</text>`;

  stats.forEach((s, i) => {
    const y = pad + headerH + i * rowH;
    svg += `
  <text x="${pad + 10}" y="${y + 19}" fill="#8b949e" font-size="12.5">${escXml(s.label)}</text>
  <text x="${w - pad}" y="${y + 19}" fill="#58a6ff" font-size="12.5" font-weight="700" text-anchor="end">${escXml(s.value)}</text>`;
    if (i < stats.length - 1) svg += `\n  <line x1="${pad}" y1="${y + rowH - 2}" x2="${w - pad}" y2="${y + rowH - 2}" stroke="#21262d" stroke-width="1"/>`;
  });

  svg += `\n</svg>`;
  return svg;
}

function generateStreakSVG(calendar) {
  if (!calendar) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="450" height="80" viewBox="0 0 450 80"><style>text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}</style><rect width="450" height="80" rx="12" fill="#0d1117"/><text x="20" y="40" fill="#8b949e" font-size="13">Could not load streak data</text></svg>`;
  }

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

  const w = 450, pad = 16, headerH = 40;
  const items = [
    { label: 'Current Streak', value: `${currentStreak} days`, accent: '#ff6b6b' },
    { label: 'Longest Streak', value: `${longestStreak} days`, accent: '#58a6ff' },
    { label: 'This Year', value: `${calendar.totalContributions.toLocaleString()} contributions`, accent: '#c9d1d9' },
  ];
  const h = pad + headerH + items.length * 32 + pad;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <style>text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}</style>
  <rect width="${w}" height="${h}" rx="12" fill="#0d1117"/>
  <rect width="${w}" height="4" rx="12" fill="#ff6b6b"/>
  <rect y="4" width="${w}" height="4" fill="#0d1117"/>
  <text x="${pad}" y="${pad + 24}" fill="#c9d1d9" font-size="15" font-weight="700">🔥 Streak Stats</text>`;

  items.forEach((item, i) => {
    const y = pad + headerH + i * 32;
    svg += `
  <text x="${pad}" y="${y + 19}" fill="${item.accent}" font-size="13" font-weight="600">${escXml(item.label)}</text>
  <text x="${w - pad}" y="${y + 19}" fill="#c9d1d9" font-size="13" text-anchor="end">${escXml(item.value)}</text>`;
    if (i < items.length - 1) svg += `\n  <line x1="${pad}" y1="${y + 30}" x2="${w - pad}" y2="${y + 30}" stroke="#21262d" stroke-width="1"/>`;
  });

  svg += `\n</svg>`;
  return svg;
}

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
  if (!sorted.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="450" height="80" viewBox="0 0 450 80"><style>text{font-family:sans-serif}</style><rect width="450" height="80" rx="12" fill="#0d1117"/><text x="20" y="40" fill="#8b949e" font-size="13">No language data</text></svg>`;
  }
  const total = sorted.reduce((s, [, v]) => s + v, 0) || 1;

  const w = 450, pad = 16, headerH = 40, barH = 10, rowH = 28;
  const h = pad + headerH + sorted.length * rowH + barH + 20 + pad;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <style>text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}</style>
  <rect width="${w}" height="${h}" rx="12" fill="#0d1117"/>
  <rect width="${w}" height="4" rx="12" fill="#58a6ff"/>
  <rect y="4" width="${w}" height="4" fill="#0d1117"/>
  <text x="${pad}" y="${pad + 24}" fill="#c9d1d9" font-size="15" font-weight="700">Most Used Languages</text>`;

  sorted.forEach(([lang, bytes], i) => {
    const y = pad + headerH + i * rowH;
    const pct = ((bytes / total) * 100).toFixed(1);
    svg += `
  <circle cx="${pad + 6}" cy="${y + 9}" r="5" fill="${langColors[lang] || '#8b949e'}"/>
  <text x="${pad + 18}" y="${y + 13}" fill="#c9d1d9" font-size="12">${escXml(lang)}</text>
  <text x="${w - pad}" y="${y + 13}" fill="#8b949e" font-size="12" text-anchor="end">${pct}%</text>`;
  });

  const barY = pad + headerH + sorted.length * rowH + 10;
  let barX = pad;
  const barWidth = w - pad * 2;
  sorted.forEach(([lang, bytes]) => {
    const segW = Math.max(2, barWidth * (bytes / total));
    svg += `\n  <rect x="${barX.toFixed(1)}" y="${barY}" width="${segW.toFixed(1)}" height="${barH}" rx="5" fill="${langColors[lang] || '#8b949e'}"/>`;
    barX += segW;
  });

  svg += `\n</svg>`;
  return svg;
}

function generateActivityGraphSVG(calendar) {
  if (!calendar) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="450" height="80" viewBox="0 0 450 80"><style>text{font-family:sans-serif}</style><rect width="450" height="80" rx="12" fill="#0d1117"/><text x="20" y="40" fill="#8b949e" font-size="13">Could not load activity data</text></svg>`;
  }

  const weeks = calendar.weeks;
  const lastN = Math.min(weeks.length, 20);
  const recentWeeks = weeks.slice(-lastN);

  const cellSize = 11, gap = 3, pad = 16, headerH = 40;
  const offsetY = pad + headerH;
  const gridH = 7 * (cellSize + gap);
  const w = Math.max(lastN * (cellSize + gap) + pad * 2 + 30, 450);
  const h = offsetY + gridH + 30;
  const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <style>text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}</style>
  <rect width="${w}" height="${h}" rx="12" fill="#0d1117"/>
  <text x="${pad}" y="${pad + 20}" fill="#c9d1d9" font-size="15" font-weight="700">${calendar.totalContributions.toLocaleString()} contributions in the last year</text>`;

  dayLabels.forEach((label, i) => {
    if (label) svg += `\n  <text x="${pad}" y="${offsetY + i * (cellSize + gap) + cellSize}" fill="#8b949e" font-size="9" text-anchor="end">${label}</text>`;
  });

  recentWeeks.forEach((week, wk) => {
    week.contributionDays.forEach((day, dy) => {
      svg += `\n  <rect x="${pad + 30 + wk * (cellSize + gap)}" y="${offsetY + dy * (cellSize + gap)}" width="${cellSize}" height="${cellSize}" rx="2" fill="${day.color}"/>`;
    });
  });

  const legendY = offsetY + gridH + 18;
  const legendX = w - pad - 120;
  svg += `\n  <text x="${legendX}" y="${legendY}" fill="#8b949e" font-size="10">Less</text>`;
  ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'].forEach((c, i) => {
    svg += `\n  <rect x="${legendX + 28 + i * 15}" y="${legendY - 9}" width="11" height="11" rx="2" fill="${c}"/>`;
  });
  svg += `\n  <text x="${legendX + 28 + 5 * 15 + 4}" y="${legendY}" fill="#8b949e" font-size="10">More</text>`;

  svg += `\n</svg>`;
  return svg;
}

async function main() {
  console.log('Fetching user data...');
  const user = await restGet(`/users/${USERNAME}`);
  console.log(`User: ${user.name || user.login}, Public repos: ${user.public_repos}`);

  console.log('Fetching repos...');
  const repos = await fetchAllRepos();
  console.log(`Found ${repos.length} repos`);

  console.log('Fetching contribution calendar...');
  const calendar = await fetchCalendar();
  if (calendar) console.log(`Total contributions: ${calendar.totalContributions}`);
  else console.log('Calendar unavailable, using REST fallback');

  console.log('\nGenerating SVGs...');
  fs.writeFileSync('stats.svg', generateStatsSVG(user, repos, calendar));
  console.log('✓ stats.svg');

  fs.writeFileSync('streak.svg', generateStreakSVG(calendar));
  console.log('✓ streak.svg');

  fs.writeFileSync('top-langs.svg', generateTopLangsSVG(repos));
  console.log('✓ top-langs.svg');

  fs.writeFileSync('activity-graph.svg', generateActivityGraphSVG(calendar));
  console.log('✓ activity-graph.svg');

  console.log('\nAll SVGs generated!');
}

main().catch(e => { console.error(e); process.exit(1); });