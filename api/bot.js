/* =========================================================
   MKAYFX SCALPER V1
   M15 = DIRECTION
   M5  = SETUP
   M1  = ENTRY

   MARKETS:
   XAU/USD
   BTC/USD

   VERCEL ENV:
   TWELVE_DATA_API_KEY
========================================================= */

const API_KEY =
  process.env.TWELVE_DATA_API_KEY;

const BASE_URL =
  "https://api.twelvedata.com";


const MARKETS = {

  "XAU/USD": {
    name: "Gold",
    decimals: 2,

    minStopPct: 0.00045,

    maxStopPct: 0.0025,

    atrMultiplier: 0.85
  },

  "BTC/USD": {
    name: "Bitcoin",
    decimals: 2,

    minStopPct: 0.0007,

    maxStopPct: 0.004,

    atrMultiplier: 0.95
  }

};


/* =========================================================
   HELPERS
========================================================= */

function num(
  value,
  fallback = null
) {

  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;
}


function round(
  value,
  digits = 2
) {

  const n =
    Number(value);

  return Number.isFinite(n)

    ? Number(
        n.toFixed(digits)
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
        sum,
        value
      ) =>
        sum + value,
      0
    )
    /
    valid.length
  );
}


function errorText(value) {

  if (!value) {
    return "Unknown error.";
  }

  if (
    typeof value ===
    "string"
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
    typeof value ===
    "object"
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

      return JSON.stringify(
        value
      );

    } catch {}
  }

  return String(value);
}


function requestBody(req) {

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
   SYMBOL
========================================================= */

function getSymbol(
  req,
  body
) {

  const symbol =
    body.symbol ||
    req.query?.symbol ||
    "XAU/USD";


  if (!MARKETS[symbol]) {

    throw new Error(
      "Unsupported symbol. Use XAU/USD or BTC/USD."
    );
  }

  return symbol;
}


/* =========================================================
   URL
========================================================= */

function buildURL(
  path,
  params
) {

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


  const timer =
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
        JSON.parse(raw);

    } catch {

      throw new Error(
        "Market provider returned invalid JSON."
      );
    }


    if (
      !response.ok ||
      data?.status === "error"
    ) {

      throw new Error(
        errorText(
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
        "Market request timed out."
      );
    }

    throw error;


  } finally {

    clearTimeout(timer);
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
      "TWELVE_DATA_API_KEY is missing."
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
    await fetchJSON(url);


  if (
    !Array.isArray(
      data.values
    )
  ) {

    throw new Error(
      `No ${interval} candles returned.`
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
            ),

          volume:
            Number(
              item.volume ||
              0
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
    40
  ) {

    throw new Error(
      `Not enough ${interval} candles.`
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
    await fetchJSON(url);


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
   TIME
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
    !text.endsWith("Z") &&
    !/[+-]\d\d:\d\d$/.test(
      text
    )
  ) {

    text += "Z";
  }


  return Date.parse(text);
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
    60000;


  const groups =
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


    const bucket =
      Math.floor(
        timestamp /
        size
      )
      *
      size;


    const key =
      String(bucket);


    if (
      !groups.has(
        key
      )
    ) {

      groups.set(
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
            candle.close,

          volume:
            candle.volume ||
            0

        }
      );


    } else {

      const existing =
        groups.get(
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


      existing.volume +=
        candle.volume ||
        0;
    }
  }


  return [
    ...groups.values()
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


function ema(
  values,
  period
) {

  const result =
    emaSeries(
      values,
      period
    );


  return (
    result.at(-1) ||
    0
  );
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
      change >=
      0
    ) {

      gains += change;

    } else {

      losses -= change;
    }
  }


  if (
    losses ===
    0
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


  const ranges =
    [];


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

function macd(
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
      (
        _,
        index
      ) =>
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
   ADX
========================================================= */

function adx(
  candles,
  period = 14
) {

  if (
    candles.length <
    period +
    2
  ) {

    return 20;
  }


  const tr = [];
  const plus = [];
  const minus = [];


  for (
    let i = 1;
    i < candles.length;
    i++
  ) {

    const up =
      candles[i].high -
      candles[i - 1].high;


    const down =
      candles[i - 1].low -
      candles[i].low;


    plus.push(

      up > down &&
      up > 0

        ? up

        : 0

    );


    minus.push(

      down > up &&
      down > 0

        ? down

        : 0

    );


    tr.push(

      Math.max(

        candles[i].high -
        candles[i].low,

        Math.abs(
          candles[i].high -
          candles[i - 1].close
        ),

        Math.abs(
          candles[i].low -
          candles[i - 1].close
        )

      )

    );
  }


  const avgTR =
    average(
      tr.slice(
        -period
      )
    );


  if (!avgTR) {
    return 20;
  }


  const plusDI =
    (
      average(
        plus.slice(
          -period
        )
      )
      /
      avgTR
    )
    *
    100;


  const minusDI =
    (
      average(
        minus.slice(
          -period
        )
      )
      /
      avgTR
    )
    *
    100;


  if (
    plusDI +
    minusDI ===
    0
  ) {

    return 20;
  }


  return (

    Math.abs(
      plusDI -
      minusDI
    )

    /

    (
      plusDI +
      minusDI
    )

    *
    100
  );
}


/* =========================================================
   TIMEFRAME TREND
========================================================= */

function trendSnapshot(
  candles
) {

  const closes =
    candles.map(
      candle =>
        candle.close
    );


  const latest =
    candles.at(-1);


  const ema9 =
    ema(
      closes,
      9
    );


  const ema21 =
    ema(
      closes,
      21
    );


  const ema50 =
    ema(
      closes,
      50
    );


  const currentRSI =
    rsi(
      closes,
      14
    );


  const currentMACD =
    macd(
      closes
    );


  const currentADX =
    adx(
      candles,
      14
    );


  let score =
    0;


  if (
    latest.close >
    ema9
  ) {

    score +=
      1;

  } else {

    score -=
      1;
  }


  if (
    ema9 >
    ema21
  ) {

    score +=
      1;

  } else {

    score -=
      1;
  }


  if (
    ema21 >
    ema50
  ) {

    score +=
      1;

  } else {

    score -=
      1;
  }


  if (
    currentRSI >
    54
  ) {

    score +=
      0.8;

  } else if (
    currentRSI <
    46
  ) {

    score -=
      0.8;
  }


  if (
    currentMACD >
    0
  ) {

    score +=
      0.8;

  } else if (
    currentMACD <
    0
  ) {

    score -=
      0.8;
  }


  return {

    score,

    bias:

      score >=
      1.8

        ? "BULLISH"

        : score <=
          -1.8

        ? "BEARISH"

        : "NEUTRAL",

    ema9,

    ema21,

    ema50,

    rsi:
      currentRSI,

    macd:
      currentMACD,

    adx:
      currentADX,

    atr:
      atr(
        candles,
        14
      )

  };
}


/* =========================================================
   M5 STRUCTURE
========================================================= */

function structure(
  candles
) {

  const latest =
    candles.at(-1);


  const recent =
    candles.slice(
      -21,
      -1
    );


  const high =
    Math.max(
      ...recent.map(
        candle =>
          candle.high
      )
    );


  const low =
    Math.min(
      ...recent.map(
        candle =>
          candle.low
      )
    );


  if (
    latest.close >
    high
  ) {

    return {

      score:
        2,

      label:
        "BOS UP",

      detail:
        "M5 bullish break of structure.",

      swingHigh:
        high,

      swingLow:
        low

    };
  }


  if (
    latest.close <
    low
  ) {

    return {

      score:
        -2,

      label:
        "BOS DOWN",

      detail:
        "M5 bearish break of structure.",

      swingHigh:
        high,

      swingLow:
        low

    };
  }


  const half =
    (
      high +
      low
    )
    /
    2;


  return {

    score:

      latest.close >
      half

        ? 0.5

        : -0.5,

    label:

      latest.close >
      half

        ? "UPPER RANGE"

        : "LOWER RANGE",

    detail:
      "M5 price remains inside current structure.",

    swingHigh:
      high,

    swingLow:
      low

  };
}


/* =========================================================
   LIQUIDITY SWEEP
========================================================= */

function liquiditySweep(
  candles
) {

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

      label:
        "SELL-SIDE SWEEP",

      detail:
        "Price swept lows then reclaimed."

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

      label:
        "BUY-SIDE SWEEP",

      detail:
        "Price swept highs then rejected."

    };
  }


  return {

    score:
      0,

    label:
      "NO SWEEP",

    detail:
      "No confirmed liquidity sweep."

  };
}


/* =========================================================
   FVG
========================================================= */

function fvg(
  candles
) {

  if (
    candles.length <
    4
  ) {

    return {

      score:
        0,

      label:
        "NONE"

    };
  }


  const first =
    candles.at(-3);


  const last =
    candles.at(-1);


  if (
    last.low >
    first.high
  ) {

    return {

      score:
        1,

      label:
        "BULLISH FVG"

    };
  }


  if (
    last.high <
    first.low
  ) {

    return {

      score:
        -1,

      label:
        "BEARISH FVG"

    };
  }


  return {

    score:
      0,

    label:
      "NONE"

  };
}


/* =========================================================
   M1 ENTRY TRIGGER
========================================================= */

function entryTrigger(
  candles
) {

  const previous =
    candles.at(-2);


  const latest =
    candles.at(-1);


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
    );


  const efficiency =
    body /
    range;


  const bullishEngulf =
    previous.close <
    previous.open
    &&
    latest.close >
    latest.open
    &&
    latest.open <=
    previous.close
    &&
    latest.close >=
    previous.open;


  const bearishEngulf =
    previous.close >
    previous.open
    &&
    latest.close <
    latest.open
    &&
    latest.open >=
    previous.close
    &&
    latest.close <=
    previous.open;


  if (
    bullishEngulf
  ) {

    return {

      score:
        2,

      label:
        "BULLISH ENGULF",

      detail:
        "M1 bullish engulfing entry trigger."

    };
  }


  if (
    bearishEngulf
  ) {

    return {

      score:
        -2,

      label:
        "BEARISH ENGULF",

      detail:
        "M1 bearish engulfing entry trigger."

    };
  }


  if (
    efficiency >
    0.70
    &&
    latest.close >
    latest.open
  ) {

    return {

      score:
        1,

      label:
        "BULL DISPLACEMENT",

      detail:
        "Strong M1 bullish displacement candle."

    };
  }


  if (
    efficiency >
    0.70
    &&
    latest.close <
    latest.open
  ) {

    return {

      score:
        -1,

      label:
        "BEAR DISPLACEMENT",

      detail:
        "Strong M1 bearish displacement candle."

    };
  }


  return {

    score:
      0,

    label:
      "NO TRIGGER",

    detail:
      "No strong M1 trigger candle."

  };
}


/* =========================================================
   PREMIUM / DISCOUNT
========================================================= */

function premiumDiscount(
  candles
) {

  const recent =
    candles.slice(
      -40
    );


  const high =
    Math.max(
      ...recent.map(
        candle =>
          candle.high
      )
    );


  const low =
    Math.min(
      ...recent.map(
        candle =>
          candle.low
      )
    );


  const midpoint =
    (
      high +
      low
    )
    /
    2;


  const price =
    candles.at(-1)
      .close;


  return price <
    midpoint

    ? {

        score:
          0.5,

        label:
          "DISCOUNT"

      }

    : {

        score:
          -0.5,

        label:
          "PREMIUM"

      };
}


/* =========================================================
   SESSION
========================================================= */

function session(
  symbol
) {

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

    return "LONDON";
  }


  if (
    hour >= 14 &&
    hour < 18
  ) {

    return "NEW YORK OPEN";
  }


  if (
    hour >= 18 &&
    hour < 22
  ) {

    return "NEW YORK";
  }


  return "OFF-PEAK";
}


/* =========================================================
   SCALP SIGNAL ENGINE
========================================================= */

function buildScalpSignal(
  symbol,
  m1,
  m5,
  m15,
  options
) {

  const market =
    MARKETS[symbol];


  /*
    M15 = primary directional bias
  */

  const T15 =
    trendSnapshot(
      m15
    );


  /*
    M5 = setup confirmation
  */

  const T5 =
    trendSnapshot(
      m5
    );


  /*
    M1 = execution
  */

  const T1 =
    trendSnapshot(
      m1
    );


  const ST =
    structure(
      m5
    );


  const LQ5 =
    liquiditySweep(
      m5
    );


  const LQ1 =
    liquiditySweep(
      m1
    );


  const F5 =
    fvg(
      m5
    );


  const F1 =
    fvg(
      m1
    );


  const trigger =
    entryTrigger(
      m1
    );


  const PD =
    premiumDiscount(
      m15
    );


  /*
    Weighting:

    M15 strongest directional context.
    M5 confirms setup.
    M1 finds exact trigger.
  */

  let score =

      T15.score *
      2.30

    +

      T5.score *
      1.65

    +

      T1.score *
      0.85

    +

      ST.score *
      1.20

    +

      LQ5.score *
      1.20

    +

      LQ1.score *
      0.80

    +

      F5.score *
      0.65

    +

      F1.score *
      0.45

    +

      trigger.score *
      1.25

    +

      PD.score *
      0.50;


  /*
    Avoid weak counter-trend M1 entries.
  */

  if (
    T15.bias ===
    "BULLISH"
    &&
    score <
    0
  ) {

    score *=
      0.55;
  }


  if (
    T15.bias ===
    "BEARISH"
    &&
    score >
    0
  ) {

    score *=
      0.55;
  }


  const direction =
    score >= 0

      ? "BUY"

      : "SELL";


  const sign =
    direction ===
    "BUY"

      ? 1

      : -1;


  const alignment =
    [
      T1,
      T5,
      T15
    ]
    .filter(
      tf =>

        direction ===
        "BUY"

          ? tf.score >
            0

          : tf.score <
            0
    )
    .length;


  const setupFeatures =
    [

      ST.score,

      LQ5.score,

      LQ1.score,

      trigger.score,

      F5.score

    ]
    .filter(
      value =>

        direction ===
        "BUY"

          ? value >
            0

          : value <
            0
    )
    .length;


  let confidence =

      48

    +

      alignment *
      8

    +

      setupFeatures *
      3

    +

      Math.min(
        16,
        Math.abs(
          score
        )
      );


  /*
    Strong M1 trigger bonus.
  */

  if (
    direction ===
    "BUY"
    &&
    trigger.score >
    0
  ) {

    confidence +=
      4;
  }


  if (
    direction ===
    "SELL"
    &&
    trigger.score <
    0
  ) {

    confidence +=
      4;
  }


  confidence =
    Math.round(
      clamp(
        confidence,
        50,
        95
      )
    );


  const minConfidence =
    clamp(
      num(
        options.minConfidence,
        64
      ),
      50,
      90
    );


  const allowWait =
    Boolean(
      options.allowWait
    );


  const tradeable =
    confidence >=
    minConfidence
    &&
    Math.abs(
      score
    ) >=
    4;


  const signal =
    allowWait &&
    !tradeable

      ? "WAIT"

      : direction;


  /* =====================================================
     SCALP ENTRY
  ===================================================== */

  const entry =
    m1.at(-1)
      .close;


  /*
    Use blended M1/M5 ATR.
  */

  const volatility =
    Math.max(

      T1.atr *
      1.2,

      T5.atr *
      0.55,

      entry *
      market.minStopPct

    );


  let stopDistance =
    Math.max(

      volatility *
      market.atrMultiplier,

      entry *
      market.minStopPct

    );


  /*
    M1 micro structure protection.
  */

  const recentM1 =
    m1.slice(
      -12
    );


  const microHigh =
    Math.max(
      ...recentM1.map(
        candle =>
          candle.high
      )
    );


  const microLow =
    Math.min(
      ...recentM1.map(
        candle =>
          candle.low
      )
    );


  if (
    direction ===
    "BUY"
  ) {

    const structureStop =
      entry -
      microLow;


    if (
      structureStop >
      0
    ) {

      stopDistance =
        Math.max(
          stopDistance,
          structureStop +
          T1.atr *
          0.15
        );
    }
  }


  if (
    direction ===
    "SELL"
  ) {

    const structureStop =
      microHigh -
      entry;


    if (
      structureStop >
      0
    ) {

      stopDistance =
        Math.max(
          stopDistance,
          structureStop +
          T1.atr *
          0.15
        );
    }
  }


  /*
    Prevent huge SL for scalping.
  */

  stopDistance =
    Math.min(

      stopDistance,

      entry *
      market.maxStopPct

    );


  const rr =
    clamp(
      num(
        options.rr,
        1.5
      ),
      1,
      3
    );


  const stopLoss =
    entry -
    sign *
    stopDistance;


  const takeProfit =
    entry +
    sign *
    stopDistance *
    rr;


  const takeProfit2 =
    entry +
    sign *
    stopDistance *
    2;


  const breakeven =
    entry +
    sign *
    stopDistance *
    0.8;


  const trailingTrigger =
    entry +
    sign *
    stopDistance *
    1.15;


  const quality =

    confidence >=
    85

      ? "A+"

      : confidence >=
        77

      ? "A"

      : confidence >=
        68

      ? "B"

      : "C";


  return {

    signal,

    directionalBias:
      direction,

    confidence,

    quality,

    tradeable,

    score,

    entry,

    stopLoss,

    takeProfit,

    takeProfit2,

    breakeven,

    trailTrigger:
      trailingTrigger,

    rr,

    session:
      session(
        symbol
      ),

    strategy:
      "M15 Bias → M5 Setup → M1 Entry",

    timeframe:
      "M15 / M5 / M1 SCALP",

    regime:

      T5.adx >=
      25

        ? "TRENDING"

        : "RANGING",

    volatility: {

      label:

        T5.atr /
        entry >
        0.002

          ? "HIGH"

          : "NORMAL",

      atr:
        T5.atr,

      percentile:
        clamp(
          (
            T5.atr /
            entry
          )
          *
          15000,
          0,
          100
        )

    },

    timeframeBias: {

      M1:
        T1.bias,

      M5:
        T5.bias,

      M15:
        T15.bias

    },

    features: {

      structure:
        ST,

      liquidity:
        LQ5,

      microLiquidity:
        LQ1,

      fvg:
        F5,

      microFvg:
        F1,

      orderBlock: {

        label:
          trigger.label,

        score:
          trigger.score,

        detail:
          trigger.detail

      },

      premiumDiscount:
        PD,

      candlePattern:
        trigger

    },

    indicators: {

      M1: {

        rsi:
          round(
            T1.rsi,
            1
          ),

        macd:
          round(
            T1.macd,
            4
          ),

        adx:
          round(
            T1.adx,
            1
          )

      },

      M5: {

        rsi:
          round(
            T5.rsi,
            1
          ),

        macd:
          round(
            T5.macd,
            4
          ),

        adx:
          round(
            T5.adx,
            1
          )

      },

      M15: {

        rsi:
          round(
            T15.rsi,
            1
          ),

        macd:
          round(
            T15.macd,
            4
          ),

        adx:
          round(
            T15.adx,
            1
          )

      }

    },

    reasons: [

      `${direction} scalp bias from M15 directional trend.`,

      `M15 bias ${T15.bias} · RSI ${round(T15.rsi, 1)}.`,

      `M5 setup ${T5.bias} · ${ST.label} · ADX ${round(T5.adx, 1)}.`,

      `${LQ5.label}: ${LQ5.detail}`,

      `M1 trigger: ${trigger.label}.`,

      `M1 liquidity: ${LQ1.label}.`,

      `M5 imbalance: ${F5.label}.`,

      `Price location: ${PD.label}.`,

      `Scalp SL uses M1 structure + short-term ATR.`,

      `Primary target = ${rr.toFixed(2)}R.`

    ]

  };
}


/* =========================================================
   HANDLER
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
      requestBody(
        req
      );


    const symbol =
      getSymbol(
        req,
        body
      );


    const market =
      MARKETS[symbol];


    const mode =
      String(
        req.query?.mode ||
        ""
      )
      .toLowerCase();


    /* =====================================================
       HEALTH
    ===================================================== */

    if (
      req.method ===
      "GET"
      &&
      mode ===
      "health"
    ) {

      return res
        .status(200)
        .json({

          success:
            true,

          service:
            "MKAYFX SCALPER V1",

          strategy:
            "M15 Bias → M5 Setup → M1 Entry",

          apiKeyConfigured:
            Boolean(
              API_KEY
            ),

          supported: [
            "XAU/USD",
            "BTC/USD"
          ]

        });
    }


    /* =====================================================
       PRICE
    ===================================================== */

    if (
      req.method ===
      "GET"
      &&
      mode ===
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


    if (
      req.method !==
      "POST"
    ) {

      return res
        .status(405)
        .json({

          success:
            false,

          error:
            "Use POST for analysis."

        });
    }


    /*
      ONLY 2 DATA REQUESTS:

      M1 direct
      M5 direct

      M15 generated from M5
    */

    const [
      m1,
      m5
    ] =
      await Promise.all([

        getCandles(
          symbol,
          "1min",
          360
        ),

        getCandles(
          symbol,
          "5min",
          400
        )

      ]);


    const m15 =
      resample(
        m5,
        15
      );


    if (
      m15.length <
      60
    ) {

      throw new Error(
        "Not enough M15 history."
      );
    }


    const result =
      buildScalpSignal(

        symbol,

        m1,

        m5,

        m15,

        body

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


    const riskZAR =
      equity *
      riskPercent /
      100;


    return res
      .status(200)
      .json({

        success:
          true,

        model:
          "MKAYFX SCALPER V1",

        symbol,

        marketName:
          market.name,

        signalId:
          `SC-${Date.now()}-${symbol.replace("/", "")}-${result.signal}`,

        createdAt:
          new Date()
            .toISOString(),

        ...result,

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

        breakeven:
          round(
            result.breakeven,
            market.decimals
          ),

        trailTrigger:
          round(
            result.trailTrigger,
            market.decimals
          ),

        currentPrice:
          round(
            result.entry,
            market.decimals
          ),

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
              riskZAR,
              2
            )

        },

        chart:

          m1
          .slice(
            -120
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
          )

      });


  } catch (error) {

    console.error(
      "SCALPER ERROR:",
      error
    );


    return res
      .status(500)
      .json({

        success:
          false,

        error:
          errorText(
            error
          )

      });
  }
}