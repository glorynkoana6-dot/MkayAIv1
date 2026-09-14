/* ============================================================
   MKAYFX EXTREME AI - GEMINI VERSION
   api/analyze.js

   FEATURES
   ------------------------------------------------------------
   - Accepts BOTH GET and POST
   - Twelve Data live M5 candles
   - Only 1 Twelve Data request per refresh
   - Builds M15 locally
   - Builds H1 locally
   - 55 second candle cache
   - EMA 20 / 50
   - RSI 14
   - ATR 14
   - MACD
   - Market structure
   - Momentum
   - Liquidity ranges
   - Gemini 3.8 Flash
   - HIGH AI reasoning
   - Optional Google Search news grounding
   - Structured JSON output
   - Local fallback if Gemini fails
   - Server-side trade validation
============================================================ */


/* ============================================================
   CONFIG
============================================================ */

const TWELVE_DATA_API_KEY =
  process.env.TWELVE_DATA_API_KEY;

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY;

const GEMINI_MODEL =
  process.env.GEMINI_MODEL ||
  "gemini-3.8-flash";

const USE_WEB_NEWS =
  String(
    process.env.USE_WEB_NEWS ||
    "false"
  ).toLowerCase() === "true";


const TWELVE_URL =
  "https://api.twelvedata.com/time_series";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/interactions";


const CACHE_MS =
  55_000;

const OUTPUT_SIZE =
  1000;


/* ============================================================
   SYMBOLS
============================================================ */

const ALLOWED_SYMBOLS =
  new Set([
    "XAU/USD",
    "EUR/USD",
    "GBP/USD",
    "USD/JPY",
    "BTC/USD",
    "XBR/USD"
  ]);


/* ============================================================
   MEMORY CACHE
============================================================ */

const marketCache =
  new Map();

const inFlight =
  new Map();


/* ============================================================
   RESPONSE
============================================================ */

function send(
  res,
  status,
  data
) {

  return res
    .status(status)
    .json(data);

}


/* ============================================================
   NUMBER HELPERS
============================================================ */

function clamp(
  value,
  min,
  max
) {

  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );

}


function round(
  value,
  digits = 2
) {

  const n =
    Number(value);

  if(
    !Number.isFinite(n)
  ) {

    return null;

  }

  return Number(
    n.toFixed(digits)
  );

}


function priceDigits(
  symbol
) {

  if(
    symbol === "EUR/USD" ||
    symbol === "GBP/USD"
  ) {

    return 5;

  }

  if(
    symbol === "USD/JPY"
  ) {

    return 3;

  }

  return 2;

}


function priceRound(
  symbol,
  value
) {

  return round(
    value,
    priceDigits(symbol)
  );

}


/* ============================================================
   TIME PARSER
============================================================ */

function parseUTC(
  datetime
) {

  const clean =
    String(
      datetime ||
      ""
    )
    .trim()
    .replace(
      " ",
      "T"
    );


  const finalValue =
    /Z$|[+-]\d\d:\d\d$/
      .test(clean)
      ?
      clean
      :
      `${clean}Z`;


  return new Date(
    finalValue
  ).getTime();

}


/* ============================================================
   REQUEST BODY
============================================================ */

function getRequestBody(
  req
) {

  if(
    !req.body
  ) {

    return {};

  }


  if(
    typeof req.body ===
    "object"
  ) {

    return req.body;

  }


  try {

    return JSON.parse(
      req.body
    );

  }
  catch {

    return {};

  }

}


/* ============================================================
   TWELVE DATA
============================================================ */

async function requestM5(
  symbol
) {

  if(
    !TWELVE_DATA_API_KEY
  ) {

    throw new Error(
      "TWELVE_DATA_API_KEY is missing in Vercel."
    );

  }


  const params =
    new URLSearchParams({

      symbol,

      interval:
        "5min",

      outputsize:
        String(
          OUTPUT_SIZE
        ),

      timezone:
        "UTC",

      format:
        "JSON",

      apikey:
        TWELVE_DATA_API_KEY

    });


  const response =
    await fetch(
      `${TWELVE_URL}?${params.toString()}`
    );


  const data =
    await response.json();


  if(
    !response.ok ||
    data.status ===
      "error" ||
    !Array.isArray(
      data.values
    )
  ) {

    throw new Error(
      data.message ||
      "Twelve Data request failed."
    );

  }


  const candles =
    data.values

      .map(
        item => ({

          t:
            item.datetime,

          o:
            Number(
              item.open
            ),

          h:
            Number(
              item.high
            ),

          l:
            Number(
              item.low
            ),

          c:
            Number(
              item.close
            ),

          v:
            Number(
              item.volume ||
              0
            )

        })
      )

      .filter(
        candle =>
          [
            candle.o,
            candle.h,
            candle.l,
            candle.c
          ]
          .every(
            Number.isFinite
          )
      )

      .reverse();


  if(
    candles.length <
    120
  ) {

    throw new Error(
      "Not enough market candles returned."
    );

  }


  return candles;

}


/* ============================================================
   CACHED MARKET DATA
============================================================ */

async function getM5Cached(
  symbol
) {

  const key =
    symbol.toUpperCase();


  const now =
    Date.now();


  const cached =
    marketCache.get(
      key
    );


  if(
    cached &&
    now -
    cached.time <
    CACHE_MS
  ) {

    return {

      candles:
        cached.candles,

      cacheHit:
        true

    };

  }


  if(
    inFlight.has(key)
  ) {

    const candles =
      await inFlight.get(
        key
      );


    return {

      candles,

      cacheHit:
        true

    };

  }


  const pending =
    requestM5(key)

      .then(
        candles => {

          marketCache.set(
            key,
            {

              time:
                Date.now(),

              candles

            }
          );


          return candles;

        }
      )

      .finally(
        () =>
          inFlight.delete(
            key
          )
      );


  inFlight.set(
    key,
    pending
  );


  const candles =
    await pending;


  return {

    candles,

    cacheHit:
      false

  };

}


/* ============================================================
   REMOVE CURRENT INCOMPLETE M5
============================================================ */

function completedCandles(
  candles
) {

  if(
    candles.length <
    3
  ) {

    return candles;

  }


  return candles.slice(
    0,
    -1
  );

}


/* ============================================================
   RESAMPLE
============================================================ */

function resample(
  candles,
  minutes
) {

  const bucketMS =
    minutes *
    60_000;


  const buckets =
    new Map();


  for(
    const candle
    of candles
  ) {

    const time =
      parseUTC(
        candle.t
      );


    if(
      !Number.isFinite(time)
    ) {

      continue;

    }


    const bucket =
      Math.floor(
        time /
        bucketMS
      ) *
      bucketMS;


    if(
      !buckets.has(
        bucket
      )
    ) {

      buckets.set(
        bucket,
        []
      );

    }


    buckets
      .get(bucket)
      .push(candle);

  }


  const output =
    [];


  for(
    const [
      timestamp,
      group
    ]
    of buckets
  ) {

    group.sort(
      (a,b) =>
        parseUTC(a.t) -
        parseUTC(b.t)
    );


    const first =
      group[0];


    const last =
      group[
        group.length -
        1
      ];


    output.push({

      t:
        new Date(
          timestamp
        )
        .toISOString(),

      o:
        first.o,

      h:
        Math.max(
          ...group.map(
            x => x.h
          )
        ),

      l:
        Math.min(
          ...group.map(
            x => x.l
          )
        ),

      c:
        last.c,

      v:
        group.reduce(
          (
            total,
            item
          ) =>
            total +
            (
              item.v ||
              0
            ),
          0
        )

    });

  }


  return output.sort(
    (a,b) =>
      parseUTC(a.t) -
      parseUTC(b.t)
  );

}


/* ============================================================
   SMA
============================================================ */

function sma(
  values,
  period
) {

  if(
    values.length <
    period
  ) {

    return null;

  }


  const recent =
    values.slice(
      -period
    );


  return recent.reduce(
    (
      total,
      value
    ) =>
      total +
      value,
    0
  ) /
  period;

}


/* ============================================================
   EMA SERIES
============================================================ */

function emaSeries(
  values,
  period
) {

  if(
    values.length <
    period
  ) {

    return [];

  }


  const multiplier =
    2 /
    (
      period +
      1
    );


  const seed =
    values
      .slice(
        0,
        period
      )
      .reduce(
        (
          total,
          value
        ) =>
          total +
          value,
        0
      ) /
    period;


  const output =
    Array(
      period -
      1
    )
    .fill(null);


  let current =
    seed;


  output.push(
    current
  );


  for(
    let i =
      period;

    i <
    values.length;

    i++
  ) {

    current =
      (
        values[i] -
        current
      ) *
      multiplier +
      current;


    output.push(
      current
    );

  }


  return output;

}


/* ============================================================
   EMA VALUE
============================================================ */

function ema(
  values,
  period
) {

  const series =
    emaSeries(
      values,
      period
    );


  if(
    !series.length
  ) {

    return null;

  }


  return series[
    series.length -
    1
  ];

}


/* ============================================================
   RSI
============================================================ */

function rsi(
  closes,
  period = 14
) {

  if(
    closes.length <=
    period
  ) {

    return null;

  }


  let gains =
    0;

  let losses =
    0;


  for(
    let i =
      closes.length -
      period;

    i <
    closes.length;

    i++
  ) {

    const change =
      closes[i] -
      closes[i - 1];


    if(
      change >
      0
    ) {

      gains +=
        change;

    }
    else {

      losses +=
        Math.abs(
          change
        );

    }

  }


  const avgGain =
    gains /
    period;


  const avgLoss =
    losses /
    period;


  if(
    avgLoss ===
    0
  ) {

    return 100;

  }


  const rs =
    avgGain /
    avgLoss;


  return (
    100 -
    (
      100 /
      (
        1 +
        rs
      )
    )
  );

}


/* ============================================================
   ATR
============================================================ */

function atr(
  candles,
  period = 14
) {

  if(
    candles.length <=
    period
  ) {

    return null;

  }


  const trueRanges =
    [];


  for(
    let i = 1;

    i <
    candles.length;

    i++
  ) {

    const current =
      candles[i];


    const previous =
      candles[i - 1];


    const range =
      Math.max(

        current.h -
        current.l,

        Math.abs(
          current.h -
          previous.c
        ),

        Math.abs(
          current.l -
          previous.c
        )

      );


    trueRanges.push(
      range
    );

  }


  return sma(
    trueRanges,
    period
  );

}


/* ============================================================
   MACD
============================================================ */

function macd(
  closes
) {

  const fast =
    emaSeries(
      closes,
      12
    );


  const slow =
    emaSeries(
      closes,
      26
    );


  const values =
    [];


  for(
    let i = 0;

    i <
    closes.length;

    i++
  ) {

    if(
      fast[i] ===
        null ||
      fast[i] ===
        undefined ||
      slow[i] ===
        null ||
      slow[i] ===
        undefined
    ) {

      continue;

    }


    values.push(
      fast[i] -
      slow[i]
    );

  }


  if(
    values.length <
    9
  ) {

    return {

      line:
        null,

      signal:
        null,

      histogram:
        null

    };

  }


  const line =
    values[
      values.length -
      1
    ];


  const signal =
    ema(
      values,
      9
    );


  return {

    line,

    signal,

    histogram:
      line -
      signal

  };

}


/* ============================================================
   MARKET STRUCTURE
============================================================ */

function structure(
  candles
) {

  if(
    candles.length <
    20
  ) {

    return "UNKNOWN";

  }


  const recent =
    candles.slice(
      -20
    );


  const first =
    recent.slice(
      0,
      10
    );


  const second =
    recent.slice(
      10
    );


  const high1 =
    Math.max(
      ...first.map(
        x => x.h
      )
    );


  const low1 =
    Math.min(
      ...first.map(
        x => x.l
      )
    );


  const high2 =
    Math.max(
      ...second.map(
        x => x.h
      )
    );


  const low2 =
    Math.min(
      ...second.map(
        x => x.l
      )
    );


  if(
    high2 >
      high1 &&
    low2 >
      low1
  ) {

    return (
      "HIGHER HIGHS / HIGHER LOWS"
    );

  }


  if(
    high2 <
      high1 &&
    low2 <
      low1
  ) {

    return (
      "LOWER HIGHS / LOWER LOWS"
    );

  }


  if(
    high2 >
      high1 &&
    low2 <
      low1
  ) {

    return (
      "EXPANDING VOLATILITY"
    );

  }


  return (
    "RANGING / MIXED"
  );

}


/* ============================================================
   MOMENTUM
============================================================ */

function momentum(
  candles
) {

  const recent =
    candles.slice(
      -6
    );


  if(
    recent.length <
    4
  ) {

    return "MIXED";

  }


  let bull =
    0;

  let bear =
    0;


  for(
    const candle
    of recent
  ) {

    const body =
      Math.abs(
        candle.c -
        candle.o
      );


    const range =
      Math.max(
        candle.h -
        candle.l,
        0.0000001
      );


    const strength =
      body /
      range;


    if(
      candle.c >
      candle.o
    ) {

      bull +=
        strength;

    }


    if(
      candle.c <
      candle.o
    ) {

      bear +=
        strength;

    }

  }


  if(
    bull >
    bear *
    1.25
  ) {

    return "BULLISH";

  }


  if(
    bear >
    bull *
    1.25
  ) {

    return "BEARISH";

  }


  return "MIXED";

}


/* ============================================================
   TREND BIAS
============================================================ */

function trendBias(
  closes
) {

  const price =
    closes[
      closes.length -
      1
    ];


  const e20 =
    ema(
      closes,
      20
    );


  const e50 =
    ema(
      closes,
      50
    );


  if(
    e20 === null ||
    e50 === null
  ) {

    return "NEUTRAL";

  }


  if(
    price >
      e20 &&
    e20 >
      e50
  ) {

    return "BULLISH";

  }


  if(
    price <
      e20 &&
    e20 <
      e50
  ) {

    return "BEARISH";

  }


  return "NEUTRAL";

}


/* ============================================================
   RECENT RANGE
============================================================ */

function recentRange(
  candles,
  bars = 20
) {

  const recent =
    candles.slice(
      -bars
    );


  return {

    high:
      Math.max(
        ...recent.map(
          x => x.h
        )
      ),

    low:
      Math.min(
        ...recent.map(
          x => x.l
        )
      )

  };

}


/* ============================================================
   TIMEFRAME SNAPSHOT
============================================================ */

function snapshot(
  symbol,
  candles
) {

  const closes =
    candles.map(
      x => x.c
    );


  const e20 =
    ema(
      closes,
      20
    );


  const e50 =
    ema(
      closes,
      50
    );


  const rsi14 =
    rsi(
      closes,
      14
    );


  const atr14 =
    atr(
      candles,
      14
    );


  const macdData =
    macd(
      closes
    );


  const range =
    recentRange(
      candles,
      20
    );


  return {

    price:
      priceRound(
        symbol,
        closes[
          closes.length -
          1
        ]
      ),

    bias:
      trendBias(
        closes
      ),

    structure:
      structure(
        candles
      ),

    momentum:
      momentum(
        candles
      ),

    indicators: {

      ema20:
        priceRound(
          symbol,
          e20
        ),

      ema50:
        priceRound(
          symbol,
          e50
        ),

      rsi14:
        round(
          rsi14,
          1
        ),

      atr14:
        priceRound(
          symbol,
          atr14
        ),

      macd:
        round(
          macdData.line,
          6
        ),

      macdSignal:
        round(
          macdData.signal,
          6
        ),

      macdHistogram:
        round(
          macdData.histogram,
          6
        )

    },

    liquidity: {

      recentHigh:
        priceRound(
          symbol,
          range.high
        ),

      recentLow:
        priceRound(
          symbol,
          range.low
        )

    },

    candles:
      candles
        .slice(
          -20
        )
        .map(
          x => ({

            t:
              x.t,

            o:
              priceRound(
                symbol,
                x.o
              ),

            h:
              priceRound(
                symbol,
                x.h
              ),

            l:
              priceRound(
                symbol,
                x.l
              ),

            c:
              priceRound(
                symbol,
                x.c
              )

          })
        )

  };

}


/* ============================================================
   SESSION
============================================================ */

function currentSession() {

  const hour =
    new Date()
      .getUTCHours();


  if(
    hour >= 0 &&
    hour < 7
  ) {

    return "ASIA";

  }


  if(
    hour >= 7 &&
    hour < 12
  ) {

    return "LONDON";

  }


  if(
    hour >= 12 &&
    hour < 16
  ) {

    return (
      "LONDON / NEW YORK OVERLAP"
    );

  }


  if(
    hour >= 16 &&
    hour < 21
  ) {

    return "NEW YORK";

  }


  return "TRANSITION";

}


/* ============================================================
   LOCAL FALLBACK ANALYSIS
============================================================ */

function localAnalysis(
  symbol,
  price,
  m5,
  m15,
  h1
) {

  let buyScore =
    0;

  let sellScore =
    0;


  /* H1 */

  if(
    h1.bias ===
    "BULLISH"
  ) {

    buyScore +=
      30;

  }


  if(
    h1.bias ===
    "BEARISH"
  ) {

    sellScore +=
      30;

  }


  /* M15 */

  if(
    m15.bias ===
    "BULLISH"
  ) {

    buyScore +=
      22;

  }


  if(
    m15.bias ===
    "BEARISH"
  ) {

    sellScore +=
      22;

  }


  /* M5 */

  if(
    m5.bias ===
    "BULLISH"
  ) {

    buyScore +=
      12;

  }


  if(
    m5.bias ===
    "BEARISH"
  ) {

    sellScore +=
      12;

  }


  /* MOMENTUM */

  if(
    m5.momentum ===
    "BULLISH"
  ) {

    buyScore +=
      10;

  }


  if(
    m5.momentum ===
    "BEARISH"
  ) {

    sellScore +=
      10;

  }


  /* MACD */

  if(
    Number(
      m5.indicators
        .macdHistogram
    ) >
    0
  ) {

    buyScore +=
      8;

  }


  if(
    Number(
      m5.indicators
        .macdHistogram
    ) <
    0
  ) {

    sellScore +=
      8;

  }


  let action =
    "WAIT";


  const difference =
    Math.abs(
      buyScore -
      sellScore
    );


  if(
    buyScore >=
      55 &&
    buyScore >
      sellScore &&
    difference >=
      20
  ) {

    action =
      "BUY";

  }


  if(
    sellScore >=
      55 &&
    sellScore >
      buyScore &&
    difference >=
      20
  ) {

    action =
      "SELL";

  }


  let confidence =
    action ===
      "WAIT"
      ?
      clamp(
        45 +
        Math.round(
          difference /
          3
        ),
        45,
        68
      )
      :
      clamp(
        60 +
        Math.round(
          difference /
          2
        ),
        60,
        88
      );


  const atrValue =
    Number(
      m5.indicators
        .atr14
    ) ||
    Math.abs(
      price *
      0.001
    );


  let entry =
    null;

  let stopLoss =
    null;

  let takeProfit1 =
    null;

  let takeProfit2 =
    null;

  let riskReward =
    "—";


  if(
    action ===
    "BUY"
  ) {

    entry =
      price;

    stopLoss =
      price -
      atrValue *
      1.25;


    const risk =
      entry -
      stopLoss;


    takeProfit1 =
      entry +
      risk *
      1.5;


    takeProfit2 =
      entry +
      risk *
      2.2;


    riskReward =
      "1:2.2";

  }


  if(
    action ===
    "SELL"
  ) {

    entry =
      price;

    stopLoss =
      price +
      atrValue *
      1.25;


    const risk =
      stopLoss -
      entry;


    takeProfit1 =
      entry -
      risk *
      1.5;


    takeProfit2 =
      entry -
      risk *
      2.2;


    riskReward =
      "1:2.2";

  }


  const setupGrade =
    action ===
      "WAIT"
      ?
      "WAIT"
      :
      confidence >=
        85
        ?
        "A"
        :
        confidence >=
          78
          ?
          "B+"
          :
          "B";


  return {

    action,

    confidence,

    setupGrade,

    summary:
      action ===
        "WAIT"
        ?
        `${symbol} does not currently have enough multi-timeframe alignment for a high-quality trade.`
        :
        `${action} setup detected using H1 direction, M15 confirmation and M5 timing.`,

    timeframeBias: {

      M5:
        m5.bias,

      M15:
        m15.bias,

      H1:
        h1.bias

    },

    regime:
      `${h1.bias} / ${h1.structure}`,

    structure:
      `H1 ${h1.structure}; M15 ${m15.structure}; M5 ${m5.structure}.`,

    momentum:
      m5.momentum,

    liquiditySummary:
      `M15 liquidity range: ${m15.liquidity.recentLow} to ${m15.liquidity.recentHigh}.`,

    macroBias:
      "UNKNOWN",

    entry:
      action ===
        "WAIT"
        ?
        null
        :
        priceRound(
          symbol,
          entry
        ),

    stopLoss:
      action ===
        "WAIT"
        ?
        null
        :
        priceRound(
          symbol,
          stopLoss
        ),

    takeProfit1:
      action ===
        "WAIT"
        ?
        null
        :
        priceRound(
          symbol,
          takeProfit1
        ),

    takeProfit2:
      action ===
        "WAIT"
        ?
        null
        :
        priceRound(
          symbol,
          takeProfit2
        ),

    riskReward,

    invalidation:
      action ===
        "BUY"
        ?
        `Bullish setup invalid below ${priceRound(symbol,stopLoss)}.`
        :
        action ===
          "SELL"
          ?
          `Bearish setup invalid above ${priceRound(symbol,stopLoss)}.`
          :
          "No active setup.",

    nextTrigger:
      action ===
        "WAIT"
        ?
        "Wait for H1 and M15 alignment with M5 confirmation."
        :
        `Monitor M5 structure for continued ${action === "BUY" ? "bullish" : "bearish"} confirmation.`,

    reasons: [

      `H1 bias: ${h1.bias}.`,

      `M15 bias: ${m15.bias}.`,

      `M5 bias: ${m5.bias}.`,

      `BUY score ${buyScore} vs SELL score ${sellScore}.`

    ],

    risks: [

      "Market conditions can change quickly.",

      "Spread, slippage and high-impact news may invalidate technical levels."

    ],

    newsSummary:
      "Gemini news analysis was unavailable; local technical fallback is active."

  };

}


/* ============================================================
   GEMINI JSON SCHEMA
============================================================ */

const ANALYSIS_SCHEMA = {

  type:
    "object",

  additionalProperties:
    false,

  properties: {

    action: {

      type:
        "string",

      enum: [
        "BUY",
        "SELL",
        "WAIT"
      ]

    },

    confidence: {

      type:
        "integer",

      minimum:
        0,

      maximum:
        99

    },

    setupGrade: {

      type:
        "string",

      enum: [
        "A+",
        "A",
        "B+",
        "B",
        "C",
        "WAIT"
      ]

    },

    summary: {
      type:"string"
    },

    timeframeBias: {

      type:
        "object",

      additionalProperties:
        false,

      properties: {

        M5: {
          type:"string",
          enum:[
            "BULLISH",
            "BEARISH",
            "NEUTRAL"
          ]
        },

        M15: {
          type:"string",
          enum:[
            "BULLISH",
            "BEARISH",
            "NEUTRAL"
          ]
        },

        H1: {
          type:"string",
          enum:[
            "BULLISH",
            "BEARISH",
            "NEUTRAL"
          ]
        }

      },

      required:[
        "M5",
        "M15",
        "H1"
      ]

    },

    regime:{
      type:"string"
    },

    structure:{
      type:"string"
    },

    momentum:{
      type:"string"
    },

    liquiditySummary:{
      type:"string"
    },

    macroBias:{
      type:"string"
    },

    entry:{
      type:[
        "number",
        "null"
      ]
    },

    stopLoss:{
      type:[
        "number",
        "null"
      ]
    },

    takeProfit1:{
      type:[
        "number",
        "null"
      ]
    },

    takeProfit2:{
      type:[
        "number",
        "null"
      ]
    },

    riskReward:{
      type:"string"
    },

    invalidation:{
      type:"string"
    },

    nextTrigger:{
      type:"string"
    },

    reasons:{

      type:"array",

      items:{
        type:"string"
      },

      minItems:3,

      maxItems:7

    },

    risks:{

      type:"array",

      items:{
        type:"string"
      },

      minItems:2,

      maxItems:6

    },

    newsSummary:{
      type:"string"
    }

  },

  required:[

    "action",
    "confidence",
    "setupGrade",
    "summary",
    "timeframeBias",
    "regime",
    "structure",
    "momentum",
    "liquiditySummary",
    "macroBias",
    "entry",
    "stopLoss",
    "takeProfit1",
    "takeProfit2",
    "riskReward",
    "invalidation",
    "nextTrigger",
    "reasons",
    "risks",
    "newsSummary"

  ]

};


/* ============================================================
   GEMINI TEXT EXTRACTION
============================================================ */

function extractGeminiText(
  data
) {

  const outputs =
    [];


  for(
    const step
    of data.steps ||
    []
  ) {

    if(
      step.type !==
      "model_output"
    ) {

      continue;

    }


    for(
      const block
      of step.content ||
      []
    ) {

      if(
        block.type ===
          "text" &&
        typeof block.text ===
          "string"
      ) {

        outputs.push(
          block.text
        );

      }

    }

  }


  return outputs
    .join("")
    .trim();

}


/* ============================================================
   GEMINI SOURCE EXTRACTION
============================================================ */

function extractGeminiSources(
  data
) {

  const sources =
    [];


  for(
    const step
    of data.steps ||
    []
  ) {

    if(
      step.type !==
      "model_output"
    ) {

      continue;

    }


    for(
      const block
      of step.content ||
      []
    ) {

      for(
        const annotation
        of block.annotations ||
        []
      ) {

        if(
          annotation.type ===
          "url_citation"
        ) {

          sources.push({

            title:
              annotation.title ||
              "Source",

            url:
              annotation.url ||
              annotation.uri ||
              ""

          });

        }

      }

    }

  }


  return sources
    .filter(
      item =>
        item.url
    )
    .slice(
      0,
      6
    );

}


/* ============================================================
   GEMINI ANALYSIS
============================================================ */

async function callGemini(
  packet
) {

  if(
    !GEMINI_API_KEY
  ) {

    throw new Error(
      "GEMINI_API_KEY is missing."
    );

  }


  const systemInstruction =
`
You are MKAYFX Extreme AI.

You are a market-analysis decision engine.

You are NOT a guaranteed-profit system.

Analyze the LIVE supplied market data.

Use:

H1 = major directional context
M15 = setup confirmation
M5 = entry timing

Consider:

- price action
- market structure
- EMA 20
- EMA 50
- RSI
- ATR
- MACD
- momentum
- recent liquidity highs/lows
- breakouts
- false breakouts
- trend continuation
- reversals
- ranging conditions
- volatility
- session conditions
- risk/reward
- whether the entry is late or overextended

Return exactly one:

BUY
SELL
WAIT

WAIT is an important valid decision.

Do not force trades.

For BUY:

stopLoss < entry
takeProfit1 > entry
takeProfit2 > takeProfit1

For SELL:

stopLoss > entry
takeProfit1 < entry
takeProfit2 < takeProfit1

If WAIT:

entry, stopLoss, takeProfit1 and takeProfit2 must be null.

Avoid distant unrealistic targets.

Use ATR and actual structure when placing stops and targets.

Confidence must reflect uncertainty.

Never use 100%.

A+ setups should be rare.

If Google Search is available, check only important current market-moving catalysts relevant to the selected symbol.

For XAU/USD focus especially on:

- USD
- Federal Reserve
- interest rates
- CPI
- PCE
- NFP
- unemployment
- US Treasury yields
- geopolitical developments

Current news must not override the supplied live technical structure without a good reason.

Do not invent prices.

If evidence conflicts, choose WAIT.
`;


  const body = {

    model:
      GEMINI_MODEL,

    system_instruction:
      systemInstruction,

    input:
      `Current UTC time: ${new Date().toISOString()}

Analyze this LIVE market packet:

${JSON.stringify(packet)}`,

    generation_config: {

      thinking_level:
        "high"

    },

    response_format: {

      type:
        "text",

      mime_type:
        "application/json",

      schema:
        ANALYSIS_SCHEMA

    },

    store:
      false

  };


  if(
    USE_WEB_NEWS
  ) {

    body.tools = [
      {
        type:
          "google_search"
      }
    ];

  }


  const response =
    await fetch(
      GEMINI_URL,
      {

        method:
          "POST",

        headers: {

          "Content-Type":
            "application/json",

          "x-goog-api-key":
            GEMINI_API_KEY

        },

        body:
          JSON.stringify(
            body
          )

      }
    );


  const data =
    await response.json();


  if(
    !response.ok
  ) {

    throw new Error(
      data?.error?.message ||
      `Gemini API error ${response.status}`
    );

  }


  if(
    data.status &&
    data.status !==
      "completed"
  ) {

    throw new Error(
      `Gemini response status: ${data.status}`
    );

  }


  const text =
    extractGeminiText(
      data
    );


  if(
    !text
  ) {

    throw new Error(
      "Gemini returned no analysis."
    );

  }


  let analysis;


  try {

    analysis =
      JSON.parse(
        text
      );

  }
  catch {

    throw new Error(
      "Gemini returned invalid JSON."
    );

  }


  return {

    analysis,

    sources:
      extractGeminiSources(
        data
      )

  };

}


/* ============================================================
   SERVER-SIDE TRADE VALIDATION
============================================================ */

function validateAnalysis(
  symbol,
  analysis,
  currentPrice,
  atrValue
) {

  const result = {
    ...analysis
  };


  result.confidence =
    clamp(
      Number(
        result.confidence ||
        0
      ),
      0,
      99
    );


  if(
    ![
      "BUY",
      "SELL",
      "WAIT"
    ].includes(
      result.action
    )
  ) {

    result.action =
      "WAIT";

  }


  if(
    result.action ===
    "WAIT"
  ) {

    result.setupGrade =
      "WAIT";

    result.entry =
      null;

    result.stopLoss =
      null;

    result.takeProfit1 =
      null;

    result.takeProfit2 =
      null;

    result.riskReward =
      "—";

    return result;

  }


  const entry =
    Number(
      result.entry
    );


  const stop =
    Number(
      result.stopLoss
    );


  const tp1 =
    Number(
      result.takeProfit1
    );


  const tp2 =
    Number(
      result.takeProfit2
    );


  if(
    ![
      entry,
      stop,
      tp1,
      tp2
    ]
    .every(
      Number.isFinite
    )
  ) {

    return forceWait(
      result
    );

  }


  if(
    result.action ===
    "BUY"
  ) {

    if(
      !(
        stop <
          entry &&
        tp1 >
          entry &&
        tp2 >
          tp1
      )
    ) {

      return forceWait(
        result
      );

    }

  }


  if(
    result.action ===
    "SELL"
  ) {

    if(
      !(
        stop >
          entry &&
        tp1 <
          entry &&
        tp2 <
          tp1
      )
    ) {

      return forceWait(
        result
      );

    }

  }


  const atrNumber =
    Math.max(
      Number(
        atrValue ||
        0
      ),
      Math.abs(
        currentPrice *
        0.0001
      )
    );


  /* ENTRY TOO FAR FROM LIVE PRICE */

  if(
    Math.abs(
      entry -
      currentPrice
    ) >
    atrNumber *
    3
  ) {

    return forceWait(
      result
    );

  }


  /* STOP TOO FAR */

  if(
    Math.abs(
      stop -
      entry
    ) >
    atrNumber *
    4
  ) {

    return forceWait(
      result
    );

  }


  /* LOW CONFIDENCE */

  if(
    result.confidence <
    60
  ) {

    return forceWait(
      result
    );

  }


  result.entry =
    priceRound(
      symbol,
      entry
    );


  result.stopLoss =
    priceRound(
      symbol,
      stop
    );


  result.takeProfit1 =
    priceRound(
      symbol,
      tp1
    );


  result.takeProfit2 =
    priceRound(
      symbol,
      tp2
    );


  return result;

}


function forceWait(
  result
) {

  return {

    ...result,

    action:
      "WAIT",

    setupGrade:
      "WAIT",

    entry:
      null,

    stopLoss:
      null,

    takeProfit1:
      null,

    takeProfit2:
      null,

    riskReward:
      "—",

    invalidation:
      "No validated active trade setup.",

    nextTrigger:
      "Wait for a fresh confirmed market setup."

  };

}


/* ============================================================
   MAIN API
============================================================ */

export default async function handler(
  req,
  res
) {

  res.setHeader(
    "Cache-Control",
    "no-store"
  );


  res.setHeader(
    "Allow",
    "GET, POST, OPTIONS"
  );


  /* ========================================================
     PREFLIGHT
  ======================================================== */

  if(
    req.method ===
    "OPTIONS"
  ) {

    return res
      .status(204)
      .end();

  }


  /*
     IMPORTANT:

     ACCEPT BOTH GET AND POST.

     THIS MEANS:

     OLD FRONTEND:
     /api/analyze?symbol=XAU%2FUSD

     AND NEW FRONTEND:
     POST /api/analyze

     WILL BOTH WORK.
  */

  if(
    req.method !==
      "GET" &&
    req.method !==
      "POST"
  ) {

    return send(
      res,
      405,
      {
        error:
          "Use GET or POST."
      }
    );

  }


  try {

    const body =
      getRequestBody(
        req
      );


    const symbol =
      String(

        body.symbol ||

        req.query?.symbol ||

        "XAU/USD"

      )
      .trim()
      .toUpperCase();


    if(
      !ALLOWED_SYMBOLS.has(
        symbol
      )
    ) {

      return send(
        res,
        400,
        {
          success:
            false,

          error:
            `Unsupported symbol: ${symbol}`
        }
      );

    }


    /* ========================================================
       LIVE MARKET DATA
    ======================================================== */

    const {
      candles:
        rawM5,

      cacheHit

    } =
      await getM5Cached(
        symbol
      );


    const currentPrice =
      rawM5[
        rawM5.length -
        1
      ].c;


    /* ========================================================
       COMPLETED CANDLES
    ======================================================== */

    const m5 =
      completedCandles(
        rawM5
      );


    const m15 =
      resample(
        m5,
        15
      );


    const h1 =
      resample(
        m5,
        60
      );


    if(
      m5.length <
        100 ||
      m15.length <
        30 ||
      h1.length <
        20
    ) {

      throw new Error(
        "Not enough completed candles for analysis."
      );

    }


    /* ========================================================
       TECHNICAL ENGINE
    ======================================================== */

    const m5Data =
      snapshot(
        symbol,
        m5
      );


    const m15Data =
      snapshot(
        symbol,
        m15
      );


    const h1Data =
      snapshot(
        symbol,
        h1
      );


    /* ========================================================
       PRICE CHANGE
    ======================================================== */

    const oldIndex =
      Math.max(
        0,
        rawM5.length -
        13
      );


    const oldPrice =
      rawM5[
        oldIndex
      ].c;


    const changePct =
      oldPrice
        ?
        (
          (
            currentPrice /
            oldPrice
          ) -
          1
        ) *
        100
        :
        0;


    /* ========================================================
       AI PACKET
    ======================================================== */

    const packet = {

      symbol,

      currentPrice:
        priceRound(
          symbol,
          currentPrice
        ),

      currentUTC:
        new Date()
          .toISOString(),

      session:
        currentSession(),

      M5:
        m5Data,

      M15:
        m15Data,

      H1:
        h1Data

    };


    /* ========================================================
       LOCAL FALLBACK FIRST
    ======================================================== */

    let analysis =
      localAnalysis(

        symbol,

        currentPrice,

        m5Data,

        m15Data,

        h1Data

      );


    let model =
      "local-technical-fallback";


    let aiOnline =
      false;


    let newsSources =
      [];


    let aiError =
      null;


    /* ========================================================
       GEMINI
    ======================================================== */

    if(
      GEMINI_API_KEY
    ) {

      try {

        const result =
          await callGemini(
            packet
          );


        analysis =
          validateAnalysis(

            symbol,

            result.analysis,

            currentPrice,

            m5Data
              .indicators
              .atr14

          );


        newsSources =
          result.sources;


        model =
          GEMINI_MODEL;


        aiOnline =
          true;

      }
      catch(error) {

        console.error(
          "Gemini failed:",
          error
        );


        aiError =
          error?.message ||
          "Gemini failed.";


        /*
           DO NOT BREAK THE WEBSITE.

           LOCAL ENGINE CONTINUES WORKING.
        */

        model =
          "local-fallback-gemini-unavailable";

      }

    }
    else {

      aiError =
        "GEMINI_API_KEY is not configured.";

    }


    /* ========================================================
       RESPONSE
    ======================================================== */

    return send(
      res,
      200,
      {

        success:
          true,

        symbol,

        price:
          priceRound(
            symbol,
            currentPrice
          ),

        current_price:
          priceRound(
            symbol,
            currentPrice
          ),

        changePct:
          round(
            changePct,
            4
          ),

        model,

        ai_online:
          aiOnline,

        ai_provider:
          aiOnline
            ?
            "Google Gemini"
            :
            "Local fallback",

        ai_error:
          aiError,

        reasoning_effort:
          aiOnline
            ?
            "high"
            :
            "deterministic",

        analysis,

        chart:
          rawM5
            .slice(
              -60
            )
            .map(
              candle => ({

                t:
                  candle.t,

                o:
                  priceRound(
                    symbol,
                    candle.o
                  ),

                h:
                  priceRound(
                    symbol,
                    candle.h
                  ),

                l:
                  priceRound(
                    symbol,
                    candle.l
                  ),

                c:
                  priceRound(
                    symbol,
                    candle.c
                  )

              })
            ),

        data_mode:
          aiOnline
            ?
            "Live M5 + local M15/H1 + Gemini AI"
            :
            "Live M5 + local M15/H1 + local fallback",

        cache_hit:
          cacheHit,

        guardrail_note:
          cacheHit
            ?
            "Market candles came from the 55-second cache."
            :
            "Fresh Twelve Data M5 candles loaded; M15 and H1 were generated locally.",

        session:
          currentSession(),

        news_sources:
          newsSources,

        timestamp:
          new Date()
            .toISOString()

      }
    );


  }
  catch(error) {

    console.error(
      "MKAYFX ERROR:",
      error
    );


    return send(
      res,
      500,
      {

        success:
          false,

        error:
          error?.message ||
          "Unknown server error."

      }
    );

  }

}