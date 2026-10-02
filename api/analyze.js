/* =========================================================
   MKAYFX CHART SCANNER
   Vercel serverless function: /api/analysis.js
   XAU/USD ONLY

   ENVIRONMENT VARIABLE REQUIRED:
   TWELVE_DATA_API_KEY=your_key_here
========================================================= */

const API_KEY = process.env.TWELVE_DATA_API_KEY;
const BASE = "https://api.twelvedata.com";
const SYMBOL = "XAU/USD";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round(v, d = 2) {
  const n = num(v);
  return n === null ? null : Number(n.toFixed(d));
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function mean(a) {
  const x = a.filter(Number.isFinite);
  return x.length
    ? x.reduce((s, v) => s + v, 0) / x.length
    : null;
}

function body(req) {
  if (!req.body) return {};

  if (typeof req.body === "object") {
    return req.body;
  }

  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

async function getJSON(url, timeout = 18000) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeout
  );

  try {
    const r = await fetch(url, {
      signal: controller.signal
    });

    const j = await r.json().catch(() => ({}));

    if (!r.ok || j.status === "error") {
      throw new Error(
        j.message || `HTTP ${r.status}`
      );
    }

    return j;

  } finally {
    clearTimeout(timer);
  }
}

/* =========================================================
   TWELVE DATA
========================================================= */

async function candles(interval, outputsize) {

  if (!API_KEY) {
    throw new Error(
      "TWELVE_DATA_API_KEY is missing in Vercel Environment Variables."
    );
  }

  const q = new URLSearchParams({
    symbol: SYMBOL,
    interval,
    outputsize: String(outputsize),
    timezone: "UTC",
    format: "JSON",
    apikey: API_KEY
  });

  const j = await getJSON(
    `${BASE}/time_series?${q}`
  );

  if (!Array.isArray(j.values)) {
    throw new Error(
      `${interval} data unavailable.`
    );
  }

  return j.values
    .map(x => ({
      t: x.datetime,
      o: Number(x.open),
      h: Number(x.high),
      l: Number(x.low),
      c: Number(x.close),
      v: Number(x.volume || 0)
    }))
    .filter(x =>
      [x.o, x.h, x.l, x.c]
        .every(Number.isFinite)
    )
    .reverse();
}

async function liveQuote() {

  if (!API_KEY) {
    throw new Error(
      "TWELVE_DATA_API_KEY is missing."
    );
  }

  const q = new URLSearchParams({
    symbol: SYMBOL,
    apikey: API_KEY
  });

  const j = await getJSON(
    `${BASE}/quote?${q}`
  );

  const price = num(
    j.close ??
    j.price ??
    j.previous_close
  );

  if (price === null) {
    throw new Error(
      "Live XAU/USD quote unavailable."
    );
  }

  return {
    price,
    timestamp:
      j.datetime ||
      j.timestamp ||
      new Date().toISOString()
  };
}

/* =========================================================
   INDICATORS
========================================================= */

function ema(values, p) {

  if (!values.length) return null;

  const k = 2 / (p + 1);

  let e = values[0];

  for (
    let i = 1;
    i < values.length;
    i++
  ) {
    e =
      values[i] * k +
      e * (1 - k);
  }

  return e;
}

function emaSeries(values, p) {

  if (!values.length) return [];

  const k = 2 / (p + 1);

  const out = [values[0]];

  for (
    let i = 1;
    i < values.length;
    i++
  ) {
    out.push(
      values[i] * k +
      out[i - 1] * (1 - k)
    );
  }

  return out;
}

function rsi(values, p = 14) {

  if (values.length <= p) {
    return 50;
  }

  let gains = 0;
  let losses = 0;

  for (
    let i = values.length - p;
    i < values.length;
    i++
  ) {

    const d =
      values[i] -
      values[i - 1];

    if (d > 0) {
      gains += d;
    } else {
      losses -= d;
    }
  }

  if (losses === 0) {
    return 100;
  }

  const rs =
    (gains / p) /
    (losses / p);

  return (
    100 -
    (100 / (1 + rs))
  );
}

function atr(cs, p = 14) {

  if (cs.length < 2) {
    return null;
  }

  const tr = [];

  for (
    let i = 1;
    i < cs.length;
    i++
  ) {

    tr.push(
      Math.max(
        cs[i].h - cs[i].l,
        Math.abs(
          cs[i].h -
          cs[i - 1].c
        ),
        Math.abs(
          cs[i].l -
          cs[i - 1].c
        )
      )
    );
  }

  return mean(
    tr.slice(-p)
  );
}

function macdHist(values) {

  if (values.length < 35) {
    return 0;
  }

  const e12 =
    emaSeries(values, 12);

  const e26 =
    emaSeries(values, 26);

  const macd =
    values.map(
      (_, i) =>
        e12[i] - e26[i]
    );

  const sig =
    emaSeries(macd, 9);

  return (
    macd.at(-1) -
    sig.at(-1)
  );
}

function slope(values, p = 10) {

  if (
    values.length <
    p + 1
  ) {
    return 0;
  }

  return (
    values.at(-1) -
    values.at(-1 - p)
  );
}

function highest(cs, n) {
  return Math.max(
    ...cs
      .slice(-n)
      .map(x => x.h)
  );
}

function lowest(cs, n) {
  return Math.min(
    ...cs
      .slice(-n)
      .map(x => x.l)
  );
}

/* =========================================================
   TIMEFRAME ANALYSIS
========================================================= */

function tfSnapshot(cs) {

  const closes =
    cs.map(x => x.c);

  const last =
    cs.at(-1);

  const e20 =
    ema(
      closes.slice(-80),
      20
    );

  const e50 =
    ema(
      closes.slice(-120),
      50
    );

  const e200 =
    ema(
      closes.slice(-260),
      200
    );

  const rr =
    rsi(closes, 14);

  const mh =
    macdHist(closes);

  const a =
    atr(cs, 14) ||
    Math.max(
      last.c * 0.001,
      0.01
    );

  const s20 =
    slope(closes, 8);

  const prior =
    cs.slice(-21, -1);

  const prevHigh =
    prior.length
      ? Math.max(
          ...prior.map(x => x.h)
        )
      : last.h;

  const prevLow =
    prior.length
      ? Math.min(
          ...prior.map(x => x.l)
        )
      : last.l;

  let score = 0;

  if (last.c > e20) {
    score += 1;
  } else {
    score -= 1;
  }

  if (e20 > e50) {
    score += 1;
  } else {
    score -= 1;
  }

  if (e50 > e200) {
    score += 1;
  } else {
    score -= 1;
  }

  if (rr > 52) {
    score += 1;
  } else if (rr < 48) {
    score -= 1;
  }

  if (mh > 0) {
    score += 1;
  } else {
    score -= 1;
  }

  if (s20 > 0) {
    score += 1;
  } else {
    score -= 1;
  }

  const bosUp =
    last.c > prevHigh;

  const bosDown =
    last.c < prevLow;

  if (bosUp) {
    score += 1.5;
  }

  if (bosDown) {
    score -= 1.5;
  }

  return {

    bias:
      score >= 2
        ? "BULLISH"
        : score <= -2
        ? "BEARISH"
        : "NEUTRAL",

    score,

    close: last.c,

    ema20: e20,
    ema50: e50,
    ema200: e200,

    rsi: rr,
    macd: mh,
    atr: a,

    bosUp,
    bosDown,

    prevHigh,
    prevLow
  };
}

/* =========================================================
   SESSION
========================================================= */

function sessionName() {

  const h = Number(
    new Intl.DateTimeFormat(
      "en-GB",
      {
        timeZone:
          "Africa/Johannesburg",

        hour: "2-digit",

        hourCycle: "h23"
      }
    ).format(new Date())
  );

  if (
    h >= 9 &&
    h < 11
  ) {
    return "LONDON OPEN";
  }

  if (
    h >= 11 &&
    h < 14
  ) {
    return "LONDON";
  }

  if (
    h >= 14 &&
    h < 18
  ) {
    return "NEW YORK / OVERLAP";
  }

  if (
    h >= 18 &&
    h < 23
  ) {
    return "NEW YORK";
  }

  return "ASIA / TRANSITION";
}

/* =========================================================
   LIQUIDITY
========================================================= */

function liquiditySignal(cs) {

  const x =
    cs.at(-1);

  const prior =
    cs.slice(-16, -1);

  if (
    !x ||
    prior.length < 8
  ) {
    return {
      score: 0,
      text:
        "No strong liquidity sweep detected."
    };
  }

  const ph =
    Math.max(
      ...prior.map(
        c => c.h
      )
    );

  const pl =
    Math.min(
      ...prior.map(
        c => c.l
      )
    );

  if (
    x.l < pl &&
    x.c > pl
  ) {
    return {
      score: 2,
      text:
        "Sell-side liquidity sweep with recovery."
    };
  }

  if (
    x.h > ph &&
    x.c < ph
  ) {
    return {
      score: -2,
      text:
        "Buy-side liquidity sweep with rejection."
    };
  }

  return {
    score: 0,
    text:
      "Liquidity remains inside the recent range."
  };
}

/* =========================================================
   CANDLE TRIGGER
========================================================= */

function candleTrigger(cs) {

  const a =
    cs.at(-1);

  const b =
    cs.at(-2);

  if (!a || !b) {
    return {
      score: 0,
      text:
        "No candle trigger."
    };
  }

  const bodyA =
    Math.abs(
      a.c - a.o
    );

  const range =
    Math.max(
      a.h - a.l,
      1e-9
    );

  const strong =
    bodyA / range > 0.62;

  if (
    strong &&
    a.c > a.o &&
    a.c > b.h
  ) {
    return {
      score: 1.5,
      text:
        "Bullish displacement candle confirmed."
    };
  }

  if (
    strong &&
    a.c < a.o &&
    a.c < b.l
  ) {
    return {
      score: -1.5,
      text:
        "Bearish displacement candle confirmed."
    };
  }

  return {
    score: 0,
    text:
      "No clean displacement trigger on the latest candle."
  };
}

/* =========================================================
   MASTER ANALYSIS
========================================================= */

function analyze(
  m1,
  m5,
  m15,
  h1,
  price
) {

  const T = {

    M1:
      tfSnapshot(m1),

    M5:
      tfSnapshot(m5),

    M15:
      tfSnapshot(m15),

    H1:
      tfSnapshot(h1)
  };

  const liq =
    liquiditySignal(m5);

  const trig =
    candleTrigger(m1);

  const signed =
      T.M1.score * 0.8
    + T.M5.score * 1.3
    + T.M15.score * 1.7
    + T.H1.score * 2.2
    + liq.score * 1.2
    + trig.score;

  const direction =
    signed >= 0
      ? "BUY"
      : "SELL";

  const sign =
    direction === "BUY"
      ? 1
      : -1;

  const agreements =
    [
      T.M1,
      T.M5,
      T.M15,
      T.H1
    ].filter(
      x =>
        direction === "BUY"
          ? x.score > 0
          : x.score < 0
    ).length;

  const absStrength =
    Math.abs(signed);

  let confidence =
      52
    + agreements * 6
    + Math.min(
        18,
        absStrength * 1.3
      );

  if (
    (
      direction === "BUY" &&
      liq.score > 0
    )
    ||
    (
      direction === "SELL" &&
      liq.score < 0
    )
  ) {
    confidence += 4;
  }

  if (
    (
      direction === "BUY" &&
      trig.score > 0
    )
    ||
    (
      direction === "SELL" &&
      trig.score < 0
    )
  ) {
    confidence += 3;
  }

  confidence =
    Math.round(
      clamp(
        confidence,
        55,
        92
      )
    );

  const a5 =
    T.M5.atr ||
    Math.max(
      price * 0.001,
      1
    );

  const swingLow =
    lowest(m5, 18);

  const swingHigh =
    highest(m5, 18);

  let risk =
    Math.max(
      a5 * 0.95,
      price * 0.0012
    );

  if (
    direction === "BUY" &&
    Number.isFinite(swingLow) &&
    swingLow < price
  ) {

    risk =
      Math.max(
        risk,
        price -
        swingLow +
        a5 * 0.12
      );
  }

  if (
    direction === "SELL" &&
    Number.isFinite(swingHigh) &&
    swingHigh > price
  ) {

    risk =
      Math.max(
        risk,
        swingHigh -
        price +
        a5 * 0.12
      );
  }

  risk =
    Math.min(
      risk,
      a5 * 2.3
    );

  const entry =
    price;

  const stopLoss =
    entry -
    sign * risk;

  const takeProfit =
    entry +
    sign *
    risk *
    2.0;

  const takeProfit2 =
    entry +
    sign *
    risk *
    3.0;

  const reasons = [];

  reasons.push(
    `${direction} bias from weighted M1/M5/M15/H1 alignment.`
  );

  reasons.push(
    `H1 is ${T.H1.bias.toLowerCase()} and M15 is ${T.M15.bias.toLowerCase()}.`
  );

  reasons.push(
    `M5 RSI ${round(T.M5.rsi, 1)} with MACD histogram ${round(T.M5.macd, 3)}.`
  );

  reasons.push(
    liq.text
  );

  reasons.push(
    trig.text
  );

  reasons.push(
    "Risk is based on M5 ATR and recent swing structure; target is 2.0R."
  );

  return {

    direction,
    confidence,

    entry,
    stopLoss,
    takeProfit,
    takeProfit2,

    risk,

    T,

    reasons
  };
}

/* =========================================================
   API HANDLER
========================================================= */

export default async function handler(
  req,
  res
) {

  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate"
  );

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (
    req.method === "OPTIONS"
  ) {
    return res
      .status(204)
      .end();
  }

  try {

    if (!API_KEY) {
      throw new Error(
        "TWELVE_DATA_API_KEY is missing in Vercel."
      );
    }

    const mode =
      String(
        req.query?.mode || ""
      ).toLowerCase();

    /* =====================================================
       LIVE PRICE ONLY
    ===================================================== */

    if (
      mode === "price"
    ) {

      const q =
        await liveQuote();

      return res
        .status(200)
        .json({

          success: true,

          symbol:
            SYMBOL,

          price:
            round(
              q.price,
              2
            ),

          time:
            q.timestamp
        });
    }

    /* =====================================================
       NEW ANALYSIS
    ===================================================== */

    const payload =
      body(req);

    const [
      m1,
      m5,
      m15,
      h1,
      quote
    ] =
      await Promise.all([

        candles(
          "1min",
          220
        ),

        candles(
          "5min",
          220
        ),

        candles(
          "15min",
          220
        ),

        candles(
          "1h",
          240
        ),

        liveQuote()

      ]);

    const result =
      analyze(
        m1,
        m5,
        m15,
        h1,
        quote.price
      );

    const equity =
      Math.max(
        1,
        num(
          payload.equityZAR
        ) ?? 200
      );

    const riskPct =
      clamp(
        num(
          payload.riskPercent
        ) ?? 0.5,
        0.1,
        3
      );

    const riskZAR =
      equity *
      (
        riskPct /
        100
      );

    return res
      .status(200)
      .json({

        success: true,

        model:
          "MKAYFX CHART SCANNER V1",

        symbol:
          SYMBOL,

        signalId:
          `MK-${Date.now()}-${result.direction}`,

        signal:
          result.direction,

        confidence:
          result.confidence,

        setupStrength:
          result.confidence,

        timeframe:
          "H1",

        session:
          sessionName(),

        createdAt:
          new Date()
            .toISOString(),

        locked:
          true,

        entry:
          round(
            result.entry,
            2
          ),

        stopLoss:
          round(
            result.stopLoss,
            2
          ),

        takeProfit:
          round(
            result.takeProfit,
            2
          ),

        takeProfit2:
          round(
            result.takeProfit2,
            2
          ),

        riskReward:
          2,

        riskReward2:
          3,

        currentPrice:
          round(
            quote.price,
            2
          ),

        timeframeBias: {

          M1:
            result.T.M1.bias,

          M5:
            result.T.M5.bias,

          M15:
            result.T.M15.bias,

          H1:
            result.T.H1.bias
        },

        indicators: {

          m5Rsi:
            round(
              result.T.M5.rsi,
              1
            ),

          m5Atr:
            round(
              result.T.M5.atr,
              2
            ),

          m5Macd:
            round(
              result.T.M5.macd,
              3
            ),

          h1Ema20:
            round(
              result.T.H1.ema20,
              2
            ),

          h1Ema50:
            round(
              result.T.H1.ema50,
              2
            )
        },

        reasons:
          result.reasons,

        account: {

          equityZAR:
            round(
              equity,
              2
            ),

          riskPercent:
            round(
              riskPct,
              2
            ),

          maxRiskZAR:
            round(
              riskZAR,
              2
            )
        },

        chart:
          m1
            .slice(-85)
            .map(c => ({

              t:
                c.t,

              o:
                round(c.o, 2),

              h:
                round(c.h, 2),

              l:
                round(c.l, 2),

              c:
                round(c.c, 2)
            })),

        lifecycle: {

          state:
            "TRADE_ACTIVE",

          rule:
            "Keep this signal locked. Only monitor price until TP or SL is hit.",

          nextAnalysis:
            "Immediately after TP or SL is reached."
        }
      });

  } catch (e) {

    console.error(e);

    return res
      .status(500)
      .json({

        success: false,

        error:
          e?.message ||
          "Analysis failed."
      });
  }
}