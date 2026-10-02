/* =========================================================
   MKAYFX DUAL MARKET SCANNER V2
   XAU/USD + BTC/USD

   FILE:
   api/analysis.js

   VERCEL ENVIRONMENT VARIABLE:
   TWELVE_DATA_API_KEY
========================================================= */

const API_KEY = process.env.TWELVE_DATA_API_KEY;

const BASE_URL = "https://api.twelvedata.com";


const MARKETS = {

  "XAU/USD": {

    name: "Gold · Spot",

    decimals: 2,

    atrMultiplier: 1.15,

    minStopPercent: 0.0010

  },


  "BTC/USD": {

    name: "Bitcoin · USD",

    decimals: 2,

    atrMultiplier: 1.25,

    minStopPercent: 0.0015

  }

};


/* =========================================================
   HELPERS
========================================================= */

function numeric(value, fallback = null) {

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}


function round(value, digits = 2) {

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  return Number(
    number.toFixed(digits)
  );
}


function clamp(value, min, max) {

  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );
}


function average(values) {

  const valid =
    values.filter(
      Number.isFinite
    );

  if (!valid.length) {
    return 0;
  }

  return (
    valid.reduce(
      (sum, value) =>
        sum + value,
      0
    )
    /
    valid.length
  );
}


/* =========================================================
   READABLE ERRORS
========================================================= */

function errorMessage(value) {

  if (!value) {
    return "Unknown error.";
  }


  if (
    typeof value === "string"
  ) {

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
      value.message &&
      typeof value.message ===
      "object"
    ) {

      try {

        return JSON.stringify(
          value.message
        );

      } catch {}
    }


    if (
      typeof value.error ===
      "string"
    ) {

      return value.error;
    }


    try {

      return JSON.stringify(
        value
      );

    } catch {}
  }


  return String(value);
}


/* =========================================================
   REQUEST BODY
========================================================= */

function readBody(req) {

  if (
    req.body &&
    typeof req.body ===
    "object"
  ) {

    return req.body;
  }


  if (
    typeof req.body ===
    "string"
  ) {

    try {

      return JSON.parse(
        req.body
      );

    } catch {

      return {};
    }
  }


  return {};
}


/* =========================================================
   MARKET
========================================================= */

function getMarketSymbol(
  req,
  body
) {

  const symbol =
    body?.symbol ||
    req.query?.symbol ||
    "XAU/USD";


  if (
    !Object.prototype
      .hasOwnProperty
      .call(
        MARKETS,
        symbol
      )
  ) {

    throw new Error(
      "Unsupported market. Use XAU/USD or BTC/USD."
    );
  }


  return symbol;
}


/* =========================================================
   URL BUILDER
========================================================= */

function makeURL(
  path,
  params
) {

  const query =
    Object.entries(
      params
    )
    .map(
      ([key, value]) =>

        encodeURIComponent(
          key
        )
        +
        "="
        +
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
   FETCH JSON
========================================================= */

async function getJSON(url) {

  const controller =
    new AbortController();


  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      18000
    );


  try {

    const response =
      await fetch(
        url,
        {

          method: "GET",

          cache: "no-store",

          headers: {

            Accept:
              "application/json"

          },

          signal:
            controller.signal

        }
      );


    const raw =
      await response.text();


    let data;


    try {

      data =
        JSON.parse(
          raw
        );

    } catch {

      throw new Error(
        "Market data provider returned invalid JSON."
      );
    }


    if (
      !response.ok
    ) {

      throw new Error(
        errorMessage(
          data?.message ||
          data?.error ||
          `HTTP ${response.status}`
        )
      );
    }


    if (
      data?.status ===
      "error"
    ) {

      throw new Error(
        errorMessage(
          data?.message ||
          data
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
        "Market data request timed out."
      );
    }


    throw error;


  } finally {

    clearTimeout(
      timeout
    );
  }
}


/* =========================================================
   TWELVE DATA CANDLES
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

        timezone:
          "UTC",

        format:
          "JSON",

        apikey:
          API_KEY

      }
    );


  const data =
    await getJSON(
      url
    );


  if (
    !Array.isArray(
      data.values
    )
  ) {

    throw new Error(
      `${symbol} ${interval} candles were not returned.`
    );
  }


  const candles =
    data.values
      .map(
        candle => ({

          time:
            String(
              candle.datetime ||
              ""
            ),

          open:
            Number(
              candle.open
            ),

          high:
            Number(
              candle.high
            ),

          low:
            Number(
              candle.low
            ),

          close:
            Number(
              candle.close
            )

        })
      )
      .filter(
        candle =>

          Number.isFinite(
            candle.open
          )
          &&
          Number.isFinite(
            candle.high
          )
          &&
          Number.isFinite(
            candle.low
          )
          &&
          Number.isFinite(
            candle.close
          )
      )
      .reverse();


  if (
    candles.length <
    30
  ) {

    throw new Error(
      `Not enough ${interval} candles for ${symbol}.`
    );
  }


  return candles;
}


/* =========================================================
   LIVE PRICE
========================================================= */

async function getLivePrice(
  symbol
) {

  if (!API_KEY) {

    throw new Error(
      "TWELVE_DATA_API_KEY is missing in Vercel."
    );
  }


  const url =
    makeURL(
      "/price",
      {

        symbol,

        apikey:
          API_KEY

      }
    );


  const data =
    await getJSON(
      url
    );


  const price =
    Number(
      data.price
    );


  if (
    !Number.isFinite(
      price
    )
  ) {

    throw new Error(
      `Live ${symbol} price is unavailable.`
    );
  }


  return price;
}


/* =========================================================
   TIME PARSER
========================================================= */

function parseTime(
  value
) {

  let text =
    String(
      value ||
      ""
    )
    .trim()
    .replace(
      " ",
      "T"
    );


  if (
    !text.endsWith("Z")
    &&
    !/[+-]\d\d:\d\d$/.test(
      text
    )
  ) {

    text += "Z";
  }


  const result =
    Date.parse(
      text
    );


  return Number.isFinite(
    result
  )
    ? result
    : NaN;
}


/* =========================================================
   RESAMPLE
========================================================= */

function resample(
  candles,
  minutes
) {

  const size =
    minutes *
    60 *
    1000;


  const buckets =
    new Map();


  for (
    const candle
    of candles
  ) {

    const timestamp =
      parseTime(
        candle.time
      );


    if (
      !Number.isFinite(
        timestamp
      )
    ) {

      continue;
    }


    const bucketTime =
      Math.floor(
        timestamp /
        size
      )
      *
      size;


    const key =
      String(
        bucketTime
      );


    if (
      !buckets.has(
        key
      )
    ) {

      buckets.set(
        key,
        {

          time:
            new Date(
              bucketTime
            )
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
        buckets.get(
          key
        );


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
    ...buckets.values()
  ]
  .sort(
    (a, b) =>
      parseTime(
        a.time
      )
      -
      parseTime(
        b.time
      )
  );
}


/* =========================================================
   EMA
========================================================= */

function ema(
  values,
  period
) {

  if (!values.length) {
    return 0;
  }


  const multiplier =
    2 /
    (
      period +
      1
    );


  let current =
    values[0];


  for (
    let i = 1;
    i < values.length;
    i++
  ) {

    current =
      values[i] *
      multiplier
      +
      current *
      (
        1 -
        multiplier
      );
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


  const multiplier =
    2 /
    (
      period +
      1
    );


  const output =
    [
      values[0]
    ];


  for (
    let i = 1;
    i < values.length;
    i++
  ) {

    output.push(

      values[i] *
      multiplier
      +
      output[i - 1] *
      (
        1 -
        multiplier
      )

    );
  }


  return output;
}


/* =========================================================
   RSI
========================================================= */

function rsi(
  values,
  period = 14
) {

  if (
    values.length <=
    period
  ) {

    return 50;
  }


  let gains = 0;

  let losses = 0;


  for (
    let i =
      values.length -
      period;

    i <
      values.length;

    i++
  ) {

    const change =
      values[i] -
      values[i - 1];


    if (
      change >
      0
    ) {

      gains +=
        change;

    } else {

      losses +=
        Math.abs(
          change
        );
    }
  }


  if (
    losses === 0
  ) {

    return 100;
  }


  const avgGain =
    gains /
    period;


  const avgLoss =
    losses /
    period;


  const rs =
    avgGain /
    avgLoss;


  return (
    100 -
    100 /
    (
      1 +
      rs
    )
  );
}


/* =========================================================
   ATR
========================================================= */

function atr(
  candles,
  period = 14
) {

  if (
    candles.length <
    2
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


  return average(
    ranges.slice(
      -period
    )
  );
}


/* =========================================================
   MACD
========================================================= */

function macdHistogram(
  values
) {

  if (
    values.length <
    35
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


  const line =
    values.map(
      (_, index) =>
        fast[index] -
        slow[index]
    );


  const signal =
    emaSeries(
      line,
      9
    );


  return (
    line.at(-1) -
    signal.at(-1)
  );
}


/* =========================================================
   TIMEFRAME ANALYSIS
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


  const ema100 =
    ema(
      closes.slice(-220),
      100
    );


  const currentRSI =
    rsi(
      closes,
      14
    );


  const currentMACD =
    macdHistogram(
      closes
    );


  const currentATR =
    atr(
      candles,
      14
    )
    ||
    Math.max(
      latest.close *
      0.0005,
      0.01
    );


  const previous =
    candles.slice(
      -21,
      -1
    );


  const previousHigh =
    previous.length

      ? Math.max(
          ...previous.map(
            candle =>
              candle.high
          )
        )

      : latest.high;


  const previousLow =
    previous.length

      ? Math.min(
          ...previous.map(
            candle =>
              candle.low
          )
        )

      : latest.low;


  let score = 0;


  score +=
    latest.close >
    ema20

      ? 1
      : -1;


  score +=
    ema20 >
    ema50

      ? 1
      : -1;


  score +=
    ema50 >
    ema100

      ? 1
      : -1;


  if (
    currentRSI >
    53
  ) {

    score += 1;

  } else if (
    currentRSI <
    47
  ) {

    score -= 1;
  }


  if (
    currentMACD >
    0
  ) {

    score += 1;

  } else if (
    currentMACD <
    0
  ) {

    score -= 1;
  }


  if (
    latest.close >
    previousHigh
  ) {

    score += 1.5;
  }


  if (
    latest.close <
    previousLow
  ) {

    score -= 1.5;
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

    macd:
      currentMACD,

    atr:
      currentATR,

    ema20,

    ema50,

    close:
      latest.close

  };
}


/* =========================================================
   LIQUIDITY ANALYSIS
========================================================= */

function analyzeLiquidity(
  candles
) {

  if (
    candles.length <
    16
  ) {

    return {

      score:
        0,

      text:
        "No confirmed liquidity sweep."

    };
  }


  const latest =
    candles.at(-1);


  const previous =
    candles.slice(
      -16,
      -1
    );


  const previousHigh =
    Math.max(
      ...previous.map(
        candle =>
          candle.high
      )
    );


  const previousLow =
    Math.min(
      ...previous.map(
        candle =>
          candle.low
      )
    );


  if (
    latest.low <
    previousLow
    &&
    latest.close >
    previousLow
  ) {

    return {

      score:
        2,

      text:
        "Sell-side liquidity sweep detected with recovery."

    };
  }


  if (
    latest.high >
    previousHigh
    &&
    latest.close <
    previousHigh
  ) {

    return {

      score:
        -2,

      text:
        "Buy-side liquidity sweep detected with rejection."

    };
  }


  return {

    score:
      0,

    text:
      "Price remains inside the recent liquidity range."

  };
}


/* =========================================================
   MOMENTUM TRIGGER
========================================================= */

function analyzeMomentum(
  candles
) {

  if (
    candles.length <
    3
  ) {

    return {

      score:
        0,

      text:
        "No momentum trigger available."

    };
  }


  const latest =
    candles.at(-1);


  const previous =
    candles.at(-2);


  const range =
    Math.max(
      latest.high -
      latest.low,
      0.000001
    );


  const bodyStrength =
    Math.abs(
      latest.close -
      latest.open
    )
    /
    range;


  if (
    bodyStrength >
    0.60
    &&
    latest.close >
    latest.open
    &&
    latest.close >
    previous.high
  ) {

    return {

      score:
        1.5,

      text:
        "Bullish displacement candle confirmed."

    };
  }


  if (
    bodyStrength >
    0.60
    &&
    latest.close <
    latest.open
    &&
    latest.close <
    previous.low
  ) {

    return {

      score:
        -1.5,

      text:
        "Bearish displacement candle confirmed."

    };
  }


  return {

    score:
      0,

    text:
      "No strong displacement on the latest candle."

  };
}


/* =========================================================
   MARKET SESSION
========================================================= */

function marketSession(
  symbol
) {

  if (
    symbol ===
    "BTC/USD"
  ) {

    return "24/7 CRYPTO";
  }


  const sastHour =
    (
      new Date()
        .getUTCHours()
      +
      2
    )
    %
    24;


  if (
    sastHour >= 8
    &&
    sastHour < 11
  ) {

    return "LONDON OPEN";
  }


  if (
    sastHour >= 11
    &&
    sastHour < 14
  ) {

    return "LONDON";
  }


  if (
    sastHour >= 14
    &&
    sastHour < 18
  ) {

    return "LONDON / NEW YORK";
  }


  if (
    sastHour >= 18
    &&
    sastHour < 23
  ) {

    return "NEW YORK";
  }


  return "ASIA / TRANSITION";
}


/* =========================================================
   SIGNAL ENGINE
========================================================= */

function createSignal(
  symbol,
  m1,
  m5,
  m15,
  h1,
  price
) {

  const settings =
    MARKETS[symbol];


  const T = {

    M1:
      analyzeTimeframe(
        m1
      ),

    M5:
      analyzeTimeframe(
        m5
      ),

    M15:
      analyzeTimeframe(
        m15
      ),

    H1:
      analyzeTimeframe(
        h1
      )

  };


  const liquidity =
    analyzeLiquidity(
      m5
    );


  const momentum =
    analyzeMomentum(
      m1
    );


  const score =

      T.M1.score *
      0.75

    +

      T.M5.score *
      1.25

    +

      T.M15.score *
      1.70

    +

      T.H1.score *
      2.20

    +

      liquidity.score *
      1.20

    +

      momentum.score;


  const signal =
    score >= 0

      ? "BUY"

      : "SELL";


  const sign =
    signal === "BUY"

      ? 1

      : -1;


  const alignment =
    [
      T.M1,
      T.M5,
      T.M15,
      T.H1
    ]
    .filter(
      timeframe =>

        signal === "BUY"

          ? timeframe.score >
            0

          : timeframe.score <
            0
    )
    .length;


  let confidence =

      52

    +

      alignment *
      6

    +

      Math.min(
        20,
        Math.abs(
          score
        )
        *
        1.30
      );


  if (
    signal === "BUY"
    &&
    liquidity.score >
    0
  ) {

    confidence += 3;
  }


  if (
    signal === "SELL"
    &&
    liquidity.score <
    0
  ) {

    confidence += 3;
  }


  if (
    signal === "BUY"
    &&
    momentum.score >
    0
  ) {

    confidence += 3;
  }


  if (
    signal === "SELL"
    &&
    momentum.score <
    0
  ) {

    confidence += 3;
  }


  confidence =
    Math.round(
      clamp(
        confidence,
        55,
        94
      )
    );


  const volatility =
    Math.max(
      T.M5.atr,
      price *
      settings.minStopPercent
    );


  let stopDistance =
    Math.max(

      volatility *
      settings.atrMultiplier,

      price *
      settings.minStopPercent

    );


  const recent =
    m5.slice(
      -20
    );


  const recentHigh =
    Math.max(
      ...recent.map(
        candle =>
          candle.high
      )
    );


  const recentLow =
    Math.min(
      ...recent.map(
        candle =>
          candle.low
      )
    );


  if (
    signal === "BUY"
    &&
    recentLow <
    price
  ) {

    stopDistance =
      Math.max(

        stopDistance,

        price -
        recentLow
        +
        volatility *
        0.10

      );
  }


  if (
    signal === "SELL"
    &&
    recentHigh >
    price
  ) {

    stopDistance =
      Math.max(

        stopDistance,

        recentHigh -
        price
        +
        volatility *
        0.10

      );
  }


  stopDistance =
    Math.min(

      stopDistance,

      volatility *
      2.60

    );


  const entry =
    price;


  const stopLoss =
    entry -
    sign *
    stopDistance;


  const takeProfit =
    entry +
    sign *
    stopDistance *
    2;


  const takeProfit2 =
    entry +
    sign *
    stopDistance *
    3;


  const reasons = [

    `${signal} selected from weighted M1, M5, M15 and H1 alignment.`,

    `H1 ${T.H1.bias}, M15 ${T.M15.bias}, M5 ${T.M5.bias}.`,

    `M5 RSI ${round(
      T.M5.rsi,
      1
    )} · MACD ${round(
      T.M5.macd,
      4
    )}.`,

    liquidity.text,

    momentum.text,

    "Stop loss is calculated from volatility and recent market structure.",

    "Primary take profit uses a 1:2 risk-to-reward target."

  ];


  return {

    signal,

    confidence,

    entry,

    stopLoss,

    takeProfit,

    takeProfit2,

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

    indicators: {

      m1Rsi:
        round(
          T.M1.rsi,
          1
        ),

      m5Rsi:
        round(
          T.M5.rsi,
          1
        ),

      m15Rsi:
        round(
          T.M15.rsi,
          1
        ),

      h1Rsi:
        round(
          T.H1.rsi,
          1
        ),

      m5Atr:
        round(
          T.M5.atr,
          settings.decimals
        ),

      m5Macd:
        round(
          T.M5.macd,
          4
        )

    },

    reasons

  };
}


/* =========================================================
   VERCEL HANDLER
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
        "TWELVE_DATA_API_KEY is missing in Vercel Environment Variables."
      );
    }


    const body =
      readBody(
        req
      );


    const symbol =
      getMarketSymbol(
        req,
        body
      );


    const market =
      MARKETS[symbol];


    /* =====================================================
       PRICE MODE
    ===================================================== */

    if (
      req.method === "GET"
      &&
      String(
        req.query?.mode ||
        ""
      )
      .toLowerCase()
      ===
      "price"
    ) {

      const price =
        await getLivePrice(
          symbol
        );


      return res
        .status(200)
        .json({

          success:
            true,

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
       ONLY GET/POST
    ===================================================== */

    if (
      req.method !== "GET"
      &&
      req.method !== "POST"
    ) {

      return res
        .status(405)
        .json({

          success:
            false,

          error:
            "Method not allowed."

        });
    }


    const equityZAR =
      clamp(

        numeric(
          body.equityZAR,
          200
        ),

        1,

        100000000

      );


    const riskPercent =
      clamp(

        numeric(
          body.riskPercent,
          0.5
        ),

        0.1,

        5

      );


    /* =====================================================
       ONLY TWO DATA REQUESTS FOR FULL ANALYSIS
    ===================================================== */

    const [
      m1,
      h1
    ] =
      await Promise.all([

        getCandles(
          symbol,
          "1min",
          600
        ),

        getCandles(
          symbol,
          "1h",
          220
        )

      ]);


    const m5 =
      resample(
        m1,
        5
      );


    const m15 =
      resample(
        m1,
        15
      );


    if (
      m5.length <
      25
    ) {

      throw new Error(
        "Not enough data to construct M5 candles."
      );
    }


    if (
      m15.length <
      15
    ) {

      throw new Error(
        "Not enough data to construct M15 candles."
      );
    }


    const latestPrice =
      m1.at(-1)
        .close;


    const analysis =
      createSignal(

        symbol,

        m1,

        m5,

        m15,

        h1,

        latestPrice

      );


    return res
      .status(200)
      .json({

        success:
          true,

        model:
          "MKAYFX DUAL SCANNER V2",

        symbol,

        marketName:
          market.name,

        signalId:

          "MK-"
          +
          Date.now()
          +
          "-"
          +
          symbol.replace(
            "/",
            ""
          )
          +
          "-"
          +
          analysis.signal,

        signal:
          analysis.signal,

        confidence:
          analysis.confidence,

        setupStrength:
          analysis.confidence,

        timeframe:
          "H1",

        session:
          marketSession(
            symbol
          ),

        createdAt:
          new Date()
            .toISOString(),

        locked:
          true,

        entry:
          round(
            analysis.entry,
            market.decimals
          ),

        stopLoss:
          round(
            analysis.stopLoss,
            market.decimals
          ),

        takeProfit:
          round(
            analysis.takeProfit,
            market.decimals
          ),

        takeProfit2:
          round(
            analysis.takeProfit2,
            market.decimals
          ),

        currentPrice:
          round(
            latestPrice,
            market.decimals
          ),

        riskReward:
          2,

        riskReward2:
          3,

        timeframeBias:
          analysis.timeframeBias,

        indicators:
          analysis.indicators,

        reasons:
          analysis.reasons,

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
              equityZAR *
              riskPercent /
              100,
              2
            )

        },

        chart:

          m1
          .slice(
            -90
          )
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

        lifecycle: {

          state:
            "TRADE_ACTIVE",

          rule:
            "Keep signal locked until TP or SL.",

          nextAnalysis:
            "Automatically create a new signal after TP or SL."

        }

      });


  } catch (error) {

    console.error(
      "MKAYFX API ERROR:",
      error
    );


    return res
      .status(500)
      .json({

        success:
          false,

        error:
          errorMessage(
            error
          )

      });
  }
}