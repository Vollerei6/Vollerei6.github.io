#!/usr/bin/env node
/**
 * 抓取"里世界"页面上要显示的实时数据，写入 data/stats.json。
 *
 * 为什么需要这个脚本？
 *   B 站 API 不返回 Access-Control-Allow-Origin，浏览器端 fetch 一定被 CORS 拦掉；
 *   Stead/Steam 的 key 也不能出现在前端（仓库是公开的）。
 *   所以：由 GitHub Actions 定时在本机（服务器端）抓取 → 提交 JSON → 页面只读 JSON。
 *
 * 用法：
 *   node scripts/fetch-stats.mjs                        # 用环境变量
 *   node scripts/fetch-stats.mjs --mid=123456           # 指定 mid
 *   node scripts/fetch-stats.mjs --dry-run              # 只打印，不写文件
 *
 * 退出码：0 = 成功（或无事可做）；1 = 全部数据源都失败（此时不覆盖旧文件）
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data/stats.json');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([\w-]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const MID = args.mid || process.env.BILI_MID || '';
const STEAM_KEY = process.env.STEAM_KEY || '';
const STEAM_ID = process.env.STEAM_ID || '';

async function getJSON(url, headers = {}) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Referer: 'https://www.bilibili.com/',
      Accept: 'application/json',
      ...headers,
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/** B 站：粉丝数 + 关注数 + 投稿数（这几个接口不需要 WBI 签名） */
async function bilibili() {
  const out = { mid: Number(MID), follower: null, following: null, video: null, opus: null };
  const rel = await getJSON(`https://api.bilibili.com/x/relation/stat?vmid=${encodeURIComponent(MID)}`);
  if (rel.code === 0 && rel.data) {
    out.follower = rel.data.follower ?? null;
    out.following = rel.data.following ?? null;
  }
  const nav = await getJSON(`https://api.bilibili.com/x/space/navnum?mid=${encodeURIComponent(MID)}`);
  if (nav.code === 0 && nav.data) {
    out.video = nav.data.video ?? null;
    out.opus = nav.data.opus ?? null;
  }
  return out;
}

/** Steam：最近游玩的游戏（需要 Web API key，只在 CI 里用） */
async function steam() {
  if (!STEAM_KEY || !STEAM_ID) return null;
  try {
    const base = 'https://api.steampowered.com';
    const [sum, recent] = await Promise.all([
      getJSON(`${base}/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_KEY}&steamids=${STEAM_ID}`),
      getJSON(`${base}/IPlayerService/GetRecentlyPlayedGames/v1/?key=${STEAM_KEY}&steamid=${STEAM_ID}&count=5`),
    ]);
    const p = sum?.response?.players?.[0] || {};
    return {
      name: p.personaname || null,
      status: p.personastate ?? null,
      recent: (recent?.response?.games || []).map((g) => ({
        appid: g.appid,
        name: g.name,
        hours: Math.round((g.playtime_forever / 60) * 10) / 10,
        hours2w: Math.round((g.playtime_2weeks || 0) / 6) / 10,
      })),
    };
  } catch (e) {
    console.warn('steam 跳过：' + e.message);
    return null;
  }
}

async function main() {
  const stats = { updated: new Date().toISOString(), bilibili: null, steam: null, demo: false };
  const errors = [];

  if (MID) {
    try {
      stats.bilibili = await bilibili();
    } catch (e) {
      errors.push('bilibili: ' + e.message);
    }
  } else {
    stats.demo = true;
    stats.bilibili = { mid: 0, follower: 0, following: 0, video: 0, opus: 0 };
    console.warn('未设置 BILI_MID，写入示例数据（demo=true）。');
  }

  stats.steam = await steam();

  if (errors.length && !stats.bilibili) {
    console.error('抓取失败，保留旧数据：\n  ' + errors.join('\n  '));
    process.exit(1);
  }

  const json = JSON.stringify(stats, null, 2) + '\n';

  if (args['dry-run']) {
    process.stdout.write(json);
    return;
  }
  await mkdir(dirname(OUT), { recursive: true });
  try {
    const old = await readFile(OUT, 'utf8');
    if (old === json) { console.log('数据未变化，跳过写入。'); return; }
  } catch {}
  await writeFile(OUT, json, 'utf8');
  console.log('已写入 data/stats.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
