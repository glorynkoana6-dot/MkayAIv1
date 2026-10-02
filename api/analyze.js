/* =========================================================
   MKAYFX NEON SCANNER V1
   XAU/USD + BTC/USD
   FILE: api/analysis.js

   VERCEL ENV VARIABLE:
   TWELVE_DATA_API_KEY
========================================================= */

const API_KEY = process.env.TWELVE_DATA_API_KEY;
const BASE_URL = "https://api.twelvedata.com";

const MARKETS = {
  "XAU/USD": {
    name: "Gold",
    decimals: 2,
    minStopPct: 0.001,
    atrMultiplier: 1.15
  },

  "BTC/USD": {
    name: "Bitcoin",
    decimals: 2,
    minStopPct: 0.0015,
    atrMultiplier: 1.25
  }
};


/* =========================================================
   HELPERS
========================================================= */

function num(value, fallback = null) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;
}

function round(value, digits = 2) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return null;
  }

  return Number(
    n.toFixed(digits)
  );
}

function clamp(value, min, max) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function avg(values) {
  const valid =
    values.filter(Number.isFinite);

  if (!valid.length) {
    return 0;
  }

  return (
    valid.reduce(
      (sum, value) =>
        sum + value,
      0
    ) / valid.length
  );
}

function readableError(value) {
  if (!value) {
    return "Unknown error.";
  }

  if (typeof value === "string") {
    return value;
  }

  if (
    value instanceof Error
  ) {
    return (
      value.message ||
      "Unknown error."
    );
  }

  if (
    typeof value === "object"
  ) {
    if (
      typeof value.message ===
      "string"
    ) {
      return value.message;
    }

    if (
      typeof value.error ===
      "string"
    ) {
      return value.error;
    }

    try {
      return JSON.stringify(value);
    } catch {}
  }

  return String(value);
}

function bodyFromRequest(req) {
  if (
    req.body &&
    typeof req.body === "object"
  ) {
    return req.body;
  }

  if (
    typeof req.body === "string"
  ) {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  return {};
}

function marketFromRequest(req, body) {
  const symbol =
    body?.symbol ||
    req.query?.symbol ||
    "XAU/USD";

  if (!MARKETS[symbol]) {
    throw new Error(
      "Unsupported market. Use XAU/USD or BTC/USD."
    );
  }

  return symbol;
}


/* =========================================================
   TWELVE DATA URL
========================================================= */

function makeURL(path, params) {
  const query =
    Object.entries(params)
      .map(
        ([key, value]) =>
          encodeURIComponent(key) +
          "=" +
          encodeURIComponent(
            String(value)
          )
      )
      .join("&");

  return (
    BASE_URL +
    path +
    "?" +
    query
  );
}


/* =========================================================
   FETCH
========================================================= */

async function fetchJSON(url) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      18000
    );

  try {
    const response =
      await fetch(url, {
        method: "GET",
        cache: "no-store",

        headers: {
          Accept: "application/json"
        },

        signal: controller.signal
      });

    const raw =
      await response.text();

    let data;

    try {
      data =
        JSON.parse(raw);
    } catch {
      throw new Error(
        "Market-data provider returned invalid JSON."
      );
    }

    if (
      !response.ok ||
      data?.status === "error"
    ) {
      throw new Error(
        readableError(
          data?.message ||
          data?.error ||
          `Market request failed (${response.status}).`
        )
      );
    }

    return data;

  } catch (error) {
    if (
      error?.name ===
      "AbortError"
    ) {
      throw new Error(
        "Market-data request timed out."
      );
    }

    throw error;

  } finally {
    clearTimeout(timeout);
  }
}


/* =========================================================
   MARKET DATA
========================================================= */

async function getCandles(
  symbol,
  interval,
  outputsize
) {
  if (!API_KEY) {
    throw new Error(
      "TWELVE_DATA_API_KEY is missing in Vercel."
    );
  }

  const url =
    makeURL(
      "/time_series",
      {
        symbol,
        interval,
        outputsize,
        timezone: "UTC",
        format: "JSON",
        apikey: API_KEY
      }
    );

  const data =
    await fetchJSON(url);

  if (
    !Array.isArray(data.values)
  ) {
    throw new Error(
      `No ${interval} candles returned for ${symbol}.`
    );
  }

  const candles =
    data.values
      .map(item => ({
        time:
          String(
            item.datetime || ""
          ),

        open:
          Number(item.open),

        high:
          Number(item.high),

        low:
          Number(item.low),

        close:
          Number(item.close)
      }))
      .filter(candle =>
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close)
      )
      .reverse();

  if (
    candles.length < 30
  ) {
    throw new Error(
      `Not enough ${interval} candles returned for ${symbol}.`
    );
  }

  return candles;
}

async function getLivePrice(symbol) {
  const url =
    makeURL(
      "/price",
      {
        symbol,
        apikey: API_KEY
      }
    );

  const data =
    await fetchJSON(url);

  const price =
    Number(data.price);

  if (
    !Number.isFinite(price)
  ) {
    throw new Error(
      `Live ${symbol} price unavailable.`
    );
  }

  return price;
}


/* =========================================================
   TIME
========================================================= */

function parseTimestamp(value) {
  let text =
    String(value || "")
      .trim()
      .replace(" ", "T");

  if (
    !text.endsWith("Z") &&
    !/[+-]\d\d:\d\d$/.test(text)
  ) {
    text += "Z";
  }

  return Date.parse(text);
}


/* =========================================================
   RESAMPLING
========================================================= */

function resample(candles, minutes) {
  const bucketMs =
    minutes *
    60 *
    1000;

  const groups =
    new Map();

  for (
    const candle
    of candles
  ) {
    const timestamp =
      parseTimestamp(
        candle.time
      );

    if (
      !Number.isFinite(timestamp)
    ) {
      continue;
    }

    const bucket =
      Math.floor(
        timestamp /
        bucketMs
      ) *
      bucketMs;

    const key =
      String(bucket);

    if (!groups.has(key)) {
      groups.set(
        key,
        {
          time:
            new Date(bucket)
              .toISOString(),

          open:
            candle.open,

          high:
            candle.high,

          low:
            candle.low,

          close:
            candle.close
        }
      );

    } else {
      const current =
        groups.get(key);

      current.high =
        Math.max(
          current.high,
          candle.high
        );

      current.low =
        Math.min(
          current.low,
          candle.low
        );

      current.close =
        candle.close;
    }
  }

  return [
    ...groups.values()
  ].sort(
    (a, b) =>
      parseTimestamp(a.time) -
      parseTimestamp(b.time)
  );
}


/* =========================================================
   INDICATORS
========================================================= */

function ema(values, period) {
  if (!values.length) {
    return 0;
  }

  const k =
    2 /
    (period + 1);

  let current =
    values[0];

  for (
    let i = 1;
    i < values.length;
    i++
  ) {
    current =
      values[i] * k +
      current * (1 - k);
  }

  return current;
}

function emaSeries(
  values,
  period
) {
  if (!values.length) {
    return [];
  }

  const output =
    [values[0]];

  const k =
    2 /
    (period + 1);

  for (
    let i = 1;
    i < values.length;
    i++
  ) {
    output.push(
      values[i] * k +
      output[i - 1] *
      (1 - k)
    );
  }

  return output;
}

function rsi(
  values,
  period = 14
) {
  if (
    values.length <= period
  ) {
    return 50;
  }

  let gains = 0;
  let losses = 0;

  for (
    let i =
      values.length - period;
    i < values.length;
    i++
  ) {
    const change =
      values[i] -
      values[i - 1];

    if (change > 0) {
      gains += change;
    } else {
      losses +=
        Math.abs(change);
    }
  }

  if (losses === 0) {
    return 100;
  }

  const rs =
    (gains / period) /
    (losses / period);

  return (
    100 -
    100 / (1 + rs)
  );
}

function atr(
  candles,
  period = 14
) {
  if (
    candles.length < 2
  ) {
    return 0;
  }

  const ranges = [];

  for (
    let i = 1;
    i < candles.length;
    i++
  ) {
    const current =
      candles[i];

    const previous =
      candles[i - 1];

    ranges.push(
      Math.max(
        current.high -
        current.low,

        Math.abs(
          current.high -
          previous.close
        ),

        Math.abs(
          current.low -
          previous.close
        )
      )
    );
  }

  return avg(
    ranges.slice(-period)
  );
}

function macdHistogram(values) {
  if (
    values.length < 35
  ) {
    return 0;
  }

  const fast =
    emaSeries(
      values,
      12
    );

  const slow =
    emaSeries(
      values,
      26
    );

  const macd =
    values.map(
      (_, index) =>
        fast[index] -
        slow[index]
    );

  const signal =
    emaSeries(
      macd,
      9
    );

  return (
    macd.at(-1) -
    signal.at(-1)
  );
}


/* =========================================================
   SWINGS / STRUCTURE
========================================================= */

function recentHigh(
  candles,
  count
) {
  return Math.max(
    ...candles
      .slice(-count)
      .map(
        candle =>
          candle.high
      )
  );
}

function recentLow(
  candles,
  count
) {
  return Math.min(
    ...candles
      .slice(-count)
      .map(
        candle =>
          candle.low
      )
  );
}

function structureAnalysis(
  candles
) {
  const latest =
    candles.at(-1);

  const lookback =
    candles.slice(
      -21,
      -1
    );

  if (!lookback.length) {
    return {
      score: 0,
      label: "RANGE",
      text:
        "No clear structure break."
    };
  }

  const high =
    Math.max(
      ...lookback.map(
        candle =>
          candle.high
      )
    );

  const low =
    Math.min(
      ...lookback.map(
        candle =>
          candle.low
      )
    );

  if (
    latest.close >
    high
  ) {
    return {
      score: 2,
      label: "BOS UP",
      text:
        "Bullish break of structure confirmed."
    };
  }

  if (
    latest.close <
    low
  ) {
    return {
      score: -2,
      label: "BOS DOWN",
      text:
        "Bearish break of structure confirmed."
    };
  }

  return {
    score: 0,
    label: "RANGE",
    text:
      "Price remains inside recent structure."
  };
}


/* =========================================================
   LIQUIDITY
========================================================= */

function liquidityAnalysis(
  candles
) {
  const latest =
    candles.at(-1);

  const previous =
    candles.slice(
      -16,
      -1
    );

  if (
    previous.length < 8
  ) {
    return {
      score: 0,
      label: "NONE",
      text:
        "No clear liquidity sweep."
    };
  }

  const high =
    Math.max(
      ...previous.map(
        candle =>
          candle.high
      )
    );

  const low =
    Math.min(
      ...previous.map(
        candle =>
          candle.low
      )
    );

  if (
    latest.low < low &&
    latest.close > low
  ) {
    return {
      score: 2,
      label:
        "SELL-SIDE SWEEP",

      text:
        "Sell-side liquidity was swept and price recovered."
    };
  }

  if (
    latest.high > high &&
    latest.close < high
  ) {
    return {
      score: -2,
      label:
        "BUY-SIDE SWEEP",

      text:
        "Buy-side liquidity was swept and price rejected."
    };
  }

  return {
    score: 0,
    label: "IN RANGE",
    text:
      "No confirmed external liquidity sweep."
  };
}


/* =========================================================
   FVG
========================================================= */

function fvgAnalysis(
  candles
) {
  if (
    candles.length < 4
  ) {
    return {
      score: 0,
      label: "NONE",
      text:
        "No fair-value gap detected."
    };
  }

  const a =
    candles.at(-3);

  const c =
    candles.at(-1);

  if (
    c.low >
    a.high
  ) {
    return {
      score: 1,
      label:
        "BULLISH FVG",

      text:
        "Bullish fair-value gap detected."
    };
  }

  if (
    c.high <
    a.low
  ) {
    return {
      score: -1,
      label:
        "BEARISH FVG",

      text:
        "Bearish fair-value gap detected."
    };
  }

  return {
    score: 0,
    label: "NONE",
    text:
      "No fresh fair-value gap near current price."
  };
}


/* =========================================================
   ORDER BLOCK APPROXIMATION
========================================================= */

function orderBlockAnalysis(
  candles
) {
  if (
    candles.length < 6
  ) {
    return {
      score: 0,
      label: "NONE",
      text:
        "No clear order-block reaction."
    };
  }

  const latest =
    candles.at(-1);

  const previous =
    candles.at(-2);

  const previous2 =
    candles.at(-3);

  if (
    previous2.close <
    previous2.open &&
    previous.close >
    previous.open &&
    latest.close >
    previous.high
  ) {
    return {
      score: 1,
      label:
        "BULLISH OB",

      text:
        "Bullish order-block displacement pattern detected."
    };
  }

  if (
    previous2.close >
    previous2.open &&
    previous.close <
    previous.open &&
    latest.close <
    previous.low
  ) {
    return {
      score: -1,
      label:
        "BEARISH OB",

      text:
        "Bearish order-block displacement pattern detected."
    };
  }

  return {
    score: 0,
    label: "NONE",
    text:
      "No clean order-block displacement at the current candle."
  };
}


/* =========================================================
   PREMIUM / DISCOUNT
========================================================= */

function premiumDiscount(
  candles
) {
  const high =
    recentHigh(
      candles,
      40
    );

  const low =
    recentLow(
      candles,
      40
    );

  const current =
    candles.at(-1)
      .close;

  const midpoint =
    (high + low) /
    2;

  if (
    current <
    midpoint
  ) {
    return {
      score: 0.75,
      label:
        "DISCOUNT",

      text:
        "Price is trading in the discount half of the recent range."
    };
  }

  return {
    score: -0.75,
    label:
      "PREMIUM",

    text:
      "Price is trading in the premium half of the recent range."
  };
}


/* =========================================================
   TIMEFRAME
========================================================= */

function analyzeTimeframe(
  candles
) {
  const closes =
    candles.map(
      candle =>
        candle.close
    );

  const latest =
    candles.at(-1);

  const e20 =
    ema(
      closes.slice(-100),
      20
    );

  const e50 =
    ema(
      closes.slice(-150),
      50
    );

  const currentRSI =
    rsi(
      closes,
      14
    );

  const macd =
    macdHistogram(
      closes
    );

  let score = 0;

  score +=
    latest.close >
    e20
      ? 1
      : -1;

  score +=
    e20 >
    e50
      ? 1
      : -1;

  if (
    currentRSI > 53
  ) {
    score += 1;
  } else if (
    currentRSI < 47
  ) {
    score -= 1;
  }

  if (
    macd > 0
  ) {
    score += 1;
  } else if (
    macd < 0
  ) {
    score -= 1;
  }

  return {
    score,

    bias:
      score >= 2
        ? "BULLISH"
        : score <= -2
        ? "BEARISH"
        : "NEUTRAL",

    rsi:
      currentRSI,

    macd,

    atr:
      atr(
        candles,
        14
      ),

    ema20:
      e20,

    ema50:
      e50
  };
}


/* =========================================================
   SESSION
========================================================= */

function sessionFor(symbol) {
  if (
    symbol === "BTC/USD"
  ) {
    return "24/7 CRYPTO";
  }

  const sast =
    (
      new Date()
        .getUTCHours()
      +
      2
    ) % 24;

  if (
    sast >= 8 &&
    sast < 11
  ) {
    return "LONDON OPEN";
  }

  if (
    sast >= 11 &&
    sast < 14
  ) {
    return "LONDON";
  }

  if (
    sast >= 14 &&
    sast < 18
  ) {
    return "LONDON / NY";
  }

  if (
    sast >= 18 &&
    sast < 23
  ) {
    return "NEW YORK";
  }

  return "ASIA";
}


/* =========================================================
   BUILD SIGNAL
========================================================= */

function buildSignal(
  symbol,
  m1,
  m5,
  m15,
  h1
) {
  const market =
    MARKETS[symbol];

  const T = {
    M1:
      analyzeTimeframe(m1),

    M5:
      analyzeTimeframe(m5),

    M15:
      analyzeTimeframe(m15),

    H1:
      analyzeTimeframe(h1)
  };

  const structure =
    structureAnalysis(m5);

  const liquidity =
    liquidityAnalysis(m5);

  const fvg =
    fvgAnalysis(m5);

  const orderBlock =
    orderBlockAnalysis(m5);

  const pd =
    premiumDiscount(m15);

  const rawScore =
      T.M1.score * 0.7
    + T.M5.score * 1.2
    + T.M15.score * 1.65
    + T.H1.score * 2.2
    + structure.score * 1.35
    + liquidity.score * 1.35
    + fvg.score
    + orderBlock.score
    + pd.score;

  const signal =
    rawScore >= 0
      ? "BUY"
      : "SELL";

  const direction =
    signal === "BUY"
      ? 1
      : -1;

  const agreement =
    [
      T.M1,
      T.M5,
      T.M15,
      T.H1
    ].filter(
      item =>
        signal === "BUY"
          ? item.score > 0
          : item.score < 0
    ).length;

  let confidence =
      50
    + agreement * 6
    + Math.min(
        20,
        Math.abs(
          rawScore
        ) * 1.1
      );

  confidence =
    Math.round(
      clamp(
        confidence,
        55,
        94
      )
    );

  const entry =
    m1.at(-1)
      .close;

  const volatility =
    Math.max(
      T.M5.atr,
      entry *
      market.minStopPct
    );

  const swingHigh =
    recentHigh(
      m5,
      20
    );

  const swingLow =
    recentLow(
      m5,
      20
    );

  let stopDistance =
    Math.max(
      volatility *
      market.atrMultiplier,

      entry *
      market.minStopPct
    );

  if (
    signal === "BUY" &&
    swingLow < entry
  ) {
    stopDistance =
      Math.max(
        stopDistance,

        entry -
        swingLow +
        volatility *
        0.08
      );
  }

  if (
    signal === "SELL" &&
    swingHigh > entry
  ) {
    stopDistance =
      Math.max(
        stopDistance,

        swingHigh -
        entry +
        volatility *
        0.08
      );
  }

  stopDistance =
    Math.min(
      stopDistance,
      volatility * 2.5
    );

  const stopLoss =
    entry -
    direction *
    stopDistance;

  const takeProfit =
    entry +
    direction *
    stopDistance *
    2;

  const takeProfit2 =
    entry +
    direction *
    stopDistance *
    3;

  return {
    signal,
    confidence,

    entry,
    stopLoss,
    takeProfit,
    takeProfit2,

    strategy:
      "Structure + Liquidity",

    timeframe:
      "M5 Entry / H1 Bias",

    timeframeBias: {
      M1:
        T.M1.bias,

      M5:
        T.M5.bias,

      M15:
        T.M15.bias,

      H1:
        T.H1.bias
    },

    scanner: {
      structure:
        structure.label,

      liquidity:
        liquidity.label,

      fvg:
        fvg.label,

      orderBlock:
        orderBlock.label,

      premiumDiscount:
        pd.label
    },

    reasons: [
      `${signal} bias generated from M1, M5, M15 and H1 alignment.`,

      structure.text,

      liquidity.text,

      fvg.text,

      orderBlock.text,

      pd.text,

      `M5 RSI ${round(
        T.M5.rsi,
        1
      )} · MACD ${round(
        T.M5.macd,
        4
      )}.`,

      "Stop loss is placed using volatility and recent swing structure.",

      "Primary target is 2R and extended target is 3R."
    ]
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

  try {
    if (!API_KEY) {
      throw new Error(
        "TWELVE_DATA_API_KEY is missing in Vercel."
      );
    }

    const body =
      bodyFromRequest(req);

    const symbol =
      marketFromRequest(
        req,
        body
      );

    const market =
      MARKETS[symbol];


    /* =====================================================
       LIVE PRICE
    ===================================================== */

    if (
      req.method === "GET" &&
      String(
        req.query?.mode || ""
      ) === "price"
    ) {
      const price =
        await getLivePrice(
          symbol
        );

      return res
        .status(200)
        .json({
          success: true,
          symbol,

          price:
            round(
              price,
              market.decimals
            ),

          timestamp:
            new Date()
              .toISOString()
        });
    }


    /* =====================================================
       ANALYSIS
    ===================================================== */

    if (
      req.method !== "POST"
    ) {
      return res
        .status(405)
        .json({
          success: false,
          error:
            "Use POST for analysis."
        });
    }


    /*
      Only two candle requests.

      1min = chart + M1
      5min = M5 + M15 + H1

      This is deliberately lighter on API credits.
    */

    const [
      m1,
      m5Raw
    ] =
      await Promise.all([
        getCandles(
          symbol,
          "1min",
          240
        ),

        getCandles(
          symbol,
          "5min",
          900
        )
      ]);


    const m15 =
      resample(
        m5Raw,
        15
      );


    const h1 =
      resample(
        m5Raw,
        60
      );


    if (
      m15.length < 30 ||
      h1.length < 30
    ) {
      throw new Error(
        "Not enough candle history for the multi-timeframe scan."
      );
    }


    const result =
      buildSignal(
        symbol,
        m1,
        m5Raw,
        m15,
        h1
      );


    const equity =
      clamp(
        num(
          body.equityZAR,
          200
        ),
        1,
        100000000
      );


    const riskPercent =
      clamp(
        num(
          body.riskPercent,
          0.5
        ),
        0.1,
        5
      );


    return res
      .status(200)
      .json({
        success: true,

        model:
          "MKAYFX NEON SCANNER V1",

        symbol,

        marketName:
          market.name,

        signalId:
          `MK-${Date.now()}-${symbol.replace(
            "/",
            ""
          )}-${result.signal}`,

        signal:
          result.signal,

        confidence:
          result.confidence,

        entry:
          round(
            result.entry,
            market.decimals
          ),

        stopLoss:
          round(
            result.stopLoss,
            market.decimals
          ),

        takeProfit:
          round(
            result.takeProfit,
            market.decimals
          ),

        takeProfit2:
          round(
            result.takeProfit2,
            market.decimals
          ),

        currentPrice:
          round(
            result.entry,
            market.decimals
          ),

        riskReward: 2,

        strategy:
          result.strategy,

        timeframe:
          result.timeframe,

        session:
          sessionFor(
            symbol
          ),

        timeframeBias:
          result.timeframeBias,

        scanner:
          result.scanner,

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
              riskPercent,
              2
            ),

          maxRiskZAR:
            round(
              equity *
              riskPercent /
              100,
              2
            )
        },

        chart:
          m1
            .slice(-110)
            .map(
              candle => ({
                time:
                  candle.time,

                open:
                  round(
                    candle.open,
                    market.decimals
                  ),

                high:
                  round(
                    candle.high,
                    market.decimals
                  ),

                low:
                  round(
                    candle.low,
                    market.decimals
                  ),

                close:
                  round(
                    candle.close,
                    market.decimals
                  )
              })
            ),

        createdAt:
          new Date()
            .toISOString()
      });

  } catch (error) {
    console.error(
      "MKAYFX ERROR:",
      error
    );

    return res
      .status(500)
      .json({
        success: false,
        error:
          readableError(error)
      });
  }
}