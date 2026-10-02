const API_KEY = process.env.TWELVE_DATA_API_KEY;

const BASE = "https://api.twelvedata.com";
const SYMBOL = "XAU/USD";


/* =========================================================
   BASIC HELPERS
========================================================= */

function n(value, fallback = null) {

  const x = Number(value);

  return Number.isFinite(x)
    ? x
    : fallback;
}


function round(value, digits = 2) {

  const x = Number(value);

  return Number.isFinite(x)
    ? Number(
        x.toFixed(digits)
      )
    : null;
}


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
      (
        total,
        value
      ) =>
        total + value,
      0
    )
    /
    valid.length
  );
}


/* =========================================================
   MARKET DATA FETCH
========================================================= */

async function getJSON(url) {

  const response =
    await fetch(
      url,
      {
        method:
          "GET",

        headers: {
          Accept:
            "application/json"
        },

        cache:
          "no-store"
      }
    );


  const text =
    await response.text();


  let json;


  try {

    json =
      JSON.parse(
        text
      );

  } catch {

    throw new Error(
      "Market data provider returned invalid JSON."
    );
  }


  if (
    !response.ok ||
    json?.status === "error" ||
    json?.code
  ) {

    throw new Error(
      json?.message ||
      `Market-data request failed (${response.status}).`
    );
  }


  return json;
}


/* =========================================================
   BUILD TWELVE DATA URL

   No URLSearchParams used here.
========================================================= */

function twelveDataURL(
  path,
  params
) {

  const query =
    Object.entries(params)
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
    BASE +
    path +
    "?" +
    query
  );
}


/* =========================================================
   CANDLE DATA
========================================================= */

async function getCandles(
  interval,
  outputsize
) {

  if (!API_KEY) {

    throw new Error(
      "TWELVE_DATA_API_KEY is missing in Vercel."
    );
  }


  const url =
    twelveDataURL(
      "/time_series",
      {

        symbol:
          SYMBOL,

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
      `${interval} candles are unavailable.`
    );
  }


  const candles =
    data.values
      .map(
        item => ({

          time:
            String(
              item.datetime ||
              ""
            ),

          open:
            Number(
              item.open
            ),

          high:
            Number(
              item.high
            ),

          low:
            Number(
              item.low
            ),

          close:
            Number(
              item.close
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
    50
  ) {

    throw new Error(
      `Not enough ${interval} candles returned.`
    );
  }


  return candles;
}


/* =========================================================
   LIVE PRICE
========================================================= */

async function getLivePrice() {

  if (!API_KEY) {

    throw new Error(
      "TWELVE_DATA_API_KEY is missing in Vercel."
    );
  }


  const url =
    twelveDataURL(
      "/price",
      {

        symbol:
          SYMBOL,

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
      "Live XAU/USD price unavailable."
    );
  }


  return price;
}


/* =========================================================
   TIME
========================================================= */

function parseTime(value) {

  let text =
    String(
      value
    )
    .trim()
    .replace(
      " ",
      "T"
    );


  if (
    !text.endsWith("Z") &&
    !/[+-]\d\d:\d\d$/.test(
      text
    )
  ) {

    text += "Z";
  }


  const time =
    Date.parse(
      text
    );


  return Number.isFinite(
    time
  )
    ? time
    : NaN;
}


/* =========================================================
   RESAMPLE M1 -> M5 / M15
========================================================= */

function resample(
  candles,
  minutes
) {

  const bucketSize =
    minutes *
    60 *
    1000;


  const buckets =
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
      !buckets.has(
        key
      )
    ) {

      buckets.set(
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
        buckets.get(
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
    ...buckets.values()
  ]
  .sort(
    (
      a,
      b
    ) =>
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

  if (
    !values.length
  ) {

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

  if (
    !values.length
  ) {

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
      change >= 0
    ) {

      gains +=
        change;

    } else {

      losses -=
        change;
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


  const ema12 =
    emaSeries(
      values,
      12
    );


  const ema26 =
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

        ema12[index] -
        ema26[index]
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
      closes.slice(-80),
      20
    );


  const ema50 =
    ema(
      closes.slice(-120),
      50
    );


  const ema100 =
    ema(
      closes.slice(-180),
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
      0.0008,
      0.5
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

    bias:

      score >= 2
        ? "BULLISH"

        : score <= -2
        ? "BEARISH"

        : "NEUTRAL",

    score,

    rsi:
      currentRSI,

    macd:
      currentMACD,

    atr:
      currentATR,

    close:
      latest.close,

    ema20,

    ema50
  };
}


/* =========================================================
   LIQUIDITY
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
        "No clear liquidity sweep yet."
    };
  }


  const latest =
    candles.at(-1);


  const previous =
    candles.slice(
      -16,
      -1
    );


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
    latest.low <
    low
    &&
    latest.close >
    low
  ) {

    return {

      score:
        2,

      text:
        "Sell-side liquidity sweep with recovery."
    };
  }


  if (
    latest.high >
    high
    &&
    latest.close <
    high
  ) {

    return {

      score:
        -2,

      text:
        "Buy-side liquidity sweep with rejection."
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

function analyzeTrigger(
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
        "No clear displacement trigger."
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
      0.0001
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
    0.6
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
    body >
    0.6
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
      "No strong displacement candle on the latest bar."
  };
}


/* =========================================================
   SESSION
========================================================= */

function marketSession() {

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
  m1,
  m5,
  m15,
  h1,
  price
) {

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


  const trigger =
    analyzeTrigger(
      m1
    );


  const weightedScore =

      T.M1.score *
      0.7

    +

      T.M5.score *
      1.25

    +

      T.M15.score *
      1.65

    +

      T.H1.score *
      2.1

    +

      liquidity.score *
      1.15

    +

      trigger.score;


  const signal =
    weightedScore >= 0

      ? "BUY"

      : "SELL";


  const sign =
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
    Math.round(

      clamp(

        52
        +
        agreement *
        6
        +
        Math.abs(
          weightedScore
        )
        *
        1.3,

        55,

        92
      )
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

    confidence =
      clamp(
        confidence +
        3,

        55,

        94
      );
  }


  const currentATR =
    T.M5.atr
    ||
    Math.max(
      price *
      0.001,
      1
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


  let stopDistance =
    Math.max(
      currentATR *
      1.05,

      price *
      0.001
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
        currentATR *
        0.1
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
        currentATR *
        0.1
      );
  }


  stopDistance =
    Math.min(

      stopDistance,

      currentATR *
      2.4
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


  return {

    signal,

    confidence,

    entry,

    stopLoss,

    takeProfit,

    takeProfit2,

    T,

    reasons: [

      `${signal} selected from weighted M1/M5/M15/H1 alignment.`,

      `H1 ${T.H1.bias}; M15 ${T.M15.bias}; M5 ${T.M5.bias}.`,

      `M5 RSI ${round(
        T.M5.rsi,
        1
      )} and MACD ${round(
        T.M5.macd,
        3
      )}.`,

      liquidity.text,

      trigger.text,

      "Stop loss uses M5 volatility and recent structure; TP is 2R."
    ]
  };
}


/* =========================================================
   VERCEL API
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
    "Content-Type",
    "application/json; charset=utf-8"
  );


  try {

    if (!API_KEY) {

      throw new Error(
        "TWELVE_DATA_API_KEY is missing in Vercel."
      );
    }


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
        await getLivePrice();


      return res
        .status(200)
        .json({

          success:
            true,

          symbol:
            SYMBOL,

          price:
            round(
              price,
              2
            ),

          timestamp:
            new Date()
              .toISOString()
        });
    }


    /* =====================================================
       METHOD
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


    /* =====================================================
       REQUEST BODY
    ===================================================== */

    let requestBody = {};


    if (
      req.body
      &&
      typeof req.body ===
      "object"
    ) {

      requestBody =
        req.body;

    } else if (
      typeof req.body ===
      "string"
    ) {

      try {

        requestBody =
          JSON.parse(
            req.body
          );

      } catch {

        requestBody = {};
      }
    }


    const equity =
      clamp(

        n(
          requestBody.equityZAR,
          200
        ),

        1,

        100000000
      );


    const riskPercent =
      clamp(

        n(
          requestBody.riskPercent,
          0.5
        ),

        0.1,

        5
      );


    /* =====================================================
       ONLY TWO TWELVE DATA REQUESTS

       M5 + M15 are built locally from M1.
    ===================================================== */

    const [
      m1,
      h1
    ] =
      await Promise.all([

        getCandles(
          "1min",
          500
        ),

        getCandles(
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
        "Not enough intraday candles to build M5/M15 analysis."
      );
    }


    /*
      Use latest M1 close as entry.
      This avoids another API request.
    */

    const price =
      m1.at(-1)
        .close;


    const analysis =
      buildSignal(

        m1,

        m5,

        m15,

        h1,

        price
      );


    /* =====================================================
       RESPONSE
    ===================================================== */

    return res
      .status(200)
      .json({

        success:
          true,

        model:
          "MKAYFX CHART SCANNER V3",

        symbol:
          SYMBOL,

        signalId:
          `MK-${Date.now()}-${analysis.signal}`,

        signal:
          analysis.signal,

        confidence:
          analysis.confidence,

        setupStrength:
          analysis.confidence,

        timeframe:
          "H1",

        session:
          marketSession(),

        createdAt:
          new Date()
            .toISOString(),

        locked:
          true,

        entry:
          round(
            analysis.entry,
            2
          ),

        stopLoss:
          round(
            analysis.stopLoss,
            2
          ),

        takeProfit:
          round(
            analysis.takeProfit,
            2
          ),

        takeProfit2:
          round(
            analysis.takeProfit2,
            2
          ),

        currentPrice:
          round(
            price,
            2
          ),

        riskReward:
          2,

        riskReward2:
          3,

        timeframeBias: {

          M1:
            analysis.T.M1.bias,

          M5:
            analysis.T.M5.bias,

          M15:
            analysis.T.M15.bias,

          H1:
            analysis.T.H1.bias
        },

        indicators: {

          m5Rsi:
            round(
              analysis.T.M5.rsi,
              1
            ),

          m5Atr:
            round(
              analysis.T.M5.atr,
              2
            ),

          m5Macd:
            round(
              analysis.T.M5.macd,
              3
            )
        },

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
            })
          ),

        lifecycle: {

          state:
            "TRADE_ACTIVE",

          rule:
            "Keep this signal locked until TP or SL.",

          nextAnalysis:
            "Create a new signal immediately after exit."
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
          error?.message ||
          String(
            error
          )
      });
  }
}