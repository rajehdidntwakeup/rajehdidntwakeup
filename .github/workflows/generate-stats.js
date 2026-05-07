const { execSync } = require('child_process');
const fs = require('fs');

function escXml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function runGraphQL(query) {
  const result = execSync(`gh api graphql -f query='${query.replace(/'/g, "'\\''")}'`, { encoding: 'utf-8' });
  return JSON.parse(result);
}

// Fetch contribution data
const query = `{
  viewer {
    login
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
 totalPullRequestReviewContributions
      totalRepositoryContributions
      restrictedContributionsCount
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            contributionCount
            date
            color
          }
        }
      }
    }
  }
}`;

console.log('Fetching contribution data via GraphQL...');
const data = runGraphQL(query);
const viewer = data.data.viewer;
const coll = viewer.contributionsCollection;
const cal = coll.contributionCalendar;

console.log(`User: ${viewer.login}`);
console.log(`Total contributions: ${cal.totalContributions}`);
console.log(`Commits: ${coll.totalCommitContributions}`);
console.log(`PRs: ${coll.totalPullRequestContributions}`);
console.log(`Issues: ${coll.totalIssueContributions}`);
console.log(`Reviews: ${coll.totalPullRequestReviewContributions}`);
console.log(`Repos: ${coll.totalRepositoryContributions}`);

// ===== STATS SVG =====
function generateStatsSVG() {
  const stats = [
    { icon: '⟶', label: 'Total Contributions', value: cal.totalContributions.toLocaleString() },
    { icon: '⟶', label: 'Commits', value: coll.totalCommitContributions.toLocaleString() },
    { icon: '⟶', label: 'Pull Requests', value: coll.totalPullRequestContributions.toLocaleString() },
    { icon: '⟶', label: 'Issues', value: coll.totalIssueContributions.toLocaleString() },
    { icon: '⟶', label: 'Code Reviews', value: coll.totalPullRequestReviewContributions.toLocaleString() },
    { icon: '⟶', label: 'Repositories', value: coll.totalRepositoryContributions.toLocaleString() },
  ];

  const w = 450, rowH = 30, pad = 16, headerH = 40;
  const h = pad + headerH + stats.length * rowH + pad;
  const accentH = 4;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <style>text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}</style>
  <rect width="${w}" height="${h}" rx="12" fill="#0d1117"/>
  <rect width="${w}" height="${accentH}" rx="12" fill="#58a6ff"/>
  <rect y="${accentH}" width="${w}" height="${accentH}" fill="#0d1117"/>
  <text x="${pad}" y="${pad + 24}" fill="#c9d1d9" font-size="15" font-weight="700">${escXml(viewer.login)}'s GitHub Stats</text>`;

  stats.forEach((s, i) => {
    const y = pad + headerH + i * rowH;
    const barY = y + 2;
    const textY = y + 17;
    svg += `
  <text x="${pad + 10}" y="${textY}" fill="#8b949e" font-size="12.5">${escXml(s.label)}</text>
  <text x="${w - pad}" y="${textY}" fill="#58a6ff" font-size="12.5" font-weight="700" text-anchor="end">${escXml(s.value)}</text>`;
    if (i < stats.length - 1) {
      svg += `\n  <line x1="${pad}" y1="${y + rowH - 2}" x2="${w - pad}" y2="${y + rowH - 2}" stroke="#21262d" stroke-width="1"/>`;
    }
  });

  svg += `\n</svg>`;
  return svg;
}

// ===== STREAK SVG =====
function generateStreakSVG() {
  const weeks = cal.weeks;
  let currentStreak = 0, longestStreak = 0, streak = 0;

  // Flatten all days
  const allDays = weeks.flatMap(w => w.contributionDays);

  // Calculate streaks from most recent day backwards
  for (let i = allDays.length - 1; i >= 0; i--) {
    if (allDays[i].contributionCount > 0) {
      streak++;
      longestStreak = Math.max(longestStreak, streak);
    } else {
      streak = 0;
    }
  }

  // Current streak from today backwards
  streak = 0;
  for (let i = allDays.length - 1; i >= 0; i--) {
    if (allDays[i].contributionCount > 0) {
      streak++;
    } else {
      // Allow skipping today if no contributions yet
      const today = new Date().toISOString().slice(0, 10);
      if (allDays[i].date === today) continue;
      break;
    }
  }
  currentStreak = streak;

  const w = 450, pad = 16, headerH = 40;
  const items = [
    { label: 'Current Streak', value: `${currentStreak} days`, accent: '#ff6b6b' },
    { label: 'Longest Streak', value: `${longestStreak} days`, accent: '#58a6ff' },
    { label: 'This Year', value: `${cal.totalContributions.toLocaleString()} contributions`, accent: '#c9d1d9' },
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
    const textY = y + 19;
    svg += `
  <text x="${pad}" y="${textY}" fill="${item.accent}" font-size="13" font-weight="600">${escXml(item.label)}</text>
  <text x="${w - pad}" y="${textY}" fill="#c9d1d9" font-size="13" text-anchor="end" font-weight="500">${escXml(item.value)}</text>`;
    if (i < items.length - 1) {
      svg += `\n  <line x1="${pad}" y1="${y + 30}" x2="${w - pad}" y2="${y + 30}" stroke="#21262d" stroke-width="1"/>`;
    }
  });

  svg += `\n</svg>`;
  return svg;
}

// ===== TOP LANGUAGES SVG =====
function generateTopLangsSVG() {
  // Fetch language data
  const langResult = execSync('gh api user/repos?per_page=100\\&sort=updated --paginate -q \'.[].language\'', { encoding: 'utf-8' });
  const langs = langResult.trim().split('\n').filter(l => l && l !== 'null');
  
  const langCounts = {};
  langs.forEach(l => { langCounts[l] = (langCounts[l] || 0) + 1; });
  const sorted = Object.entries(langCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const total = sorted.reduce((s, [, v]) => s + v, 0) || 1;

  const langColors = {
    'Java': '#b07219', 'Python': '#3572A5', 'JavaScript': '#f1e05a', 'TypeScript': '#3178c6',
    'CSS': '#563d7c', 'HTML': '#e34c26', 'Shell': '#89e051', 'Dockerfile': '#384d54',
    'SQL': '#e38c00', 'Rust': '#dea584', 'Go': '#00ADD8', 'Kotlin': '#A97BFF',
    'Ruby': '#701516', 'C++': '#f34b7d', 'C': '#555555', 'PHP': '#4F5D95',
    'Swift': '#F05138', 'Dart': '#00B4AB', 'Scala': '#c22d40', 'Vue': '#41b883'
  };

  const w = 450, pad = 16, headerH = 40, barH = 10;
  const rowH = 28;
  const h = pad + headerH + sorted.length * rowH + barH + 20 + pad;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <style>text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}</style>
  <rect width="${w}" height="${h}" rx="12" fill="#0d1117"/>
  <rect width="${w}" height="4" rx="12" fill="#58a6ff"/>
  <rect y="4" width="${w}" height="4" fill="#0d1117"/>
  <text x="${pad}" y="${pad + 24}" fill="#c9d1d9" font-size="15" font-weight="700">Most Used Languages</text>`;

  sorted.forEach(([lang, count], i) => {
    const y = pad + headerH + i * rowH;
    const pct = ((count / total) * 100).toFixed(1);
    const c = langColors[lang] || '#8b949e';
    svg += `
  <circle cx="${pad + 6}" cy="${y + 9}" r="5" fill="${c}"/>
  <text x="${pad + 18}" y="${y + 13}" fill="#c9d1d9" font-size="12">${escXml(lang)}</text>
  <text x="${w - pad}" y="${y + 13}" fill="#8b949e" font-size="12" text-anchor="end">${pct}%</text>`;
  });

  // Progress bar
  const barY = pad + headerH + sorted.length * rowH + 10;
  let barX = pad;
  const barWidth = w - pad * 2;
  sorted.forEach(([lang, count]) => {
    const pct = count / total;
    const segW = Math.max(2, barWidth * pct);
    const c = langColors[lang] || '#8b949e';
    svg += `\n  <rect x="${barX}" y="${barY}" width="${segW}" height="${barH}" rx="5" fill="${c}"/>`;
    barX += segW;
  });

  svg += `\n</svg>`;
  return svg;
}

// ===== ACTIVITY GRAPH SVG =====
function generateActivityGraphSVG() {
  const weeks = cal.weeks;
  const lastN = Math.min(weeks.length, 20); // last 20 weeks
  const recentWeeks = weeks.slice(-lastN);

  const cellSize = 11, gap = 3;
  const pad = 16, headerH = 40;
  const offsetX = pad, offsetY = pad + headerH;
  const gridW = lastN * (cellSize + gap);
  const gridH = 7 * (cellSize + gap);
  const w = Math.max(gridW + pad * 2, 450);
  const h = offsetY + gridH + 30;

  // Day labels
  const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <style>text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}</style>
  <rect width="${w}" height="${h}" rx="12" fill="#0d1117"/>
  <text x="${pad}" y="${pad + 20}" fill="#c9d1d9" font-size="15" font-weight="700">${cal.totalContributions.toLocaleString()} contributions in the last year</text>`;

  // Day labels
  dayLabels.forEach((label, i) => {
    if (label) {
      const y = offsetY + i * (cellSize + gap) + cellSize;
      svg += `\n  <text x="${pad}" y="${y}" fill="#8b949e" font-size="9" text-anchor="end">${label}</text>`;
    }
  });

  // Contribution cells - use GitHub's actual colors
  recentWeeks.forEach((week, wk) => {
    week.contributionDays.forEach((day, dy) => {
      const x = offsetX + 30 + wk * (cellSize + gap);
      const y = offsetY + dy * (cellSize + gap);
      // Use GitHub's provided color (which respects light/dark themes)
      svg += `\n  <rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="2" fill="${day.color}"/>`;
    });
  });

  // Legend
  const legendY = offsetY + gridH + 18;
  const legendX = w - pad - 120;
  svg += `\n  <text x="${legendX}" y="${legendY}" fill="#8b949e" font-size="10">Less</text>`;
  const legendColors = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];
  legendColors.forEach((c, i) => {
    svg += `\n  <rect x="${legendX + 28 + i * 15}" y="${legendY - 9}" width="11" height="11" rx="2" fill="${c}"/>`;
  });
  svg += `\n  <text x="${legendX + 28 + 5 * 15 + 4}" y="${legendY}" fill="#8b949e" font-size="10">More</text>`;

  svg += `\n</svg>`;
  return svg;
}

// Generate all SVGs
console.log('\nGenerating SVGs...');

const statsSVG = generateStatsSVG();
fs.writeFileSync('stats.svg', statsSVG);
console.log('✓ stats.svg');

const streakSVG = generateStreakSVG();
fs.writeFileSync('streak.svg', streakSVG);
console.log('✓ streak.svg');

const topLangsSVG = generateTopLangsSVG();
fs.writeFileSync('top-langs.svg', topLangsSVG);
console.log('✓ top-langs.svg');

const graphSVG = generateActivityGraphSVG();
fs.writeFileSync('activity-graph.svg', graphSVG);
console.log('✓ activity-graph.svg');

console.log('\nAll SVGs generated successfully!');