/* =========================================================
   MKAYFX DUAL MARKET SCANNER V1
   XAU/USD + BTC/USD
   FILE: api/analysis.js

   ENV:
   TWELVE_DATA_API_KEY
========================================================= */

const API_KEY = process.env.TWELVE_DATA_API_KEY;
const BASE_URL = "https://api.twelvedata.com";

const MARKETS = {

  "XAU/USD": {
    name: "Gold · Spot",
    decimals: 2,
    atrStop: 1.10,
    minimumStopPercent: 0.0010
  },

  "BTC/USD": {
    name: "Bitcoin · USD",
    decimals: 2,
    atrStop: 1.25,
    minimumStopPercent: 0.0018
  }

};


/* =========================================================
   HELPERS
========================================================= */

function number(value, fallback = null) {

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


function parseBody(req) {

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

      return JSON.parse(
        req.body
      );

    } catch {

      return {};
    }
  }

  return {};
}


function getSymbol(req, body = {}) {

  const requested =
    body.symbol ||
    req.query?.symbol ||
    "XAU/USD";

  if (!MARKETS[requested]) {

    throw new Error(
      "Unsupported symbol. Use XAU/USD or BTC/USD."
    );
  }

  return requested;
}


/* =========================================================
   TWELVE DATA URL
========================================================= */

function buildURL(path, params) {

  const query =
    Object.entries(params)
      .map(
        ([key, value]) =>

          encodeURIComponent(key)
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
   FETCH
========================================================= */

async function fetchJSON(url) {

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

          headers: {
            Accept:
              "application/json"
          },

          cache:
            "no-store",

          signal:
            controller.signal
        }
      );


    const text =
      await response.text();


    let data;

    try {

      data =
        JSON.parse(
          text
        );

    } catch {

      throw new Error(
        "Market provider returned invalid data."
      );
    }


    if (
      !response.ok ||
      data?.status === "error"
    ) {

      throw new Error(
        data?.message ||
        `Market request failed (${response.status}).`
      );
    }


    return data;

  } finally {

    clearTimeout(
      timeout
    );
  }
}


/* =========================================================
   CANDLES
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
    buildURL(
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
    await fetchJSON(
      url
    );


  if (
    !Array.isArray(
      data.values
    )
  ) {

    throw new Error(
      `${symbol} ${interval} candles unavailable.`
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

async function getLivePrice(symbol) {

  if (!API_KEY) {

    throw new Error(
      "TWELVE_DATA_API_KEY is missing in Vercel."
    );
  }


  const url =
    buildURL(
      "/price",
      {

        symbol,

        apikey:
          API_KEY
      }
    );


  const data =
    await fetchJSON(
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
      `Live ${symbol} price unavailable.`
    );
  }


  return price;
}


/* =========================================================
   DATE PARSER
========================================================= */

function parseTime(value) {

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


  const timestamp =
    Date.parse(
      text
    );


  return Number.isFinite(
    timestamp
  )
    ? timestamp
    : NaN;
}


/* =========================================================
   RESAMPLE M1
========================================================= */

function resample(
  candles,
  minutes
) {

  const bucketSize =
    minutes *
    60 *
    1000;


  const map =
    new Map();


  for (
    const candle
    of candles
  ) {

    const time =
      parseTime(
        candle.time
      );


    if (
      !Number.isFinite(
        time
      )
    ) {
      continue;
    }


    const bucket =
      Math.floor(
        time /
        bucketSize
      )
      *
      bucketSize;


    const key =
      String(
        bucket
      );


    if (
      !map.has(
        key
      )
    ) {

      map.set(
        key,
        {

          time:
            new Date(
              bucket
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

      const existing =
        map.get(
          key
        );


      existing.high =
        Math.max(
          existing.high,
          candle.high
        );


      existing.low =
        Math.min(
          existing.low,
          candle.low
        );


      existing.close =
        candle.close;
    }
  }


  return [
    ...map.values()
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


  let result =
    values[0];


  for (
    let i = 1;
    i < values.length;
    i++
  ) {

    result =
      values[i] *
      multiplier
      +
      result *
      (
        1 -
        multiplier
      );
  }


  return result;
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


  const rs =
    (
      gains /
      period
    )
    /
    (
      losses /
      period
    );


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


  const macd =
    values.map(
      (
        _,
        index
      ) =>

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
      0.001,
      1
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


  if (
    latest.close >
    ema20
  ) {

    score += 1;

  } else {

    score -= 1;
  }


  if (
    ema20 >
    ema50
  ) {

    score += 1;

  } else {

    score -= 1;
  }


  if (
    ema50 >
    ema100
  ) {

    score += 1;

  } else {

    score -= 1;
  }


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
   LIQUIDITY
========================================================= */

function liquidityAnalysis(
  candles
) {

  if (
    candles.length <
    16
  ) {

    return {

      score: 0,

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


  const recentHigh =
    Math.max(
      ...previous.map(
        candle =>
          candle.high
      )
    );


  const recentLow =
    Math.min(
      ...previous.map(
        candle =>
          candle.low
      )
    );


  if (
    latest.low <
    recentLow
    &&
    latest.close >
    recentLow
  ) {

    return {

      score: 2,

      text:
        "Sell-side liquidity was swept and price recovered."
    };
  }


  if (
    latest.high >
    recentHigh
    &&
    latest.close <
    recentHigh
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
   ENTRY TRIGGER
========================================================= */

function momentumTrigger(
  candles
) {

  if (
    candles.length <
    3
  ) {

    return {

      score: 0,

      text:
        "No strong displacement trigger."
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


  const body =
    Math.abs(
      latest.close -
      latest.open
    )
    /
    range;


  if (
    body >
    0.60
    &&
    latest.close >
    latest.open
    &&
    latest.close >
    previous.high
  ) {

    return {

      score: 1.5,

      text:
        "Bullish displacement candle confirmed."
    };
  }


  if (
    body >
    0.60
    &&
    latest.close <
    latest.open
    &&
    latest.close <
    previous.low
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
      "No strong displacement on the latest candle."
  };
}


/* =========================================================
   SESSION
========================================================= */

function getSession(symbol) {

  if (
    symbol ===
    "BTC/USD"
  ) {

    return "24/7 CRYPTO";
  }


  const hour =
    (
      new Date()
        .getUTCHours()
      +
      2
    )
    %
    24;


  if (
    hour >= 8 &&
    hour < 11
  ) {

    return "LONDON OPEN";
  }


  if (
    hour >= 11 &&
    hour < 14
  ) {

    return "LONDON";
  }


  if (
    hour >= 14 &&
    hour < 18
  ) {

    return "LONDON / NEW YORK";
  }


  if (
    hour >= 18 &&
    hour < 23
  ) {

    return "NEW YORK";
  }


  return "ASIA / TRANSITION";
}


/* =========================================================
   SIGNAL ENGINE
========================================================= */

function buildSignal(
  symbol,
  m1,
  m5,
  m15,
  h1,
  price
) {

  const market =
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
    liquidityAnalysis(
      m5
    );


  const trigger =
    momentumTrigger(
      m1
    );


  const weightedScore =

      T.M1.score *
      0.75

    +

      T.M5.score *
      1.30

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

      trigger.score;


  const signal =
    weightedScore >= 0

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
    agreement *
    6
    +
    Math.min(
      20,
      Math.abs(
        weightedScore
      )
      *
      1.3
    );


  if (
    (
      signal === "BUY"
      &&
      liquidity.score >
      0
    )
    ||
    (
      signal === "SELL"
      &&
      liquidity.score <
      0
    )
  ) {

    confidence += 3;
  }


  if (
    (
      signal === "BUY"
      &&
      trigger.score >
      0
    )
    ||
    (
      signal === "SELL"
      &&
      trigger.score <
      0
    )
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
    T.M5.atr;


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


  let stopDistance =
    Math.max(

      volatility *
      market.atrStop,

      price *
      market.minimumStopPercent
    );


  if (
    signal === "BUY"
    &&
    recentLow <
    price
  ) {

    const structureDistance =
      price -
      recentLow
      +
      volatility *
      0.10;


    stopDistance =
      Math.max(
        stopDistance,
        structureDistance
      );
  }


  if (
    signal === "SELL"
    &&
    recentHigh >
    price
  ) {

    const structureDistance =
      recentHigh -
      price
      +
      volatility *
      0.10;


    stopDistance =
      Math.max(
        stopDistance,
        structureDistance
      );
  }


  stopDistance =
    Math.min(
      stopDistance,
      volatility *
      2.6
    );


  const entry =
    price;


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


  const reasons = [

    `${signal} selected from weighted M1, M5, M15 and H1 alignment.`,

    `H1 is ${T.H1.bias}, M15 is ${T.M15.bias}, and M5 is ${T.M5.bias}.`,

    `M5 RSI is ${round(
      T.M5.rsi,
      1
    )} with MACD momentum ${round(
      T.M5.macd,
      3
    )}.`,

    liquidity.text,

    trigger.text,

    "Stop loss is based on current volatility and recent structure.",

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
          market.decimals
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
      parseBody(
        req
      );


    const symbol =
      getSymbol(
        req,
        body
      );


    const market =
      MARKETS[symbol];


    /* =====================================================
       LIVE PRICE
    ===================================================== */

    if (
      req.method === "GET"
      &&
      String(
        req.query?.mode ||
        ""
      )
      === "price"
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
       ANALYSIS
    ===================================================== */

    if (
      req.method !== "POST"
      &&
      req.method !== "GET"
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


    const equity =
      clamp(

        number(
          body.equityZAR,
          200
        ),

        1,

        100000000
      );


    const riskPercent =
      clamp(

        number(
          body.riskPercent,
          0.5
        ),

        0.1,

        5
      );


    /*
       TWO DATA REQUESTS:
       1. M1
       2. H1

       M5 + M15 are built locally.
    */

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
      30
      ||
      m15.length <
      20
    ) {

      throw new Error(
        "Not enough candles to build multi-timeframe analysis."
      );
    }


    /*
       Latest completed M1 close becomes
       the initial scanner entry price.
    */

    const price =
      m1.at(-1)
        .close;


    const analysis =
      buildSignal(
        symbol,
        m1,
        m5,
        m15,
        h1,
        price
      );


    return res
      .status(200)
      .json({

        success:
          true,

        model:
          "MKAYFX DUAL SCANNER V1",

        symbol,

        marketName:
          market.name,

        signalId:
          `MK-${Date.now()}-${symbol.replace("/", "")}-${analysis.signal}`,

        signal:
          analysis.signal,

        confidence:
          analysis.confidence,

        setupStrength:
          analysis.confidence,

        timeframe:
          "H1",

        session:
          getSession(
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
            price,
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
            "Automatically scan again after TP or SL."
        }
      });


  } catch (error) {

    console.error(
      "MKAYFX ERROR:",
      error
    );


    return res
      .status(500)
      .json({

        success:
          false,

        error:
          error?.message ||
          String(
            error
          )
      });
  }
}