/* =========================================================
   MKAYFX CHART SCANNER V2
   FILE: api/analysis.js
   XAU/USD ONLY

   VERCEL ENV VARIABLE:
   TWELVE_DATA_API_KEY
========================================================= */

const API_KEY = process.env.TWELVE_DATA_API_KEY;

const BASE_URL = "https://api.twelvedata.com";
const SYMBOL = "XAU/USD";


/* =========================================================
   HELPERS
========================================================= */

function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return null;
  }

  return Number(n.toFixed(digits));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  const good = values.filter(Number.isFinite);

  if (!good.length) {
    return 0;
  }

  return (
    good.reduce((sum, value) => sum + value, 0) /
    good.length
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


/* =========================================================
   FETCH JSON
========================================================= */

async function fetchJSON(url, timeout = 15000) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json"
      }
    });

    const text = await response.text();

    let json;

    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(
        "Twelve Data returned invalid JSON."
      );
    }

    if (!response.ok) {
      throw new Error(
        json?.message ||
        `Twelve Data HTTP ${response.status}`
      );
    }

    if (json?.status === "error") {
      throw new Error(
        json?.message ||
        "Twelve Data API error."
      );
    }

    return json;

  } finally {
    clearTimeout(timer);
  }
}


/* =========================================================
   TWELVE DATA
========================================================= */

async function getCandles(interval, outputsize = 220) {
  if (!API_KEY) {
    throw new Error(
      "TWELVE_DATA_API_KEY is missing in Vercel."
    );
  }

  const params = new URLSearchParams();

  params.set("symbol", SYMBOL);
  params.set("interval", interval);
  params.set("outputsize", String(outputsize));
  params.set("timezone", "UTC");
  params.set("apikey", API_KEY);

  const url =
    `${BASE_URL}/time_series?${params.toString()}`;

  const data = await fetchJSON(url);

  if (!Array.isArray(data.values)) {
    throw new Error(
      `${interval} candle data unavailable.`
    );
  }

  const candles = data.values
    .map(item => ({
      time: item.datetime,
      open: Number(item.open),
      high: Number(item.high),
      low: Number(item.low),
      close: Number(item.close)
    }))
    .filter(candle =>
      Number.isFinite(candle.open) &&
      Number.isFinite(candle.high) &&
      Number.isFinite(candle.low) &&
      Number.isFinite(candle.close)
    )
    .reverse();

  if (candles.length < 30) {
    throw new Error(
      `Not enough ${interval} candles received.`
    );
  }

  return candles;
}


async function getLivePrice() {
  if (!API_KEY) {
    throw new Error(
      "TWELVE_DATA_API_KEY is missing in Vercel."
    );
  }

  const params = new URLSearchParams();

  params.set("symbol", SYMBOL);
  params.set("apikey", API_KEY);

  const url =
    `${BASE_URL}/price?${params.toString()}`;

  const data = await fetchJSON(url);

  const price = Number(data.price);

  if (!Number.isFinite(price)) {
    throw new Error(
      "Could not read the live XAU/USD price."
    );
  }

  return price;
}


/* =========================================================
   INDICATORS
========================================================= */

function ema(values, period) {
  if (!values.length) {
    return 0;
  }

  const k = 2 / (period + 1);

  let value = values[0];

  for (let i = 1; i < values.length; i++) {
    value =
      values[i] * k +
      value * (1 - k);
  }

  return value;
}


function emaSeries(values, period) {
  if (!values.length) {
    return [];
  }

  const output = [values[0]];

  const k = 2 / (period + 1);

  for (let i = 1; i < values.length; i++) {
    output.push(
      values[i] * k +
      output[i - 1] * (1 - k)
    );
  }

  return output;
}


function calculateRSI(values, period = 14) {
  if (values.length < period + 1) {
    return 50;
  }

  let gains = 0;
  let losses = 0;

  const start =
    values.length - period;

  for (let i = start; i < values.length; i++) {
    const change =
      values[i] - values[i - 1];

    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) {
    return 100;
  }

  const rs =
    avgGain / avgLoss;

  return (
    100 -
    100 / (1 + rs)
  );
}


function calculateATR(candles, period = 14) {
  if (candles.length < period + 1) {
    return 0;
  }

  const trueRanges = [];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];

    trueRanges.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close)
      )
    );
  }

  return average(
    trueRanges.slice(-period)
  );
}


function calculateMACD(values) {
  if (values.length < 35) {
    return {
      macd: 0,
      signal: 0,
      histogram: 0
    };
  }

  const ema12 =
    emaSeries(values, 12);

  const ema26 =
    emaSeries(values, 26);

  const macdLine =
    values.map(
      (_, index) =>
        ema12[index] -
        ema26[index]
    );

  const signalLine =
    emaSeries(macdLine, 9);

  const macdValue =
    macdLine[macdLine.length - 1];

  const signalValue =
    signalLine[signalLine.length - 1];

  return {
    macd: macdValue,
    signal: signalValue,
    histogram:
      macdValue - signalValue
  };
}


/* =========================================================
   STRUCTURE
========================================================= */

function highestHigh(candles, count) {
  return Math.max(
    ...candles
      .slice(-count)
      .map(candle => candle.high)
  );
}

function lowestLow(candles, count) {
  return Math.min(
    ...candles
      .slice(-count)
      .map(candle => candle.low)
  );
}


function analyzeTimeframe(candles) {
  const closes =
    candles.map(candle => candle.close);

  const last =
    candles[candles.length - 1];

  const ema20 =
    ema(
      closes.slice(-100),
      20
    );

  const ema50 =
    ema(
      closes.slice(-150),
      50
    );

  const ema200 =
    ema(
      closes.slice(-220),
      200
    );

  const rsi =
    calculateRSI(
      closes,
      14
    );

  const macd =
    calculateMACD(closes);

  const atr =
    calculateATR(
      candles,
      14
    );

  const previousCandles =
    candles.slice(-21, -1);

  const previousHigh =
    Math.max(
      ...previousCandles.map(
        candle => candle.high
      )
    );

  const previousLow =
    Math.min(
      ...previousCandles.map(
        candle => candle.low
      )
    );

  let score = 0;

  if (last.close > ema20) {
    score += 1;
  } else {
    score -= 1;
  }

  if (ema20 > ema50) {
    score += 1;
  } else {
    score -= 1;
  }

  if (ema50 > ema200) {
    score += 1;
  } else {
    score -= 1;
  }

  if (rsi > 52) {
    score += 1;
  }

  if (rsi < 48) {
    score -= 1;
  }

  if (macd.histogram > 0) {
    score += 1;
  }

  if (macd.histogram < 0) {
    score -= 1;
  }

  const bosUp =
    last.close >
    previousHigh;

  const bosDown =
    last.close <
    previousLow;

  if (bosUp) {
    score += 1.5;
  }

  if (bosDown) {
    score -= 1.5;
  }

  let bias = "NEUTRAL";

  if (score >= 2) {
    bias = "BULLISH";
  }

  if (score <= -2) {
    bias = "BEARISH";
  }

  return {
    bias,
    score,

    ema20,
    ema50,
    ema200,

    rsi,

    macd:
      macd.histogram,

    atr,

    bosUp,
    bosDown,

    previousHigh,
    previousLow,

    currentPrice:
      last.close
  };
}


/* =========================================================
   LIQUIDITY
========================================================= */

function analyzeLiquidity(candles) {
  if (candles.length < 20) {
    return {
      score: 0,
      text:
        "No strong liquidity sweep detected."
    };
  }

  const current =
    candles[candles.length - 1];

  const previous =
    candles.slice(-16, -1);

  const high =
    Math.max(
      ...previous.map(
        candle => candle.high
      )
    );

  const low =
    Math.min(
      ...previous.map(
        candle => candle.low
      )
    );

  if (
    current.low < low &&
    current.close > low
  ) {
    return {
      score: 2,
      text:
        "Sell-side liquidity was swept and price recovered."
    };
  }

  if (
    current.high > high &&
    current.close < high
  ) {
    return {
      score: -2,
      text:
        "Buy-side liquidity was swept and price rejected."
    };
  }

  return {
    score: 0,
    text:
      "Price remains inside the recent liquidity range."
  };
}


/* =========================================================
   CANDLE MOMENTUM
========================================================= */

function analyzeTrigger(candles) {
  if (candles.length < 3) {
    return {
      score: 0,
      text:
        "No strong entry candle detected."
    };
  }

  const current =
    candles[candles.length - 1];

  const previous =
    candles[candles.length - 2];

  const candleBody =
    Math.abs(
      current.close -
      current.open
    );

  const candleRange =
    Math.max(
      current.high -
      current.low,
      0.0001
    );

  const bodyStrength =
    candleBody /
    candleRange;

  if (
    current.close >
    current.open &&
    bodyStrength > 0.6 &&
    current.close >
    previous.high
  ) {
    return {
      score: 1.5,
      text:
        "Bullish displacement and momentum confirmed."
    };
  }

  if (
    current.close <
    current.open &&
    bodyStrength > 0.6 &&
    current.close <
    previous.low
  ) {
    return {
      score: -1.5,
      text:
        "Bearish displacement and momentum confirmed."
    };
  }

  return {
    score: 0,
    text:
      "Momentum is present but no strong displacement trigger formed."
  };
}


/* =========================================================
   SESSION
========================================================= */

function getSession() {
  const hour =
    new Date().getUTCHours();

  /*
    South Africa is UTC+2.
  */

  const sastHour =
    (hour + 2) % 24;

  if (
    sastHour >= 8 &&
    sastHour < 10
  ) {
    return "LONDON OPEN";
  }

  if (
    sastHour >= 10 &&
    sastHour < 14
  ) {
    return "LONDON";
  }

  if (
    sastHour >= 14 &&
    sastHour < 18
  ) {
    return "LONDON / NEW YORK";
  }

  if (
    sastHour >= 18 &&
    sastHour < 22
  ) {
    return "NEW YORK";
  }

  return "ASIA / TRANSITION";
}


/* =========================================================
   MASTER SIGNAL ENGINE
========================================================= */

function buildSignal({
  m1,
  m5,
  m15,
  h1,
  livePrice
}) {
  const T = {
    M1: analyzeTimeframe(m1),
    M5: analyzeTimeframe(m5),
    M15: analyzeTimeframe(m15),
    H1: analyzeTimeframe(h1)
  };

  const liquidity =
    analyzeLiquidity(m5);

  const trigger =
    analyzeTrigger(m1);

  /*
    Higher timeframes have larger weights.
  */

  const weightedScore =
      T.M1.score * 0.8
    + T.M5.score * 1.25
    + T.M15.score * 1.65
    + T.H1.score * 2.15
    + liquidity.score * 1.25
    + trigger.score;

  const direction =
    weightedScore >= 0
      ? "BUY"
      : "SELL";

  const directionalSign =
    direction === "BUY"
      ? 1
      : -1;

  const timeframeScores = [
    T.M1.score,
    T.M5.score,
    T.M15.score,
    T.H1.score
  ];

  const agreementCount =
    timeframeScores.filter(score =>
      direction === "BUY"
        ? score > 0
        : score < 0
    ).length;

  let confidence =
    52 +
    agreementCount * 6 +
    Math.min(
      18,
      Math.abs(weightedScore) *
      1.25
    );

  if (
    direction === "BUY" &&
    liquidity.score > 0
  ) {
    confidence += 4;
  }

  if (
    direction === "SELL" &&
    liquidity.score < 0
  ) {
    confidence += 4;
  }

  if (
    direction === "BUY" &&
    trigger.score > 0
  ) {
    confidence += 3;
  }

  if (
    direction === "SELL" &&
    trigger.score < 0
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

  const atr =
    T.M5.atr ||
    livePrice * 0.001;

  let stopDistance =
    Math.max(
      atr * 1.15,
      livePrice * 0.001
    );

  /*
    Use recent structure where possible.
  */

  const recentHigh =
    highestHigh(
      m5,
      20
    );

  const recentLow =
    lowestLow(
      m5,
      20
    );

  if (
    direction === "BUY" &&
    recentLow < livePrice
  ) {
    const structuralDistance =
      livePrice -
      recentLow +
      atr * 0.1;

    stopDistance =
      Math.max(
        stopDistance,
        structuralDistance
      );
  }

  if (
    direction === "SELL" &&
    recentHigh > livePrice
  ) {
    const structuralDistance =
      recentHigh -
      livePrice +
      atr * 0.1;

    stopDistance =
      Math.max(
        stopDistance,
        structuralDistance
      );
  }

  /*
    Prevent extremely huge stop distances.
  */

  stopDistance =
    Math.min(
      stopDistance,
      atr * 2.5
    );

  const entry =
    livePrice;

  const stopLoss =
    entry -
    directionalSign *
    stopDistance;

  const takeProfit =
    entry +
    directionalSign *
    stopDistance *
    2;

  const takeProfit2 =
    entry +
    directionalSign *
    stopDistance *
    3;

  const reasons = [];

  reasons.push(
    `${direction} direction selected from weighted M1, M5, M15 and H1 analysis.`
  );

  reasons.push(
    `H1 bias is ${T.H1.bias} while M15 bias is ${T.M15.bias}.`
  );

  reasons.push(
    `M5 RSI is ${round(T.M5.rsi, 1)} and MACD momentum is ${round(T.M5.macd, 3)}.`
  );

  reasons.push(
    liquidity.text
  );

  reasons.push(
    trigger.text
  );

  reasons.push(
    "Stop loss uses current M5 volatility and recent market structure."
  );

  return {
    direction,
    confidence,

    entry,
    stopLoss,
    takeProfit,
    takeProfit2,

    timeframeBias: {
      M1: T.M1.bias,
      M5: T.M5.bias,
      M15: T.M15.bias,
      H1: T.H1.bias
    },

    reasons,

    indicators: {
      m1Rsi:
        round(T.M1.rsi, 1),

      m5Rsi:
        round(T.M5.rsi, 1),

      m15Rsi:
        round(T.M15.rsi, 1),

      h1Rsi:
        round(T.H1.rsi, 1),

      m5Atr:
        round(T.M5.atr, 2),

      m5Macd:
        round(T.M5.macd, 4)
    }
  };
}


/* =========================================================
   VERCEL HANDLER
========================================================= */

export default async function handler(req, res) {
  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0"
  );

  res.setHeader(
    "Content-Type",
    "application/json"
  );

  try {
    if (!API_KEY) {
      throw new Error(
        "TWELVE_DATA_API_KEY is not configured in Vercel."
      );
    }

    /*
      FAST LIVE PRICE ENDPOINT
      /api/analysis?mode=price
    */

    if (
      req.method === "GET" &&
      String(req.query?.mode || "") === "price"
    ) {
      const price =
        await getLivePrice();

      return res.status(200).json({
        success: true,
        symbol: SYMBOL,
        price: round(price, 2),
        timestamp:
          new Date().toISOString()
      });
    }

    /*
      MAIN ANALYSIS
    */

    if (
      req.method !== "POST" &&
      req.method !== "GET"
    ) {
      return res.status(405).json({
        success: false,
        error:
          "Method not allowed."
      });
    }

    let requestBody = {};

    if (
      req.body &&
      typeof req.body === "object"
    ) {
      requestBody =
        req.body;
    }

    const equityZAR =
      clamp(
        toNumber(
          requestBody.equityZAR,
          200
        ),
        1,
        100000000
      );

    const riskPercent =
      clamp(
        toNumber(
          requestBody.riskPercent,
          0.5
        ),
        0.1,
        5
      );

    /*
      Fetch all timeframes at once.
    */

    const [
      m1,
      m5,
      m15,
      h1,
      livePrice
    ] = await Promise.all([
      getCandles(
        "1min",
        220
      ),

      getCandles(
        "5min",
        220
      ),

      getCandles(
        "15min",
        220
      ),

      getCandles(
        "1h",
        220
      ),

      getLivePrice()
    ]);

    const result =
      buildSignal({
        m1,
        m5,
        m15,
        h1,
        livePrice
      });

    const maxRiskZAR =
      equityZAR *
      riskPercent /
      100;

    const chart =
      m1
        .slice(-90)
        .map(candle => ({
          time:
            candle.time,

          open:
            round(
              candle.open,
              2
            ),

          high:
            round(
              candle.high,
              2
            ),

          low:
            round(
              candle.low,
              2
            ),

          close:
            round(
              candle.close,
              2
            )
        }));

    return res.status(200).json({
      success: true,

      model:
        "MKAYFX CHART SCANNER V2",

      symbol:
        SYMBOL,

      signal:
        result.direction,

      signalId:
        `MKAY-${Date.now()}-${result.direction}`,

      confidence:
        result.confidence,

      setupStrength:
        result.confidence,

      timeframe:
        "H1",

      session:
        getSession(),

      createdAt:
        new Date().toISOString(),

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

      currentPrice:
        round(
          livePrice,
          2
        ),

      riskReward:
        2,

      riskReward2:
        3,

      timeframeBias:
        result.timeframeBias,

      indicators:
        result.indicators,

      reasons:
        result.reasons,

      account: {
        equityZAR:
          round(
            equityZAR,
            2
          ),

        riskPercent:
          round(
            riskPercent,
            2
          ),

        maxRiskZAR:
          round(
            maxRiskZAR,
            2
          )
      },

      chart,

      lifecycle: {
        state:
          "TRADE_ACTIVE",

        rule:
          "Signal stays locked until TP or SL.",

        nextAnalysis:
          "Automatically create a new signal after TP or SL."
      }
    });

  } catch (error) {
    console.error(
      "MKAYFX ANALYSIS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,

      error:
        error?.message ||
        "Unknown server error."
    });
  }
}