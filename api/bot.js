MKAYFX SCALPER V2
   M15 = directional bias
   M5  = setup / structure / liquidity
   M1  = execution trigger

   Markets: XAU/USD + BTC/USD
   Vercel env: TWELVE_DATA_API_KEY
   Optional Telegram:
   TELEGRAM_BOT_TOKEN
   TELEGRAM_CHAT_ID
========================================================= */

const API_KEY = process.env.TWELVE_DATA_API_KEY;
const BASE_URL = "https://api.twelvedata.com";

const MARKETS = {
  "XAU/USD": {
    name: "Gold",
    decimals: 2,
    minStopPct: 0.00045,
    maxStopPct: 0.0025,
    atrMultiplier: 0.85,
    defaultMaxSpreadPct: 0.00035
  },
  "BTC/USD": {
    name: "Bitcoin",
    decimals: 2,
    minStopPct: 0.0007,
    maxStopPct: 0.004,
    atrMultiplier: 0.95,
    defaultMaxSpreadPct: 0.0008
  }
};

const cache = new Map();

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return 0;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function stddev(values) {
  if (!values.length) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map(v => (v - mean) ** 2)));
}

function errorText(value) {
  if (!value) return "Unknown error.";
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message || "Unknown error.";
  if (typeof value === "object") {
    if (typeof value.message === "string") return value.message;
    if (typeof value.error === "string") return value.error;
    try { return JSON.stringify(value); } catch {}
  }
  return String(value);
}

function requestBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

function getSymbol(req, body) {
  const symbol = body.symbol || req.query?.symbol || "XAU/USD";
  if (!MARKETS[symbol]) {
    throw new Error("Unsupported symbol. Use XAU/USD or BTC/USD.");
  }
  return symbol;
}

function buildURL(path, params) {
  const query = Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
  return `${BASE_URL}${path}?${query}`;
}

async function fetchJSON(url, ttlMs = 0) {
  const now = Date.now();
  const cached = cache.get(url);
  if (ttlMs && cached && now - cached.time < ttlMs) return cached.data;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });

    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); }
    catch { throw new Error("Market provider returned invalid JSON."); }

    if (!response.ok || data?.status === "error") {
      throw new Error(errorText(data?.message || data?.error || `Market request failed (${response.status}).`));
    }

    if (ttlMs) cache.set(url, { time: now, data });
    return data;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Market request timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function getCandles(symbol, interval, outputsize) {
  if (!API_KEY) throw new Error("TWELVE_DATA_API_KEY is missing in Vercel.");

  const url = buildURL("/time_series", {
    symbol,
    interval,
    outputsize,
    timezone: "UTC",
    format: "JSON",
    apikey: API_KEY
  });

  const data = await fetchJSON(url, 35000);
  if (!Array.isArray(data.values)) throw new Error(`No ${interval} candles returned for ${symbol}.`);

  const candles = data.values
    .map(item => ({
      time: String(item.datetime || ""),
      open: Number(item.open),
      high: Number(item.high),
      low: Number(item.low),
      close: Number(item.close),
      volume: Number(item.volume || 0)
    }))
    .filter(c => [c.open, c.high, c.low, c.close].every(Number.isFinite))
    .reverse();

  if (candles.length < 50) throw new Error(`Not enough ${interval} candles returned for ${symbol}.`);
  return candles;
}

async function getLivePrice(symbol) {
  if (!API_KEY) throw new Error("TWELVE_DATA_API_KEY is missing in Vercel.");

  const url = buildURL("/price", { symbol, apikey: API_KEY });
  const data = await fetchJSON(url, 10000);
  const price = Number(data.price);
  if (!Number.isFinite(price)) throw new Error(`Live ${symbol} price unavailable.`);
  return price;
}

async function getQuoteSafe(symbol) {
  try {
    const url = buildURL("/quote", { symbol, apikey: API_KEY });
    const data = await fetchJSON(url, 12000);
    const bid = Number(data.bid);
    const ask = Number(data.ask);
    if (Number.isFinite(bid) && Number.isFinite(ask) && ask >= bid) {
      return { bid, ask, spread: ask - bid, source: "provider" };
    }
  } catch {}
  return { bid: null, ask: null, spread: null, source: "unavailable" };
}

function parseTime(value) {
  let text = String(value || "").trim().replace(" ", "T");
  if (!text.endsWith("Z") && !/[+-]\d\d:\d\d$/.test(text)) text += "Z";
  return Date.parse(text);
}

function resample(candles, minutes) {
  const size = minutes * 60000;
  const groups = new Map();

  for (const candle of candles) {
    const timestamp = parseTime(candle.time);
    if (!Number.isFinite(timestamp)) continue;
    const bucket = Math.floor(timestamp / size) * size;
    const key = String(bucket);

    if (!groups.has(key)) {
      groups.set(key, {
        time: new Date(bucket).toISOString(),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume || 0
      });
    } else {
      const existing = groups.get(key);
      existing.high = Math.max(existing.high, candle.high);
      existing.low = Math.min(existing.low, candle.low);
      existing.close = candle.close;
      existing.volume += candle.volume || 0;
    }
  }

  return [...groups.values()].sort((a, b) => parseTime(a.time) - parseTime(b.time));
}

function emaSeries(values, period) {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const output = [values[0]];
  for (let i = 1; i < values.length; i++) {
    output.push(values[i] * k + output[i - 1] * (1 - k));
  }
  return output;
}

function ema(values, period) {
  const series = emaSeries(values, period);
  return series.at(-1) ?? 0;
}

function rsi(values, period = 14) {
  if (values.length <= period) return 50;
  let gains = 0;
  let losses = 0;

  for (let i = values.length - period; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }

  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - 100 / (1 + rs);
}

function atr(candles, period = 14) {
  if (candles.length < 2) return 0;
  const ranges = [];
  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];
    ranges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    ));
  }
  return average(ranges.slice(-period));
}

function macd(values) {
  if (values.length < 35) return 0;
  const fast = emaSeries(values, 12);
  const slow = emaSeries(values, 26);
  const line = values.map((_, i) => fast[i] - slow[i]);
  const signal = emaSeries(line, 9);
  return line.at(-1) - signal.at(-1);
}

function adx(candles, period = 14) {
  if (candles.length < period + 2) return 20;
  const tr = [];
  const plus = [];
  const minus = [];

  for (let i = 1; i < candles.length; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;

    plus.push(up > down && up > 0 ? up : 0);
    minus.push(down > up && down > 0 ? down : 0);
    tr.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    ));
  }

  const trAvg = average(tr.slice(-period));
  if (!trAvg) return 20;
  const plusDI = 100 * average(plus.slice(-period)) / trAvg;
  const minusDI = 100 * average(minus.slice(-period)) / trAvg;
  if (plusDI + minusDI === 0) return 20;
  return 100 * Math.abs(plusDI - minusDI) / (plusDI + minusDI);
}

function bollinger(values, period = 20, mult = 2) {
  const window = values.slice(-period);
  const middle = average(window);
  const sd = stddev(window);
  return {
    middle,
    upper: middle + mult * sd,
    lower: middle - mult * sd,
    widthPct: middle ? ((mult * 2 * sd) / middle) * 100 : 0
  };
}

function stochastic(candles, period = 14) {
  const window = candles.slice(-period);
  const high = Math.max(...window.map(c => c.high));
  const low = Math.min(...window.map(c => c.low));
  const close = candles.at(-1)?.close || 0;
  return high === low ? 50 : ((close - low) / (high - low)) * 100;
}

function vwap(candles) {
  const window = candles.slice(-80);
  let pv = 0;
  let vol = 0;
  for (const c of window) {
    const typical = (c.high + c.low + c.close) / 3;
    const weight = c.volume > 0 ? c.volume : 1;
    pv += typical * weight;
    vol += weight;
  }
  return vol ? pv / vol : candles.at(-1)?.close || 0;
}

function trendSnapshot(candles) {
  const closes = candles.map(c => c.close);
  const latest = candles.at(-1);
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const e50 = ema(closes, 50);
  const R = rsi(closes, 14);
  const M = macd(closes);
  const A = adx(candles, 14);
  const B = bollinger(closes, 20, 2);
  const S = stochastic(candles, 14);
  const V = vwap(candles);
  let score = 0;

  score += latest.close > e9 ? 1 : -1;
  score += e9 > e21 ? 1 : -1;
  score += e21 > e50 ? 1 : -1;
  score += latest.close > V ? 0.6 : -0.6;

  if (R > 54) score += 0.8;
  else if (R < 46) score -= 0.8;

  if (M > 0) score += 0.8;
  else if (M < 0) score -= 0.8;

  return {
    score,
    bias: score >= 2 ? "BULLISH" : score <= -2 ? "BEARISH" : "NEUTRAL",
    ema9: e9,
    ema21: e21,
    ema50: e50,
    rsi: R,
    macd: M,
    adx: A,
    atr: atr(candles, 14),
    bollinger: B,
    stochastic: S,
    vwap: V
  };
}

function pivots(candles, left = 2, right = 2) {
  const highs = [];
  const lows = [];
  for (let i = left; i < candles.length - right; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) highs.push({ index: i, price: candles[i].high, time: candles[i].time });
    if (isLow) lows.push({ index: i, price: candles[i].low, time: candles[i].time });
  }
  return { highs, lows };
}

function structureAnalysis(candles) {
  const slice = candles.slice(-140);
  const p = pivots(slice);
  const highs = p.highs.slice(-3);
  const lows = p.lows.slice(-3);
  const latest = slice.at(-1);

  let score = 0;
  let label = "RANGE";
  let detail = "No confirmed M5 break of structure.";
  let choch = false;

  if (highs.length >= 2 && lows.length >= 2) {
    const hh = highs.at(-1).price > highs.at(-2).price;
    const hl = lows.at(-1).price > lows.at(-2).price;
    const lh = highs.at(-1).price < highs.at(-2).price;
    const ll = lows.at(-1).price < lows.at(-2).price;

    if (hh && hl) {
      score += 2;
      label = "HH / HL";
      detail = "Bullish M5 structure.";
    } else if (lh && ll) {
      score -= 2;
      label = "LH / LL";
      detail = "Bearish M5 structure.";
    }

    const lastHigh = highs.at(-1).price;
    const lastLow = lows.at(-1).price;

    if (latest.close > lastHigh) {
      score += 1.75;
      label = "BOS UP";
      detail = "Bullish M5 break of structure.";
      if (lh || ll) choch = true;
    } else if (latest.close < lastLow) {
      score -= 1.75;
      label = "BOS DOWN";
      detail = "Bearish M5 break of structure.";
      if (hh || hl) choch = true;
    }
  }

  return {
    score,
    label: choch ? `CHoCH Â· ${label}` : label,
    detail,
    choch,
    swingHigh: highs.at(-1)?.price ?? Math.max(...slice.slice(-20).map(c => c.high)),
    swingLow: lows.at(-1)?.price ?? Math.min(...slice.slice(-20).map(c => c.low))
  };
}

function liquiditySweep(candles, lookback = 18) {
  const latest = candles.at(-1);
  const previous = candles.slice(-(lookback + 1), -1);
  const high = Math.max(...previous.map(c => c.high));
  const low = Math.min(...previous.map(c => c.low));

  if (latest.low < low && latest.close > low) {
    return { score: 2, label: "SELL-SIDE SWEEP", detail: "Lows were swept and reclaimed." };
  }
  if (latest.high > high && latest.close < high) {
    return { score: -2, label: "BUY-SIDE SWEEP", detail: "Highs were swept and rejected." };
  }
  return { score: 0, label: "NO SWEEP", detail: "No fresh confirmed liquidity sweep." };
}

function equalHighLow(candles, tolerancePct = 0.00035) {
  const p = pivots(candles.slice(-120));
  const highs = p.highs.slice(-6);
  const lows = p.lows.slice(-6);
  let equalHigh = null;
  let equalLow = null;

  for (let i = highs.length - 1; i > 0 && !equalHigh; i--) {
    const a = highs[i].price;
    const b = highs[i - 1].price;
    if (Math.abs(a - b) / ((a + b) / 2) <= tolerancePct) equalHigh = (a + b) / 2;
  }

  for (let i = lows.length - 1; i > 0 && !equalLow; i--) {
    const a = lows[i].price;
    const b = lows[i - 1].price;
    if (Math.abs(a - b) / ((a + b) / 2) <= tolerancePct) equalLow = (a + b) / 2;
  }

  return {
    equalHigh,
    equalLow,
    label: equalHigh && equalLow ? "EQH + EQL" : equalHigh ? "EQUAL HIGHS" : equalLow ? "EQUAL LOWS" : "NONE"
  };
}

function latestFVG(candles) {
  const start = Math.max(2, candles.length - 24);
  for (let i = candles.length - 1; i >= start; i--) {
    const a = candles[i - 2];
    const c = candles[i];
    if (c.low > a.high) {
      return {
        score: 1,
        label: "BULLISH FVG",
        low: a.high,
        high: c.low,
        midpoint: (a.high + c.low) / 2,
        detail: "Bullish three-candle imbalance detected."
      };
    }
    if (c.high < a.low) {
      return {
        score: -1,
        label: "BEARISH FVG",
        low: c.high,
        high: a.low,
        midpoint: (c.high + a.low) / 2,
        detail: "Bearish three-candle imbalance detected."
      };
    }
  }
  return { score: 0, label: "NONE", low: null, high: null, midpoint: null, detail: "No recent FVG." };
}

function latestOrderBlock(candles) {
  const start = Math.max(2, candles.length - 20);
  for (let i = candles.length - 2; i >= start; i--) {
    const previous = candles[i - 1];
    const impulse = candles[i];
    const next = candles[i + 1];

    if (previous.close < previous.open && impulse.close > impulse.open && next.close > impulse.high) {
      return {
        score: 1,
        label: "BULLISH OB",
        low: previous.low,
        high: previous.high,
        midpoint: (previous.low + previous.high) / 2,
        detail: "Last bearish candle before bullish displacement."
      };
    }

    if (previous.close > previous.open && impulse.close < impulse.open && next.close < impulse.low) {
      return {
        score: -1,
        label: "BEARISH OB",
        low: previous.low,
        high: previous.high,
        midpoint: (previous.low + previous.high) / 2,
        detail: "Last bullish candle before bearish displacement."
      };
    }
  }
  return { score: 0, label: "NONE", low: null, high: null, midpoint: null, detail: "No clean recent order block." };
}

function premiumDiscount(candles) {
  const recent = candles.slice(-60);
  const high = Math.max(...recent.map(c => c.high));
  const low = Math.min(...recent.map(c => c.low));
  const midpoint = (high + low) / 2;
  const price = candles.at(-1).close;

  return price < midpoint
    ? { score: 0.6, label: "DISCOUNT", high, low, midpoint }
    : { score: -0.6, label: "PREMIUM", high, low, midpoint };
}

function oteZone(candles, direction) {
  const recent = candles.slice(-60);
  const high = Math.max(...recent.map(c => c.high));
  const low = Math.min(...recent.map(c => c.low));
  const range = high - low;

  if (direction === "BUY") {
    return {
      low: high - range * 0.79,
      high: high - range * 0.62,
      label: "BULL OTE"
    };
  }

  return {
    low: low + range * 0.62,
    high: low + range * 0.79,
    label: "BEAR OTE"
  };
}

function entryTrigger(candles) {
  const previous = candles.at(-2);
  const latest = candles.at(-1);
  const range = Math.max(latest.high - latest.low, 1e-9);
  const body = Math.abs(latest.close - latest.open);
  const efficiency = body / range;

  const bullishEngulf = previous.close < previous.open && latest.close > latest.open && latest.open <= previous.close && latest.close >= previous.open;
  const bearishEngulf = previous.close > previous.open && latest.close < latest.open && latest.open >= previous.close && latest.close <= previous.open;

  if (bullishEngulf) return { score: 2, label: "BULLISH ENGULF", efficiency, detail: "M1 bullish engulfing trigger." };
  if (bearishEngulf) return { score: -2, label: "BEARISH ENGULF", efficiency, detail: "M1 bearish engulfing trigger." };
  if (efficiency > 0.72 && latest.close > latest.open) return { score: 1, label: "BULL DISPLACEMENT", efficiency, detail: "Strong bullish M1 displacement." };
  if (efficiency > 0.72 && latest.close < latest.open) return { score: -1, label: "BEAR DISPLACEMENT", efficiency, detail: "Strong bearish M1 displacement." };

  return { score: 0, label: "NO TRIGGER", efficiency, detail: "No strong M1 execution trigger." };
}

function fakeBreakout(candles) {
  const latest = candles.at(-1);
  const previous = candles.slice(-21, -1);
  const high = Math.max(...previous.map(c => c.high));
  const low = Math.min(...previous.map(c => c.low));

  if (latest.high > high && latest.close < high) {
    return { score: -1.2, label: "FAKE BREAK HIGH", detail: "Price broke above range high but closed back inside." };
  }
  if (latest.low < low && latest.close > low) {
    return { score: 1.2, label: "FAKE BREAK LOW", detail: "Price broke below range low but closed back inside." };
  }
  return { score: 0, label: "NONE", detail: "No fake breakout detected." };
}

function volumeAnomaly(candles) {
  const latest = candles.at(-1);
  const prior = candles.slice(-21, -1).map(c => c.volume).filter(v => v > 0);
  if (!prior.length || latest.volume <= 0) return { ratio: null, label: "NO VOLUME DATA", score: 0 };
  const base = average(prior);
  const ratio = base ? latest.volume / base : 1;
  return {
    ratio,
    label: ratio >= 1.8 ? "VOLUME EXPANSION" : ratio <= 0.65 ? "LOW VOLUME" : "NORMAL VOLUME",
    score: ratio >= 1.8 ? 0.5 : ratio <= 0.65 ? -0.25 : 0
  };
}

function compressionExpansion(candles) {
  const closes = candles.map(c => c.close);
  const current = bollinger(closes.slice(-40), 20, 2).widthPct;
  const priorWidths = [];
  for (let i = 40; i <= candles.length; i += 10) {
    priorWidths.push(bollinger(closes.slice(0, i), 20, 2).widthPct);
  }
  const baseline = average(priorWidths.slice(-10)) || current;
  const ratio = baseline ? current / baseline : 1;
  return {
    ratio,
    label: ratio <= 0.72 ? "COMPRESSION" : ratio >= 1.3 ? "EXPANSION" : "NORMAL",
    score: ratio >= 1.3 ? 0.4 : ratio <= 0.72 ? -0.2 : 0
  };
}

function sessionContext(symbol) {
  if (symbol === "BTC/USD") {
    return { name: "24/7 CRYPTO", killzone: "CRYPTO CONTINUOUS", score: 0.2 };
  }

  const hour = (new Date().getUTCHours() + 2) % 24;

  if (hour >= 8 && hour < 11) return { name: "LONDON", killzone: "LONDON OPEN", score: 0.7 };
  if (hour >= 14 && hour < 17) return { name: "NEW YORK", killzone: "NY OPEN", score: 0.9 };
  if (hour >= 17 && hour < 19) return { name: "LONDON / NY", killzone: "OVERLAP", score: 0.8 };
  if (hour >= 19 && hour < 22) return { name: "NEW YORK", killzone: "NY PM", score: 0.3 };
  return { name: "OFF-PEAK", killzone: "OFF-PEAK", score: -0.5 };
}

function dayKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function dailyLevels(candles) {
  const latestTs = parseTime(candles.at(-1).time);
  const currentDay = dayKey(latestTs);
  const uniqueDays = [...new Set(candles.map(c => dayKey(parseTime(c.time))))];
  const previousDay = [...uniqueDays].reverse().find(d => d < currentDay);

  const previous = previousDay ? candles.filter(c => dayKey(parseTime(c.time)) === previousDay) : [];
  const current = candles.filter(c => dayKey(parseTime(c.time)) === currentDay);

  const pdh = previous.length ? Math.max(...previous.map(c => c.high)) : null;
  const pdl = previous.length ? Math.min(...previous.map(c => c.low)) : null;

  const asia = current.filter(c => {
    const hourUTC = new Date(parseTime(c.time)).getUTCHours();
    return hourUTC >= 0 && hourUTC < 6;
  });

  const asiaHigh = asia.length ? Math.max(...asia.map(c => c.high)) : null;
  const asiaLow = asia.length ? Math.min(...asia.map(c => c.low)) : null;

  return { previousDay, pdh, pdl, asiaHigh, asiaLow };
}

function rangeLocation(price, high, low) {
  if (!Number.isFinite(price) || !Number.isFinite(high) || !Number.isFinite(low) || high <= low) return 50;
  return ((price - low) / (high - low)) * 100;
}

function scalpSetup(symbol, m1, m5, m15, quote, options) {
  const market = MARKETS[symbol];
  const T1 = trendSnapshot(m1);
  const T5 = trendSnapshot(m5);
  const T15 = trendSnapshot(m15);
  const structure = structureAnalysis(m5);
  const liquidity5 = liquiditySweep(m5, 18);
  const liquidity1 = liquiditySweep(m1, 14);
  const eq = equalHighLow(m5, symbol === "BTC/USD" ? 0.00065 : 0.00035);
  const fvg = latestFVG(m5);
  const ob = latestOrderBlock(m5);
  const pd = premiumDiscount(m15);
  const trigger = entryTrigger(m1);
  const fakeout = fakeBreakout(m1);
  const volume = volumeAnomaly(m1);
  const volatility = compressionExpansion(m5);
  const session = sessionContext(symbol);
  const levels = dailyLevels(m5);

  let raw =
      T15.score * 2.35
    + T5.score * 1.7
    + T1.score * 0.9
    + structure.score * 1.25
    + liquidity5.score * 1.25
    + liquidity1.score * 0.75
    + fvg.score * 0.75
    + ob.score * 0.8
    + pd.score * 0.45
    + trigger.score * 1.3
    + fakeout.score * 1.0
    + volume.score * 0.4
    + volatility.score * 0.35;

  raw += Math.sign(raw || 1) * session.score;

  if (T15.bias === "BULLISH" && raw < 0) raw *= 0.5;
  if (T15.bias === "BEARISH" && raw > 0) raw *= 0.5;

  const direction = raw >= 0 ? "BUY" : "SELL";
  const sign = direction === "BUY" ? 1 : -1;
  const ote = oteZone(m15, direction);

  const tfAgreement = [T1, T5, T15].filter(t => direction === "BUY" ? t.score > 0 : t.score < 0).length;
  const featureAgreement = [structure.score, liquidity5.score, liquidity1.score, fvg.score, ob.score, trigger.score, fakeout.score]
    .filter(v => direction === "BUY" ? v > 0 : v < 0).length;

  let confidence = 46 + tfAgreement * 8 + featureAgreement * 2.8 + Math.min(18, Math.abs(raw));
  if (direction === "BUY" && trigger.score > 0) confidence += 4;
  if (direction === "SELL" && trigger.score < 0) confidence += 4;
  confidence = Math.round(clamp(confidence, 45, 96));

  let entryQuality = 45;
  entryQuality += trigger.score === 0 ? 0 : 16;
  entryQuality += liquidity1.score === 0 ? 0 : 12;
  entryQuality += (direction === "BUY" ? T1.score > 0 : T1.score < 0) ? 10 : -6;
  entryQuality += fakeout.score === 0 ? 0 : 8;
  entryQuality += session.score > 0 ? 8 : -4;
  entryQuality += volatility.label === "EXPANSION" ? 6 : volatility.label === "COMPRESSION" ? -5 : 0;
  entryQuality = Math.round(clamp(entryQuality, 20, 98));

  const price = m1.at(-1).close;
  const spreadPct = quote.spread != null && price ? quote.spread / price : null;
  const maxSpreadPct = clamp(num(options.maxSpreadPct, market.defaultMaxSpreadPct), 0.00001, 0.02);

  const rangePct = rangeLocation(price, pd.high, pd.low);
  const blockedReasons = [];

  if (options.newsLock) blockedReasons.push(options.newsLabel ? `News lock: ${options.newsLabel}` : "High-impact news lock active.");
  if (spreadPct != null && spreadPct > maxSpreadPct) blockedReasons.push(`Spread filter blocked trade (${(spreadPct * 100).toFixed(3)}%).`);
  if (T5.adx < 13 && rangePct > 38 && rangePct < 62) blockedReasons.push("No-trade zone: weak M5 trend in middle of range.");
  if (volatility.label === "COMPRESSION" && T5.adx < 16) blockedReasons.push("No-trade zone: volatility compression without breakout confirmation.");
  if (num(options.dailyR, 0) <= -Math.abs(num(options.maxDailyLossR, 3))) blockedReasons.push("Daily loss guard reached.");
  if (num(options.tradesToday, 0) >= Math.max(1, num(options.maxTradesPerDay, 8))) blockedReasons.push("Maximum trades for today reached.");

  const minConfidence = clamp(num(options.minConfidence, 66), 50, 95);
  const minEntryQuality = clamp(num(options.minEntryQuality, 62), 30, 95);
  const confluenceOK = confidence >= minConfidence && entryQuality >= minEntryQuality && Math.abs(raw) >= 4.2;
  const riskOK = blockedReasons.length === 0;
  const tradeable = confluenceOK && riskOK;

  const allowWait = options.allowWait !== false;
  const signal = tradeable ? direction : (allowWait || !riskOK ? "WAIT" : direction);

  const atrBlend = Math.max(T1.atr * 1.15, T5.atr * 0.55, price * market.minStopPct);
  let stopDistance = Math.max(atrBlend * market.atrMultiplier, price * market.minStopPct);

  const recentM1 = m1.slice(-12);
  const microHigh = Math.max(...recentM1.map(c => c.high));
  const microLow = Math.min(...recentM1.map(c => c.low));

  if (direction === "BUY" && microLow < price) {
    stopDistance = Math.max(stopDistance, price - microLow + T1.atr * 0.12);
  }
  if (direction === "SELL" && microHigh > price) {
    stopDistance = Math.max(stopDistance, microHigh - price + T1.atr * 0.12);
  }

  stopDistance = Math.min(stopDistance, price * market.maxStopPct);

  const rr = clamp(num(options.rr, 1.5), 1, 3);
  const stopLoss = price - sign * stopDistance;
  const tp1 = price + sign * stopDistance * 1.0;
  const tp2 = price + sign * stopDistance * rr;
  const tp3 = price + sign * stopDistance * Math.max(rr + 0.75, 2.25);
  const breakeven = price + sign * stopDistance * 0.8;
  const trailTrigger = price + sign * stopDistance * 1.2;

  const marketEntry = price;
  const retracementEntry = direction === "BUY"
    ? Math.max(Math.min(T1.ema9, price), price - stopDistance * 0.45)
    : Math.min(Math.max(T1.ema9, price), price + stopDistance * 0.45);
  const aggressiveEntry = direction === "BUY" ? price + T1.atr * 0.05 : price - T1.atr * 0.05;

  const expiryMinutes = clamp(num(options.expiryMinutes, 6), 2, 30);
  const expiresAt = new Date(Date.now() + expiryMinutes * 60000).toISOString();

  const quality = confidence >= 86 && entryQuality >= 78 ? "A+" : confidence >= 78 ? "A" : confidence >= 68 ? "B" : "C";

  const tags = [
    session.killzone,
    T15.bias,
    structure.label,
    liquidity5.label,
    trigger.label,
    pd.label,
    volatility.label
  ].filter(Boolean);

  const reasons = [
    `${direction} bias from M15 trend, M5 setup and M1 execution model.`,
    `M15 ${T15.bias} Â· RSI ${round(T15.rsi, 1)} Â· VWAP ${round(T15.vwap, market.decimals)}.`,
    `M5 ${T5.bias} Â· ${structure.label} Â· ADX ${round(T5.adx, 1)}.`,
    `${liquidity5.label}: ${liquidity5.detail}`,
    `M1 trigger: ${trigger.label} Â· ${liquidity1.label}.`,
    `${ob.label}: ${ob.detail}`,
    `${fvg.label}: ${fvg.detail}`,
    `${fakeout.label}: ${fakeout.detail}`,
    `Range location ${round(rangePct, 0)}% Â· ${pd.label} Â· ${ote.label}.`,
    `Session ${session.name} Â· ${session.killzone}.`,
    `Volatility ${volatility.label} Â· volume ${volume.label}.`,
    `Risk plan: TP1 1R, TP2 ${rr.toFixed(2)}R, TP3 ${Math.max(rr + 0.75, 2.25).toFixed(2)}R.`
  ];

  return {
    signal,
    directionalBias: direction,
    tradeable,
    confidence,
    entryQuality,
    quality,
    rawScore: raw,
    blockedReasons,
    strategy: "M15 Bias â M5 Structure/Liquidity â M1 Trigger",
    timeframe: "M15 / M5 / M1 SCALP",
    session: session.name,
    killzone: session.killzone,
    regime: T5.adx >= 25 ? "TRENDING" : T5.adx < 15 ? "RANGING" : "TRANSITION",
    volatility: {
      label: volatility.label,
      ratio: volatility.ratio,
      atrM5: T5.atr
    },
    entry: price,
    entryPlans: {
      market: marketEntry,
      retracement: retracementEntry,
      aggressive: aggressiveEntry
    },
    stopLoss,
    takeProfit: tp2,
    takeProfit1: tp1,
    takeProfit2: tp2,
    takeProfit3: tp3,
    breakeven,
    trailTrigger,
    rr,
    expiresAt,
    setupExpiryMinutes: expiryMinutes,
    timeframeBias: { M1: T1.bias, M5: T5.bias, M15: T15.bias },
    features: {
      structure,
      liquidity: liquidity5,
      microLiquidity: liquidity1,
      equalHighLow: eq,
      fvg,
      orderBlock: ob,
      premiumDiscount: pd,
      ote,
      candlePattern: trigger,
      fakeBreakout: fakeout,
      volume,
      compression: volatility
    },
    levels,
    spread: {
      bid: quote.bid,
      ask: quote.ask,
      absolute: quote.spread,
      percent: spreadPct,
      maxPercent: maxSpreadPct,
      source: quote.source
    },
    indicators: {
      M1: { rsi: T1.rsi, macd: T1.macd, adx: T1.adx, atr: T1.atr, vwap: T1.vwap, stochastic: T1.stochastic },
      M5: { rsi: T5.rsi, macd: T5.macd, adx: T5.adx, atr: T5.atr, vwap: T5.vwap, stochastic: T5.stochastic },
      M15: { rsi: T15.rsi, macd: T15.macd, adx: T15.adx, atr: T15.atr, vwap: T15.vwap, stochastic: T15.stochastic }
    },
    tags,
    reasons
  };
}

async function maybeTelegram(payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat || payload.signal === "WAIT") return { configured: Boolean(token && chat), sent: false };

  try {
    const text = [
      `MKAYFX SCALPER V2`,
      `${payload.symbol} ${payload.signal}`,
      `Entry: ${payload.entry}`,
      `SL: ${payload.stopLoss}`,
      `TP1: ${payload.takeProfit1}`,
      `TP2: ${payload.takeProfit2}`,
      `TP3: ${payload.takeProfit3}`,
      `Confidence: ${payload.confidence}%`,
      `Entry quality: ${payload.entryQuality}%`,
      `Quality: ${payload.quality}`
    ].join("\n");

    const response = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text })
    });

    return { configured: true, sent: response.ok };
  } catch {
    return { configured: true, sent: false };
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  try {
    if (!API_KEY) throw new Error("TWELVE_DATA_API_KEY is missing in Vercel Environment Variables.");

    const body = requestBody(req);
    const symbol = getSymbol(req, body);
    const market = MARKETS[symbol];
    const mode = String(req.query?.mode || "").toLowerCase();

    if (req.method === "GET" && mode === "health") {
      return res.status(200).json({
        success: true,
        service: "MKAYFX SCALPER V2",
        strategy: "M15 Bias â M5 Structure/Liquidity â M1 Trigger",
        apiKeyConfigured: Boolean(API_KEY),
        telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
        supported: Object.keys(MARKETS)
      });
    }

    if (req.method === "GET" && mode === "price") {
      const price = await getLivePrice(symbol);
      return res.status(200).json({
        success: true,
        symbol,
        price: round(price, market.decimals),
        timestamp: new Date().toISOString()
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ success: false, error: "Use POST for analysis." });
    }

    const [m1, m5, quote] = await Promise.all([
      getCandles(symbol, "1min", 360),
      getCandles(symbol, "5min", 500),
      getQuoteSafe(symbol)
    ]);

    const m15 = resample(m5, 15);
    if (m15.length < 80) throw new Error("Not enough M15 history returned.");

    const result = scalpSetup(symbol, m1, m5, m15, quote, body);

    const equity = clamp(num(body.equityZAR, 200), 1, 100000000);
    const riskPercent = clamp(num(body.riskPercent, 0.5), 0.1, 5);
    const riskZAR = equity * riskPercent / 100;

    const payload = {
      success: true,
      model: "MKAYFX SCALPER V2",
      symbol,
      marketName: market.name,
      signalId: `SC2-${Date.now()}-${symbol.replace("/", "")}-${result.signal}`,
      createdAt: new Date().toISOString(),
      ...result,
      entry: round(result.entry, market.decimals),
      entryPlans: {
        market: round(result.entryPlans.market, market.decimals),
        retracement: round(result.entryPlans.retracement, market.decimals),
        aggressive: round(result.entryPlans.aggressive, market.decimals)
      },
      stopLoss: round(result.stopLoss, market.decimals),
      takeProfit: round(result.takeProfit, market.decimals),
      takeProfit1: round(result.takeProfit1, market.decimals),
      takeProfit2: round(result.takeProfit2, market.decimals),
      takeProfit3: round(result.takeProfit3, market.decimals),
      breakeven: round(result.breakeven, market.decimals),
      trailTrigger: round(result.trailTrigger, market.decimals),
      currentPrice: round(result.entry, market.decimals),
      levels: {
        previousDay: result.levels.previousDay,
        pdh: round(result.levels.pdh, market.decimals),
        pdl: round(result.levels.pdl, market.decimals),
        asiaHigh: round(result.levels.asiaHigh, market.decimals),
        asiaLow: round(result.levels.asiaLow, market.decimals)
      },
      spread: {
        bid: round(result.spread.bid, market.decimals),
        ask: round(result.spread.ask, market.decimals),
        absolute: round(result.spread.absolute, market.decimals),
        percent: result.spread.percent,
        maxPercent: result.spread.maxPercent,
        source: result.spread.source
      },
      account: {
        equityZAR: round(equity, 2),
        riskPercent: round(riskPercent, 2),
        maxRiskZAR: round(riskZAR, 2)
      },
      chart: m1.slice(-140).map(c => ({
        time: c.time,
        open: round(c.open, market.decimals),
        high: round(c.high, market.decimals),
        low: round(c.low, market.decimals),
        close: round(c.close, market.decimals)
      }))
    };

    if (body.sendTelegram) payload.telegram = await maybeTelegram(payload);
    return res.status(200).json(payload);

  } catch (error) {
    console.error("MKAYFX SCALPER V2 ERROR:", error);
    return res.status(500).json({ success: false, error: errorText(error) });
  }
}
