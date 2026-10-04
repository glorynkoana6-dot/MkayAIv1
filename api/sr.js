/* =========================================================
   MKAYFX MULTI-ASSET S&R SCALPER V2
   /api/sr.js

   ASSETS
   ------
   XAU/USD
   BTC/USD

   EXECUTION
   ---------
   M1

   CONFIRMATION
   ------------
   M5
   M15

   REQUIRED VERCEL ENVIRONMENT VARIABLE
   ------------------------------------
   TWELVE_DATA_API_KEY
========================================================= */

const API_KEY =
  process.env.TWELVE_DATA_API_KEY;

const BASE_URL =
  "https://api.twelvedata.com";


/* =========================================================
   SUPPORTED ASSETS
========================================================= */

const ASSETS = {

  "XAU/USD": {

    name:
      "GOLD",

    short:
      "XAU",

    digits:
      2,

    backtestCostR:
      0.05

  },

  "BTC/USD": {

    name:
      "BITCOIN",

    short:
      "BTC",

    digits:
      2,

    backtestCostR:
      0.06

  }

};


/* =========================================================
   SETTINGS
========================================================= */

const CFG = {

  M1_BARS:
    900,

  M5_BARS:
    400,

  M15_BARS:
    300,

  ATR_LEN:
    14,

  RSI_LEN:
    14,

  EMA_FAST:
    20,

  EMA_MID:
    50,

  EMA_SLOW:
    200,

  PIVOT_LEN:
    5,

  MAX_LEVELS:
    8,

  LEVEL_LOOKBACK:
    260,

  LEVEL_MERGE_ATR:
    0.35,

  TOUCH_ATR:
    0.28,

  SWEEP_MIN_ATR:
    0.04,

  SWEEP_MAX_ATR:
    1.20,

  STOP_BUFFER_ATR:
    0.22,

  MIN_STOP_ATR:
    0.75,

  MAX_STOP_ATR:
    2.20,

  TP1_R:
    1.50,

  TP2_R:
    2.20,

  MIN_SIGNAL_SCORE:
    68,

  STRONG_SIGNAL_SCORE:
    80,

  SCORE_SEPARATION:
    8,

  COOLDOWN_BARS:
    6,

  BACKTEST_LOOKBACK:
    650,

  BACKTEST_MAX_HOLD:
    45

};


/* =========================================================
   HELPERS
========================================================= */

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


function num(
  value
) {

  const n =
    Number(
      value
    );

  return Number.isFinite(
    n
  )
    ? n
    : null;

}


function round(
  value,
  digits = 2
) {

  const n =
    num(
      value
    );

  if (
    n === null
  ) {

    return null;

  }

  return Number(
    n.toFixed(
      digits
    )
  );

}


function mean(
  values
) {

  const clean =
    values.filter(
      Number.isFinite
    );

  if (
    !clean.length
  ) {

    return null;

  }

  return clean.reduce(
    (
      total,
      value
    ) =>
      total + value,
    0
  ) / clean.length;

}


function safeError(
  value
) {

  if (
    value == null
  ) {

    return "";
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
      String(
        value
      )
    );
  }

  if (
    typeof value ===
    "object"
  ) {

    const nested =

      value.message

      ??

      value.error

      ??

      value.detail

      ??

      value.description;


    if (
      nested !== undefined &&
      nested !== value
    ) {

      return safeError(
        nested
      );
    }

    try {

      return JSON.stringify(
        value
      );

    } catch {

      return String(
        value
      );
    }

  }

  return String(
    value
  );

}


/* =========================================================
   SYMBOL NORMALIZATION
========================================================= */

function normalizeSymbol(
  value
) {

  const raw =
    String(
      value ||
      "XAU/USD"
    )
      .trim()
      .toUpperCase();


  const aliases = {

    XAUUSD:
      "XAU/USD",

    GOLD:
      "XAU/USD",

    XAU:
      "XAU/USD",

    BTCUSD:
      "BTC/USD",

    BITCOIN:
      "BTC/USD",

    BTC:
      "BTC/USD"

  };


  const symbol =
    aliases[
      raw
    ]
    ||
    raw;


  return ASSETS[
    symbol
  ]
    ? symbol
    : "XAU/USD";

}


/* =========================================================
   TIME
========================================================= */

function parseTime(
  value
) {

  if (
    !value
  ) {

    return NaN;
  }


  const text =
    String(
      value
    )
      .trim()
      .replace(
        " ",
        "T"
      );


  return new Date(

    /Z$|[+-]\d\d:\d\d$/.test(
      text
    )

      ? text

      : `${text}Z`

  ).getTime();

}


function minutesOld(
  value
) {

  const timestamp =
    parseTime(
      value
    );

  if (
    !Number.isFinite(
      timestamp
    )
  ) {

    return null;
  }


  return Math.max(

    0,

    (
      Date.now() -
      timestamp
    )
    /
    60000

  );

}


/* =========================================================
   HTTP
========================================================= */

async function getJSON(
  url,
  timeout = 18000
) {

  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeout
    );


  try {

    const response =
      await fetch(
        url,
        {

          signal:
            controller.signal,

          headers: {

            Accept:
              "application/json"

          }

        }
      );


    const raw =
      await response.text();


    let data =
      {};


    if (
      raw
    ) {

      try {

        data =
          JSON.parse(
            raw
          );

      } catch {

        throw new Error(

          `Provider returned non-JSON HTTP ${response.status}: ${raw.slice(0, 250)}`

        );
      }

    }


    if (

      !response.ok

      ||

      data?.status ===
      "error"

    ) {

      throw new Error(

        safeError(
          data?.message
        )

        ||

        safeError(
          data?.error
        )

        ||

        `HTTP ${response.status}`

      );
    }


    return data;

  } catch (
    error
  ) {

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

    clearTimeout(
      timer
    );
  }

}


/* =========================================================
   FETCH CANDLES
========================================================= */

async function fetchSeries(
  symbol,
  interval,
  outputsize
) {

  if (
    !API_KEY
  ) {

    throw new Error(

      "TWELVE_DATA_API_KEY is missing in Vercel Environment Variables."

    );
  }


  const query =
    new URLSearchParams({

      symbol,

      interval,

      outputsize:
        String(
          outputsize
        ),

      timezone:
        "UTC",

      format:
        "JSON",

      apikey:
        API_KEY

    });


  const data =
    await getJSON(

      `${BASE_URL}/time_series?${query.toString()}`

    );


  if (
    !Array.isArray(
      data.values
    )
  ) {

    throw new Error(

      `${symbol} ${interval}: no candles returned.`

    );
  }


  const bars =

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
        bar =>
          [
            bar.open,
            bar.high,
            bar.low,
            bar.close
          ]
            .every(
              Number.isFinite
            )
      )

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


  if (
    bars.length <
    100
  ) {

    throw new Error(

      `${symbol} ${interval}: only ${bars.length} usable candles returned.`

    );
  }


  return bars;

}


/* =========================================================
   LIVE QUOTE
========================================================= */

async function fetchQuote(
  symbol
) {

  const query =
    new URLSearchParams({

      symbol,

      apikey:
        API_KEY

    });


  const data =
    await getJSON(

      `${BASE_URL}/quote?${query.toString()}`

    );


  const price =
    num(

      data.close

      ??

      data.price

      ??

      data.previous_close

    );


  if (
    price === null
  ) {

    throw new Error(

      `${symbol}: live quote unavailable.`

    );
  }


  return {

    price,

    time:

      data.datetime

      ??

      data.timestamp

      ??

      null

  };

}


/* =========================================================
   INDICATORS
========================================================= */

function emaSeries(
  values,
  period
) {

  if (
    !values.length
  ) {

    return [];
  }


  const k =
    2 /
    (
      period +
      1
    );


  const result =
    [];


  let current =
    values[0];


  result.push(
    current
  );


  for (
    let i = 1;
    i < values.length;
    i++
  ) {

    current =

      values[i] *
      k

      +

      current *
      (
        1 -
        k
      );


    result.push(
      current
    );
  }


  return result;

}


function emaAt(
  bars,
  index,
  period
) {

  if (
    index <
    period -
    1
  ) {

    return null;
  }


  const start =
    Math.max(
      0,
      index -
      period *
      5
    );


  const values =

    bars
      .slice(
        start,
        index + 1
      )
      .map(
        bar =>
          bar.close
      );


  if (
    values.length <
    period
  ) {

    return null;
  }


  return emaSeries(
    values,
    period
  ).at(-1);

}


function trueRange(
  bars,
  index
) {

  if (
    index === 0
  ) {

    return Math.max(

      bars[index].high -
      bars[index].low,

      1e-9

    );
  }


  return Math.max(

    bars[index].high -
    bars[index].low,

    Math.abs(

      bars[index].high -
      bars[index - 1].close

    ),

    Math.abs(

      bars[index].low -
      bars[index - 1].close

    )

  );

}


function atrAt(
  bars,
  index,
  period = CFG.ATR_LEN
) {

  if (
    index <
    period
  ) {

    return null;
  }


  const values =
    [];


  for (
    let i =
      index -
      period +
      1;

    i <=
      index;

    i++
  ) {

    values.push(

      trueRange(
        bars,
        i
      )

    );
  }


  return mean(
    values
  );

}


function rsiAt(
  bars,
  index,
  period = CFG.RSI_LEN
) {

  if (
    index <=
    period
  ) {

    return 50;
  }


  let gains =
    0;


  let losses =
    0;


  for (
    let i =
      index -
      period +
      1;

    i <=
      index;

    i++
  ) {

    const difference =

      bars[i].close

      -

      bars[i - 1].close;


    if (
      difference >
      0
    ) {

      gains +=
        difference;

    } else {

      losses -=
        difference;
    }

  }


  if (
    losses ===
    0
  ) {

    return 100;
  }


  const rs =
    gains /
    losses;


  return (

    100

    -

    100 /
    (
      1 +
      rs
    )

  );

}


/* =========================================================
   PIVOT DETECTION
========================================================= */

function pivotLow(
  bars,
  center,
  length
) {

  if (

    center <
    length

    ||

    center +
    length >=
    bars.length

  ) {

    return false;
  }


  const price =
    bars[
      center
    ].low;


  for (
    let i =
      center -
      length;

    i <=
      center +
      length;

    i++
  ) {

    if (

      i !==
      center

      &&

      bars[i].low <
      price

    ) {

      return false;
    }

  }


  return true;

}


function pivotHigh(
  bars,
  center,
  length
) {

  if (

    center <
    length

    ||

    center +
    length >=
    bars.length

  ) {

    return false;
  }


  const price =
    bars[
      center
    ].high;


  for (
    let i =
      center -
      length;

    i <=
      center +
      length;

    i++
  ) {

    if (

      i !==
      center

      &&

      bars[i].high >
      price

    ) {

      return false;
    }

  }


  return true;

}


/* =========================================================
   LEVEL MERGING
========================================================= */

function mergeLevels(
  levels,
  atr
) {

  const merged =
    [];


  const tolerance =
    Math.max(

      atr *
      CFG.LEVEL_MERGE_ATR,

      0.000001

    );


  for (
    const level
    of levels
  ) {

    const existing =

      merged.find(
        item =>
          Math.abs(

            item.price -
            level.price

          )
          <=
          tolerance
      );


    if (
      existing
    ) {

      const touches =
        existing.touches;


      existing.price =

        (
          existing.price *
          touches

          +

          level.price
        )

        /

        (
          touches +
          1
        );


      existing.touches++;


      existing.center =
        Math.max(

          existing.center,

          level.center

        );

    } else {

      merged.push(
        {
          ...level
        }
      );
    }

  }


  merged.sort(
    (
      a,
      b
    ) =>
      b.center -
      a.center
  );


  return merged.slice(
    0,
    CFG.MAX_LEVELS
  );

}


/* =========================================================
   CONFIRMED S&R LEVELS

   IMPORTANT:
   The pivot must already have PIVOT_LEN candles to its right.
========================================================= */

function confirmedLevels(
  bars,
  index,
  atr
) {

  const supports =
    [];


  const resistances =
    [];


  const length =
    CFG.PIVOT_LEN;


  const latestCenter =
    index -
    length;


  const earliest =
    Math.max(

      length,

      latestCenter -
      CFG.LEVEL_LOOKBACK

    );


  for (
    let center =
      latestCenter;

    center >=
      earliest;

    center--
  ) {

    if (
      pivotLow(
        bars,
        center,
        length
      )
    ) {

      supports.push({

        price:
          bars[
            center
          ].low,

        center,

        time:
          bars[
            center
          ].time,

        touches:
          1

      });
    }


    if (
      pivotHigh(
        bars,
        center,
        length
      )
    ) {

      resistances.push({

        price:
          bars[
            center
          ].high,

        center,

        time:
          bars[
            center
          ].time,

        touches:
          1

      });
    }

  }


  return {

    supports:
      mergeLevels(
        supports,
        atr
      ),

    resistances:
      mergeLevels(
        resistances,
        atr
      )

  };

}


/* =========================================================
   NEAREST SUPPORT
========================================================= */

function nearestSupport(
  supports,
  price,
  atr
) {

  const valid =

    supports

      .filter(
        level =>
          level.price <=
          price +
          atr *
          CFG.TOUCH_ATR
      )

      .sort(
        (
          a,
          b
        ) =>
          Math.abs(
            a.price -
            price
          )
          -
          Math.abs(
            b.price -
            price
          )
      );


  return valid[0] ||
    null;

}


/* =========================================================
   NEAREST RESISTANCE
========================================================= */

function nearestResistance(
  resistances,
  price,
  atr
) {

  const valid =

    resistances

      .filter(
        level =>
          level.price >=
          price -
          atr *
          CFG.TOUCH_ATR
      )

      .sort(
        (
          a,
          b
        ) =>
          Math.abs(
            a.price -
            price
          )
          -
          Math.abs(
            b.price -
            price
          )
      );


  return valid[0] ||
    null;

}


/* =========================================================
   CANDLE STATS
========================================================= */

function candleStats(
  bar
) {

  const range =
    Math.max(

      bar.high -
      bar.low,

      1e-9

    );


  const body =
    Math.abs(

      bar.close -
      bar.open

    );


  const upperWick =

    bar.high

    -

    Math.max(

      bar.open,

      bar.close

    );


  const lowerWick =

    Math.min(

      bar.open,

      bar.close

    )

    -

    bar.low;


  return {

    range,

    body,

    bodyRatio:
      body /
      range,

    upperWick,

    lowerWick,

    closePosition:

      (
        bar.close -
        bar.low
      )
      /
      range,

    bullish:
      bar.close >
      bar.open,

    bearish:
      bar.close <
      bar.open

  };

}


/* =========================================================
   HIGHER TF SNAPSHOT
========================================================= */

function timeframeSnapshot(
  bars
) {

  const index =
    bars.length -
    1;


  const price =
    bars[
      index
    ].close;


  const ema20 =
    emaAt(
      bars,
      index,
      20
    );


  const ema50 =
    emaAt(
      bars,
      index,
      50
    );


  const ema200 =
    emaAt(
      bars,
      index,
      200
    );


  const rsi =
    rsiAt(
      bars,
      index,
      14
    );


  let score =
    0;


  if (
    ema20 !== null
  ) {

    score +=

      price >
      ema20

        ? 1
        : -1;
  }


  if (
    ema20 !== null &&
    ema50 !== null
  ) {

    score +=

      ema20 >
      ema50

        ? 1
        : -1;
  }


  if (
    ema50 !== null &&
    ema200 !== null
  ) {

    score +=

      ema50 >
      ema200

        ? 1
        : -1;
  }


  if (
    rsi >=
    55
  ) {

    score +=
      1;

  } else if (
    rsi <=
    45
  ) {

    score -=
      1;
  }


  return {

    price:
      round(
        price,
        2
      ),

    ema20:
      round(
        ema20,
        2
      ),

    ema50:
      round(
        ema50,
        2
      ),

    ema200:
      round(
        ema200,
        2
      ),

    rsi:
      round(
        rsi,
        1
      ),

    score,

    bias:

      score >=
      2

        ? "BULLISH"

        : score <=
          -2

          ? "BEARISH"

          : "NEUTRAL"

  };

}


/* =========================================================
   MAIN SIGNAL ENGINE
========================================================= */

function analyzeAt(
  bars,
  index,
  higher = null
) {

  if (
    index <
    220
  ) {

    return null;
  }


  const bar =
    bars[
      index
    ];


  const previous =
    bars[
      index -
      1
    ];


  const atr =
    atrAt(
      bars,
      index
    );


  if (

    !Number.isFinite(
      atr
    )

    ||

    atr <=
    0

  ) {

    return null;
  }


  const levels =
    confirmedLevels(

      bars,

      index,

      atr

    );


  const support =
    nearestSupport(

      levels.supports,

      bar.close,

      atr

    );


  const resistance =
    nearestResistance(

      levels.resistances,

      bar.close,

      atr

    );


  const stats =
    candleStats(
      bar
    );


  const ema20 =
    emaAt(
      bars,
      index,
      CFG.EMA_FAST
    );


  const ema50 =
    emaAt(
      bars,
      index,
      CFG.EMA_MID
    );


  const ema200 =
    emaAt(
      bars,
      index,
      CFG.EMA_SLOW
    );


  const rsi =
    rsiAt(
      bars,
      index
    );


  /* =======================================================
     BULLISH S&R CONDITIONS
  ======================================================= */

  let supportTouch =
    false;


  let bullishSweep =
    false;


  let bullishRejection =
    false;


  let bullishReclaim =
    false;


  if (
    support
  ) {

    supportTouch =

      bar.low <=
      support.price +
      atr *
      CFG.TOUCH_ATR;


    const penetration =

      support.price -
      bar.low;


    bullishSweep =

      penetration >=
      atr *
      CFG.SWEEP_MIN_ATR

      &&

      penetration <=
      atr *
      CFG.SWEEP_MAX_ATR

      &&

      bar.close >
      support.price;


    bullishRejection =

      supportTouch

      &&

      stats.closePosition >=
      0.60

      &&

      stats.lowerWick >=
      Math.max(

        stats.body *
        0.70,

        atr *
        0.08

      );


    bullishReclaim =

      previous.close <
      support.price

      &&

      bar.close >
      support.price

      &&

      stats.bullish;

  }


  /* =======================================================
     BEARISH S&R CONDITIONS
  ======================================================= */

  let resistanceTouch =
    false;


  let bearishSweep =
    false;


  let bearishRejection =
    false;


  let bearishReclaim =
    false;


  if (
    resistance
  ) {

    resistanceTouch =

      bar.high >=
      resistance.price -
      atr *
      CFG.TOUCH_ATR;


    const penetration =

      bar.high -
      resistance.price;


    bearishSweep =

      penetration >=
      atr *
      CFG.SWEEP_MIN_ATR

      &&

      penetration <=
      atr *
      CFG.SWEEP_MAX_ATR

      &&

      bar.close <
      resistance.price;


    bearishRejection =

      resistanceTouch

      &&

      stats.closePosition <=
      0.40

      &&

      stats.upperWick >=
      Math.max(

        stats.body *
        0.70,

        atr *
        0.08

      );


    bearishReclaim =

      previous.close >
      resistance.price

      &&

      bar.close <
      resistance.price

      &&

      stats.bearish;

  }


  /* =======================================================
     TREND
  ======================================================= */

  const bullishTrend =

    ema20 !== null

    &&

    ema50 !== null

    &&

    bar.close >
    ema20

    &&

    ema20 >=
    ema50;


  const bearishTrend =

    ema20 !== null

    &&

    ema50 !== null

    &&

    bar.close <
    ema20

    &&

    ema20 <=
    ema50;


  const majorBull =

    ema200 === null

    ||

    bar.close >
    ema200;


  const majorBear =

    ema200 === null

    ||

    bar.close <
    ema200;


  /* =======================================================
     BUY SCORE
  ======================================================= */

  let buyScore =
    0;


  const buyReasons =
    [];


  if (
    support
  ) {

    buyScore +=
      8;


    buyScore +=
      Math.min(

        support.touches *
        3,

        12

      );


    buyReasons.push(

      `Support ${round(support.price, 2)} · ${support.touches} touch${support.touches === 1 ? "" : "es"}`

    );
  }


  if (
    supportTouch
  ) {

    buyScore +=
      10;


    buyReasons.push(
      "Price tested support"
    );
  }


  if (
    bullishSweep
  ) {

    buyScore +=
      20;


    buyReasons.push(
      "Sell-side liquidity sweep recovered"
    );
  }


  if (
    bullishRejection
  ) {

    buyScore +=
      14;


    buyReasons.push(
      "Bullish rejection candle at support"
    );
  }


  if (
    bullishReclaim
  ) {

    buyScore +=
      9;


    buyReasons.push(
      "Support reclaim confirmed"
    );
  }


  if (
    bullishTrend
  ) {

    buyScore +=
      10;


    buyReasons.push(
      "M1 trend bullish"
    );
  }


  if (
    majorBull
  ) {

    buyScore +=
      5;
  }


  if (

    rsi >=
    50

    &&

    rsi <=
    72

  ) {

    buyScore +=
      7;
  }


  if (

    stats.bullish

    &&

    stats.bodyRatio >=
    0.45

  ) {

    buyScore +=
      7;
  }


  if (
    previous.close <
    bar.close
  ) {

    buyScore +=
      4;
  }


  /* =======================================================
     SELL SCORE
  ======================================================= */

  let sellScore =
    0;


  const sellReasons =
    [];


  if (
    resistance
  ) {

    sellScore +=
      8;


    sellScore +=
      Math.min(

        resistance.touches *
        3,

        12

      );


    sellReasons.push(

      `Resistance ${round(resistance.price, 2)} · ${resistance.touches} touch${resistance.touches === 1 ? "" : "es"}`

    );
  }


  if (
    resistanceTouch
  ) {

    sellScore +=
      10;


    sellReasons.push(
      "Price tested resistance"
    );
  }


  if (
    bearishSweep
  ) {

    sellScore +=
      20;


    sellReasons.push(
      "Buy-side liquidity sweep rejected"
    );
  }


  if (
    bearishRejection
  ) {

    sellScore +=
      14;


    sellReasons.push(
      "Bearish rejection candle at resistance"
    );
  }


  if (
    bearishReclaim
  ) {

    sellScore +=
      9;


    sellReasons.push(
      "Resistance rejection confirmed"
    );
  }


  if (
    bearishTrend
  ) {

    sellScore +=
      10;


    sellReasons.push(
      "M1 trend bearish"
    );
  }


  if (
    majorBear
  ) {

    sellScore +=
      5;
  }


  if (

    rsi <=
    50

    &&

    rsi >=
    28

  ) {

    sellScore +=
      7;
  }


  if (

    stats.bearish

    &&

    stats.bodyRatio >=
    0.45

  ) {

    sellScore +=
      7;
  }


  if (
    previous.close >
    bar.close
  ) {

    sellScore +=
      4;
  }


  /* =======================================================
     M5 + M15 CONFIRMATION
  ======================================================= */

  if (
    higher
  ) {

    if (
      higher.m5 ===
      "BULLISH"
    ) {

      buyScore +=
        8;


      sellScore -=
        5;


      buyReasons.push(
        "M5 bullish confirmation"
      );
    }


    if (
      higher.m5 ===
      "BEARISH"
    ) {

      sellScore +=
        8;


      buyScore -=
        5;


      sellReasons.push(
        "M5 bearish confirmation"
      );
    }


    if (
      higher.m15 ===
      "BULLISH"
    ) {

      buyScore +=
        8;


      sellScore -=
        4;


      buyReasons.push(
        "M15 bullish confirmation"
      );
    }


    if (
      higher.m15 ===
      "BEARISH"
    ) {

      sellScore +=
        8;


      buyScore -=
        4;


      sellReasons.push(
        "M15 bearish confirmation"
      );
    }

  }


  buyScore =
    clamp(

      Math.round(
        buyScore
      ),

      0,

      100

    );


  sellScore =
    clamp(

      Math.round(
        sellScore
      ),

      0,

      100

    );


  /* =======================================================
     DECISION
  ======================================================= */

  let signal =
    "WAIT";


  let score =
    Math.max(

      buyScore,

      sellScore

    );


  let reasons =
    [];


  const bullishTrigger =

    bullishSweep

    ||

    bullishRejection

    ||

    bullishReclaim;


  const bearishTrigger =

    bearishSweep

    ||

    bearishRejection

    ||

    bearishReclaim;


  if (

    buyScore >=
    CFG.MIN_SIGNAL_SCORE

    &&

    buyScore >=
    sellScore +
    CFG.SCORE_SEPARATION

    &&

    support

    &&

    bullishTrigger

  ) {

    signal =
      "BUY";


    score =
      buyScore;


    reasons =
      buyReasons;
  }


  if (

    sellScore >=
    CFG.MIN_SIGNAL_SCORE

    &&

    sellScore >=
    buyScore +
    CFG.SCORE_SEPARATION

    &&

    resistance

    &&

    bearishTrigger

  ) {

    signal =
      "SELL";


    score =
      sellScore;


    reasons =
      sellReasons;
  }


  if (
    signal ===
    "WAIT"
  ) {

    reasons = [

      `BUY score ${buyScore}/100`,

      `SELL score ${sellScore}/100`,

      bullishTrigger
        ? "Bullish reaction detected, but confirmation is insufficient."
        : bearishTrigger
          ? "Bearish reaction detected, but confirmation is insufficient."
          : "Waiting for a fresh liquidity reaction at support or resistance."

    ];
  }


  /* =======================================================
     ENTRY / SL / TP
  ======================================================= */

  let entry =
    null;


  let stopLoss =
    null;


  let tp1 =
    null;


  let tp2 =
    null;


  let risk =
    null;


  if (
    signal ===
    "BUY"
  ) {

    entry =
      bar.close;


    const rawStop =

      Math.min(

        support.price,

        bar.low

      )

      -

      atr *
      CFG.STOP_BUFFER_ATR;


    const minimumRisk =
      atr *
      CFG.MIN_STOP_ATR;


    const maximumRisk =
      atr *
      CFG.MAX_STOP_ATR;


    risk =
      clamp(

        entry -
        rawStop,

        minimumRisk,

        maximumRisk

      );


    stopLoss =
      entry -
      risk;


    tp1 =
      entry +
      risk *
      CFG.TP1_R;


    tp2 =
      entry +
      risk *
      CFG.TP2_R;

  }


  if (
    signal ===
    "SELL"
  ) {

    entry =
      bar.close;


    const rawStop =

      Math.max(

        resistance.price,

        bar.high

      )

      +

      atr *
      CFG.STOP_BUFFER_ATR;


    const minimumRisk =
      atr *
      CFG.MIN_STOP_ATR;


    const maximumRisk =
      atr *
      CFG.MAX_STOP_ATR;


    risk =
      clamp(

        rawStop -
        entry,

        minimumRisk,

        maximumRisk

      );


    stopLoss =
      entry +
      risk;


    tp1 =
      entry -
      risk *
      CFG.TP1_R;


    tp2 =
      entry -
      risk *
      CFG.TP2_R;

  }


  return {

    signal,

    score,

    buyScore,

    sellScore,

    reasons,

    entry,

    stopLoss,

    tp1,

    tp2,

    risk,

    atr,

    rsi,

    ema20,

    ema50,

    ema200,

    support,

    resistance,

    supportTouch,

    resistanceTouch,

    bullishSweep,

    bearishSweep,

    bullishRejection,

    bearishRejection,

    bullishReclaim,

    bearishReclaim

  };

}


/* =========================================================
   BACKTEST
========================================================= */

function backtest(
  bars,
  costPerTradeR
) {

  const trades =
    [];


  const lastIndex =
    bars.length -
    1;


  const start =
    Math.max(

      230,

      bars.length -
      CFG.BACKTEST_LOOKBACK

    );


  let nextAllowed =
    start;


  for (
    let i =
      start;

    i <
      lastIndex -
      CFG.BACKTEST_MAX_HOLD;

    i++
  ) {

    if (
      i <
      nextAllowed
    ) {

      continue;
    }


    const setup =
      analyzeAt(

        bars,

        i,

        null

      );


    if (

      !setup

      ||

      setup.signal ===
      "WAIT"

      ||

      !Number.isFinite(
        setup.entry
      )

      ||

      !Number.isFinite(
        setup.stopLoss
      )

      ||

      !Number.isFinite(
        setup.tp2
      )

    ) {

      continue;
    }


    const risk =
      Math.abs(

        setup.entry -
        setup.stopLoss

      );


    if (
      risk <=
      0
    ) {

      continue;
    }


    let result =
      null;


    let exitIndex =
      null;


    let exitPrice =
      null;


    let resultR =
      null;


    for (
      let j =
        i +
        1;

      j <=
        Math.min(

          i +
          CFG.BACKTEST_MAX_HOLD,

          lastIndex

        );

      j++
    ) {

      const candle =
        bars[j];


      if (
        setup.signal ===
        "BUY"
      ) {

        const stopHit =

          candle.low <=
          setup.stopLoss;


        const targetHit =

          candle.high >=
          setup.tp2;


        if (
          stopHit
        ) {

          result =
            "LOSS";


          exitIndex =
            j;


          exitPrice =
            setup.stopLoss;


          resultR =

            -1

            -

            costPerTradeR;


          break;
        }


        if (
          targetHit
        ) {

          result =
            "WIN";


          exitIndex =
            j;


          exitPrice =
            setup.tp2;


          resultR =

            CFG.TP2_R

            -

            costPerTradeR;


          break;
        }

      }


      if (
        setup.signal ===
        "SELL"
      ) {

        const stopHit =

          candle.high >=
          setup.stopLoss;


        const targetHit =

          candle.low <=
          setup.tp2;


        if (
          stopHit
        ) {

          result =
            "LOSS";


          exitIndex =
            j;


          exitPrice =
            setup.stopLoss;


          resultR =

            -1

            -

            costPerTradeR;


          break;
        }


        if (
          targetHit
        ) {

          result =
            "WIN";


          exitIndex =
            j;


          exitPrice =
            setup.tp2;


          resultR =

            CFG.TP2_R

            -

            costPerTradeR;


          break;
        }

      }

    }


    /* TIME EXIT */

    if (
      !result
    ) {

      exitIndex =
        Math.min(

          i +
          CFG.BACKTEST_MAX_HOLD,

          lastIndex

        );


      exitPrice =
        bars[
          exitIndex
        ].close;


      let rawR =

        setup.signal ===
        "BUY"

          ?

          (
            exitPrice -
            setup.entry
          )
          /
          risk

          :

          (
            setup.entry -
            exitPrice
          )
          /
          risk;


      rawR =
        clamp(

          rawR,

          -1,

          CFG.TP2_R

        );


      resultR =

        rawR

        -

        costPerTradeR;


      result =

        resultR >
        0

          ? "WIN"

          : "LOSS";

    }


    trades.push({

      signal:
        setup.signal,

      score:
        setup.score,

      entryTime:
        bars[
          i
        ].time,

      exitTime:
        bars[
          exitIndex
        ].time,

      entry:
        round(
          setup.entry,
          2
        ),

      stop:
        round(
          setup.stopLoss,
          2
        ),

      target:
        round(
          setup.tp2,
          2
        ),

      exit:
        round(
          exitPrice,
          2
        ),

      result,

      r:
        round(
          resultR,
          2
        )

    });


    nextAllowed =

      exitIndex

      +

      CFG.COOLDOWN_BARS;

  }


  const wins =

    trades.filter(
      trade =>
        trade.r >
        0
    );


  const losses =

    trades.filter(
      trade =>
        trade.r <=
        0
    );


  const grossProfit =

    wins.reduce(
      (
        total,
        trade
      ) =>
        total +
        trade.r,
      0
    );


  const grossLoss =

    Math.abs(

      losses.reduce(
        (
          total,
          trade
        ) =>
          total +
          trade.r,
        0
      )

    );


  const netR =

    trades.reduce(
      (
        total,
        trade
      ) =>
        total +
        trade.r,
      0
    );


  const expectancy =

    trades.length

      ?

      netR /
      trades.length

      :

      0;


  const profitFactor =

    grossLoss >
    0

      ?

      grossProfit /
      grossLoss

      :

      grossProfit >
      0

        ? 999

        : 0;


  let equity =
    0;


  let peak =
    0;


  let maxDrawdown =
    0;


  let currentLossStreak =
    0;


  let maxLossStreak =
    0;


  for (
    const trade
    of trades
  ) {

    equity +=
      trade.r;


    peak =
      Math.max(

        peak,

        equity

      );


    maxDrawdown =
      Math.max(

        maxDrawdown,

        peak -
        equity

      );


    if (
      trade.r <=
      0
    ) {

      currentLossStreak++;


      maxLossStreak =
        Math.max(

          maxLossStreak,

          currentLossStreak

        );

    } else {

      currentLossStreak =
        0;
    }

  }


  return {

    trades:
      trades.length,

    wins:
      wins.length,

    losses:
      losses.length,

    winRate:

      trades.length

        ?

        round(

          wins.length /
          trades.length *
          100,

          1

        )

        :

        0,

    profitFactor:

      profitFactor ===
      999

        ? 999

        : round(
            profitFactor,
            2
          ),

    netR:
      round(
        netR,
        2
      ),

    expectancyR:
      round(
        expectancy,
        3
      ),

    maxDrawdownR:
      round(
        maxDrawdown,
        2
      ),

    maxLossStreak,

    targetR:
      CFG.TP2_R,

    costPerTradeR,

    recentTrades:

      trades
        .slice(
          -12
        )
        .reverse()

  };

}


/* =========================================================
   SESSION
========================================================= */

function sessionName(
  symbol
) {

  if (
    symbol ===
    "BTC/USD"
  ) {

    return "CRYPTO · 24/7";
  }


  const hour =
    new Date()
      .getUTCHours();


  if (
    hour >=
    8

    &&

    hour <
    12
  ) {

    return "LONDON";
  }


  if (
    hour >=
    12

    &&

    hour <
    16
  ) {

    return "LONDON / NEW YORK";
  }


  if (
    hour >=
    16

    &&

    hour <
    21
  ) {

    return "NEW YORK";
  }


  return "ASIA / QUIET";

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


  res.setHeader(

    "Access-Control-Allow-Origin",

    "*"

  );


  res.setHeader(

    "Access-Control-Allow-Methods",

    "GET,OPTIONS"

  );


  res.setHeader(

    "Access-Control-Allow-Headers",

    "Content-Type"

  );


  if (
    req.method ===
    "OPTIONS"
  ) {

    return res
      .status(204)
      .end();
  }


  try {

    if (
      !API_KEY
    ) {

      throw new Error(

        "TWELVE_DATA_API_KEY is missing in Vercel Environment Variables."

      );
    }


    const requested =

      Array.isArray(
        req.query?.symbol
      )

        ?

        req.query.symbol[0]

        :

        req.query?.symbol;


    const symbol =
      normalizeSymbol(
        requested
      );


    const asset =
      ASSETS[
        symbol
      ];


    const [
      m1,
      m5,
      m15,
      quote
    ] =
      await Promise.all([

        fetchSeries(
          symbol,
          "1min",
          CFG.M1_BARS
        ),

        fetchSeries(
          symbol,
          "5min",
          CFG.M5_BARS
        ),

        fetchSeries(
          symbol,
          "15min",
          CFG.M15_BARS
        ),

        fetchQuote(
          symbol
        )

      ]);


    const m5Snapshot =
      timeframeSnapshot(
        m5
      );


    const m15Snapshot =
      timeframeSnapshot(
        m15
      );


    const higher = {

      m5:
        m5Snapshot.bias,

      m15:
        m15Snapshot.bias

    };


    const latestIndex =
      m1.length -
      1;


    const analysis =
      analyzeAt(

        m1,

        latestIndex,

        higher

      );


    if (
      !analysis
    ) {

      throw new Error(

        "Not enough completed M1 data to analyse."

      );
    }


    const bt =
      backtest(

        m1,

        asset.backtestCostR

      );


    const candleAge =
      minutesOld(
        m1.at(-1)?.time
      );


    let marketState =
      "LIVE";


    if (

      symbol ===
      "XAU/USD"

      &&

      candleAge !==
      null

      &&

      candleAge >
      15

    ) {

      marketState =
        "STALE / MARKET CLOSED";
    }


    if (

      symbol ===
      "BTC/USD"

      &&

      candleAge !==
      null

      &&

      candleAge >
      10

    ) {

      marketState =
        "DATA STALE";
    }


    const levels =
      confirmedLevels(

        m1,

        latestIndex,

        analysis.atr

      );


    return res
      .status(200)
      .json({

        success:
          true,

        engine:
          "MKAYFX MULTI-ASSET S&R V2",

        symbol,

        assetName:
          asset.name,

        assetShort:
          asset.short,

        executionTimeframe:
          "1m",

        generatedAt:
          new Date()
            .toISOString(),

        session:
          sessionName(
            symbol
          ),

        marketState,

        candleAgeMinutes:
          round(
            candleAge,
            1
          ),

        price:
          round(
            quote.price,
            asset.digits
          ),

        signal:
          analysis.signal,

        score:
          analysis.score,

        buyScore:
          analysis.buyScore,

        sellScore:
          analysis.sellScore,

        signalQuality:

          analysis.score >=
          CFG.STRONG_SIGNAL_SCORE

            ? "STRONG"

            : analysis.signal ===
              "WAIT"

              ? "WAIT"

              : "VALID",

        entry:
          round(
            analysis.entry,
            asset.digits
          ),

        stopLoss:
          round(
            analysis.stopLoss,
            asset.digits
          ),

        tp1:
          round(
            analysis.tp1,
            asset.digits
          ),

        tp2:
          round(
            analysis.tp2,
            asset.digits
          ),

        risk:
          round(
            analysis.risk,
            asset.digits
          ),

        rr1:
          CFG.TP1_R,

        rr2:
          CFG.TP2_R,

        support:

          analysis.support

            ?

            {

              price:
                round(
                  analysis.support.price,
                  asset.digits
                ),

              touches:
                analysis.support.touches,

              time:
                analysis.support.time

            }

            :

            null,

        resistance:

          analysis.resistance

            ?

            {

              price:
                round(
                  analysis.resistance.price,
                  asset.digits
                ),

              touches:
                analysis.resistance.touches,

              time:
                analysis.resistance.time

            }

            :

            null,

        indicators: {

          atr:
            round(
              analysis.atr,
              asset.digits
            ),

          rsi:
            round(
              analysis.rsi,
              1
            ),

          ema20:
            round(
              analysis.ema20,
              asset.digits
            ),

          ema50:
            round(
              analysis.ema50,
              asset.digits
            ),

          ema200:
            round(
              analysis.ema200,
              asset.digits
            )

        },

        confirmations: {

          supportTouch:
            analysis.supportTouch,

          resistanceTouch:
            analysis.resistanceTouch,

          bullishSweep:
            analysis.bullishSweep,

          bearishSweep:
            analysis.bearishSweep,

          bullishRejection:
            analysis.bullishRejection,

          bearishRejection:
            analysis.bearishRejection,

          bullishReclaim:
            analysis.bullishReclaim,

          bearishReclaim:
            analysis.bearishReclaim

        },

        higherTimeframes: {

          M5:
            m5Snapshot,

          M15:
            m15Snapshot

        },

        reasons:
          analysis.reasons,

        backtest:
          bt,

        levels: {

          supports:

            levels.supports.map(
              level => ({

                price:
                  round(
                    level.price,
                    asset.digits
                  ),

                touches:
                  level.touches

              })
            ),

          resistances:

            levels.resistances.map(
              level => ({

                price:
                  round(
                    level.price,
                    asset.digits
                  ),

                touches:
                  level.touches

              })
            )

        },

        chart:

          m1
            .slice(
              -180
            )
            .map(
              bar => ({

                time:
                  bar.time,

                open:
                  round(
                    bar.open,
                    asset.digits
                  ),

                high:
                  round(
                    bar.high,
                    asset.digits
                  ),

                low:
                  round(
                    bar.low,
                    asset.digits
                  ),

                close:
                  round(
                    bar.close,
                    asset.digits
                  )

              })
            )

      });

  } catch (
    error
  ) {

    console.error(

      "MKAYFX MULTI-ASSET ERROR",

      error

    );


    return res
      .status(500)
      .json({

        success:
          false,

        engine:
          "MKAYFX MULTI-ASSET S&R V2",

        error:

          safeError(
            error
          )

          ||

          "Unknown S&R engine error."

      });

  }
}