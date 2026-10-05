/* ============================================================
   MKAYFX BTC LIQUIDITY INTELLIGENCE ENGINE V3
   ============================================================

   FILE
   ----
   /api/btc.js

   MARKET
   ------
   BTC-USD

   SOURCE
   ------
   Coinbase Exchange public REST API

   IMPORTANT V3 CHANGES
   --------------------
   - Removed massive Level 2 order-book download
   - Uses Level 1 best bid / ask instead
   - Coinbase recent trades provide delta / CVD
   - Optional endpoints fail gracefully
   - Lower Vercel memory usage
   - Lower Coinbase request load
   - Cleaner error responses
   - 5 core requests only

   TIMEFRAMES
   ----------
   M5  = Coinbase
   M15 = built from M5
   H1  = Coinbase
   H4  = built from H1
   D1  = Coinbase

============================================================ */


const PRODUCT =
  "BTC-USD";


const BASE_URL =
  "https://api.exchange.coinbase.com";


/* ============================================================
   SETTINGS
============================================================ */

const SETTINGS = {

  M5_GRANULARITY:
    300,

  H1_GRANULARITY:
    3600,

  D1_GRANULARITY:
    86400,


  M5_COUNT:
    260,

  H1_COUNT:
    260,

  D1_COUNT:
    35,


  ATR_PERIOD:
    14,

  RSI_PERIOD:
    14,


  EMA_FAST:
    20,

  EMA_MID:
    50,

  EMA_SLOW:
    200,


  SWING_STRENGTH:
    2,


  EQUAL_ATR_TOLERANCE:
    0.12,


  ROUND_STEP:
    1000,

  MAJOR_ROUND_STEP:
    5000,


  TRACKING_SCORE:
    35,

  ARMED_SCORE:
    55,


  SIGNAL_SCORE:
    68,

  SIGNAL_GAP:
    6,


  STOP_ATR:
    0.55,

  TP1_R:
    1.5,

  TP2_R:
    2.5,


  SWEEP_MIN_ATR:
    0.04,

  SWEEP_MAX_ATR:
    0.45,


  VOLUME_LOOKBACK:
    20

};


/* ============================================================
   BASIC HELPERS
============================================================ */

function num(
  value,
  fallback = 0
) {

  const n =
    Number(
      value
    );


  return Number.isFinite(
    n
  )
    ? n
    : fallback;

}


function round(
  value,
  digits = 2
) {

  if (
    value === null ||
    value === undefined
  ) {

    return null;

  }


  const n =
    Number(
      value
    );


  if (
    !Number.isFinite(
      n
    )
  ) {

    return null;

  }


  const power =
    10 **
    digits;


  return (
    Math.round(
      n *
      power
    ) /
    power
  );

}


function average(
  values
) {

  if (
    !Array.isArray(
      values
    ) ||
    !values.length
  ) {

    return 0;

  }


  return (
    values.reduce(
      (
        total,
        value
      ) =>
        total +
        value,
      0
    ) /
    values.length
  );

}


function clamp(
  value,
  minimum,
  maximum
) {

  return Math.max(
    minimum,
    Math.min(
      maximum,
      value
    )
  );

}


/* ============================================================
   ERROR CONVERTER
============================================================ */

function errorText(
  error
) {

  if (
    error === null ||
    error === undefined
  ) {

    return "Unknown error";

  }


  if (
    typeof error ===
    "string"
  ) {

    return error;

  }


  if (
    error instanceof Error
  ) {

    return (
      error.message ||
      error.name ||
      "Unknown Error"
    );

  }


  if (
    typeof error ===
    "object"
  ) {

    if (
      typeof error.message ===
      "string"
    ) {

      return error.message;

    }


    if (
      typeof error.error ===
      "string"
    ) {

      return error.error;

    }


    try {

      return JSON.stringify(
        error
      );

    }

    catch {

      return "Object error";

    }

  }


  return String(
    error
  );

}


/* ============================================================
   HTTP FETCH
============================================================ */

async function getJSON(
  url,
  timeoutMs = 7000
) {

  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () => {

        controller.abort();

      },
      timeoutMs
    );


  try {

    const response =
      await fetch(
        url,
        {

          method:
            "GET",

          headers: {

            Accept:
              "application/json",

            "User-Agent":
              "MKAYFX-BTC-V3"

          },

          signal:
            controller.signal

        }
      );


    const text =
      await response.text();


    let data =
      null;


    try {

      data =
        text
          ? JSON.parse(
            text
          )
          : null;

    }

    catch {

      throw new Error(
        `Invalid Coinbase JSON (${response.status})`
      );

    }


    if (
      !response.ok
    ) {

      let message =
        `Coinbase HTTP ${response.status}`;


      if (
        typeof data?.message ===
        "string"
      ) {

        message =
          data.message;

      }

      else if (
        typeof data?.error ===
        "string"
      ) {

        message =
          data.error;

      }


      throw new Error(
        message
      );

    }


    return data;

  }

  catch (
    error
  ) {

    if (
      error?.name ===
      "AbortError"
    ) {

      throw new Error(
        "Coinbase request timed out"
      );

    }


    throw new Error(
      errorText(
        error
      )
    );

  }

  finally {

    clearTimeout(
      timer
    );

  }

}


/* ============================================================
   SAFE OPTIONAL FETCH

   Optional requests return fallback rather
   than killing the whole engine.
============================================================ */

async function safeFetch(
  promise,
  fallback
) {

  try {

    return await promise;

  }

  catch (
    error
  ) {

    console.error(
      "OPTIONAL COINBASE ERROR:",
      errorText(
        error
      )
    );


    return fallback;

  }

}


/* ============================================================
   COINBASE ENDPOINTS
============================================================ */

async function fetchTicker() {

  return getJSON(

    `${BASE_URL}/products/${PRODUCT}/ticker`

  );

}


async function fetchTrades() {

  return getJSON(

    `${BASE_URL}/products/${PRODUCT}/trades`

  );

}


async function fetchBestBook() {

  return getJSON(

    `${BASE_URL}/products/${PRODUCT}/book?level=1`

  );

}


/* ============================================================
   CANDLES
============================================================ */

async function fetchCandles(
  granularity,
  requestedCount
) {

  const count =
    Math.min(
      Math.max(
        Number(
          requestedCount
        ) ||
        50,
        10
      ),
      280
    );


  const now =
    Math.floor(
      Date.now() /
      1000
    );


  /*
     Keep window safely under Coinbase candle limit.
  */

  const end =
    now;


  const start =
    end -
    granularity *
    count;


  const url =

    `${BASE_URL}` +

    `/products/${PRODUCT}/candles` +

    `?granularity=${granularity}` +

    `&start=${start}` +

    `&end=${end}`;


  const raw =
    await getJSON(
      url
    );


  if (
    !Array.isArray(
      raw
    )
  ) {

    throw new Error(
      "Coinbase candles response is not an array"
    );

  }


  const map =
    new Map();


  for (
    const row of
    raw
  ) {

    if (
      !Array.isArray(
        row
      ) ||
      row.length <
      6
    ) {

      continue;

    }


    const timestamp =
      num(
        row[0]
      ) *
      1000;


    const candle = {

      timestamp,

      low:
        num(
          row[1]
        ),

      high:
        num(
          row[2]
        ),

      open:
        num(
          row[3]
        ),

      close:
        num(
          row[4]
        ),

      volume:
        num(
          row[5]
        )

    };


    if (
      timestamp <=
      0
    ) {

      continue;

    }


    if (
      candle.open <=
      0 ||
      candle.high <=
      0 ||
      candle.low <=
      0 ||
      candle.close <=
      0
    ) {

      continue;

    }


    map.set(
      timestamp,
      candle
    );

  }


  return [
    ...map.values()
  ].sort(
    (
      a,
      b
    ) =>
      a.timestamp -
      b.timestamp
  );

}


/* ============================================================
   RESAMPLING
============================================================ */

function resample(
  candles,
  minutes
) {

  const interval =
    minutes *
    60 *
    1000;


  const buckets =
    new Map();


  for (
    const candle of
    candles
  ) {

    const key =
      Math.floor(
        candle.timestamp /
        interval
      ) *
      interval;


    if (
      !buckets.has(
        key
      )
    ) {

      buckets.set(
        key,
        {

          timestamp:
            key,

          open:
            candle.open,

          high:
            candle.high,

          low:
            candle.low,

          close:
            candle.close,

          volume:
            candle.volume

        }
      );

    }

    else {

      const bucket =
        buckets.get(
          key
        );


      bucket.high =
        Math.max(
          bucket.high,
          candle.high
        );


      bucket.low =
        Math.min(
          bucket.low,
          candle.low
        );


      bucket.close =
        candle.close;


      bucket.volume +=
        candle.volume;

    }

  }


  return [
    ...buckets.values()
  ].sort(
    (
      a,
      b
    ) =>
      a.timestamp -
      b.timestamp
  );

}


/* ============================================================
   EMA
============================================================ */

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


  let current =
    values[0];


  const result =
    [];


  for (
    const value of
    values
  ) {

    current =

      value *
      multiplier +

      current *
      (
        1 -
        multiplier
      );


    result.push(
      current
    );

  }


  return result;

}


/* ============================================================
   RSI
============================================================ */

function calculateRSI(
  closes,
  period = 14
) {

  if (
    closes.length <
    period +
    1
  ) {

    return 50;

  }


  let gains =
    0;


  let losses =
    0;


  const start =
    closes.length -
    period;


  for (
    let i =
      start;
    i <
      closes.length;
    i++
  ) {

    const change =
      closes[i] -
      closes[i - 1];


    if (
      change >
      0
    ) {

      gains +=
        change;

    }

    else if (
      change <
      0
    ) {

      losses +=
        Math.abs(
          change
        );

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

    100 -

    100 /
    (
      1 +
      rs
    )

  );

}


/* ============================================================
   ATR
============================================================ */

function calculateATR(
  candles,
  period = 14
) {

  if (
    candles.length <
    period +
    1
  ) {

    return 0;

  }


  const ranges =
    [];


  for (
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

      );


    ranges.push(
      range
    );

  }


  return average(
    ranges.slice(
      -period
    )
  );

}


/* ============================================================
   TIMEFRAME STRUCTURE
============================================================ */

function detectStructure(
  candles
) {

  if (
    !Array.isArray(
      candles
    ) ||
    candles.length <
    12
  ) {

    return {

      bias:
        "NEUTRAL",

      bull:
        0,

      bear:
        0,

      score:
        0,

      rsi:
        50,

      ema20:
        null,

      ema50:
        null,

      ema200:
        null

    };

  }


  const closes =
    candles.map(
      c =>
        c.close
    );


  const ema20Series =
    emaSeries(
      closes,
      SETTINGS.EMA_FAST
    );


  const ema50Series =
    emaSeries(
      closes,
      SETTINGS.EMA_MID
    );


  const ema200Series =
    emaSeries(
      closes,
      SETTINGS.EMA_SLOW
    );


  const price =
    closes.at(-1);


  const ema20 =
    ema20Series.at(-1);


  const ema50 =
    ema50Series.at(-1);


  const ema200 =
    ema200Series.at(-1);


  let bull =
    0;


  let bear =
    0;


  if (
    price >
    ema20
  ) {

    bull++;

  }

  else {

    bear++;

  }


  if (
    ema20 >
    ema50
  ) {

    bull++;

  }

  else {

    bear++;

  }


  if (
    ema50 >
    ema200
  ) {

    bull++;

  }

  else {

    bear++;

  }


  const recent =
    candles.slice(
      -10
    );


  if (
    recent.length >=
    10
  ) {

    const first =
      recent.slice(
        0,
        5
      );


    const second =
      recent.slice(
        5
      );


    const high1 =
      Math.max(
        ...first.map(
          c =>
            c.high
        )
      );


    const high2 =
      Math.max(
        ...second.map(
          c =>
            c.high
        )
      );


    const low1 =
      Math.min(
        ...first.map(
          c =>
            c.low
        )
      );


    const low2 =
      Math.min(
        ...second.map(
          c =>
            c.low
        )
      );


    if (
      high2 >
      high1 &&
      low2 >
      low1
    ) {

      bull +=
        2;

    }


    if (
      high2 <
      high1 &&
      low2 <
      low1
    ) {

      bear +=
        2;

    }

  }


  let bias =
    "NEUTRAL";


  if (
    bull >
    bear
  ) {

    bias =
      "BULLISH";

  }


  if (
    bear >
    bull
  ) {

    bias =
      "BEARISH";

  }


  return {

    bias,

    bull,

    bear,

    score:
      Math.abs(
        bull -
        bear
      ),

    price:
      round(
        price
      ),

    ema20:
      round(
        ema20
      ),

    ema50:
      round(
        ema50
      ),

    ema200:
      round(
        ema200
      ),

    rsi:
      round(
        calculateRSI(
          closes,
          SETTINGS.RSI_PERIOD
        ),
        1
      )

  };

}


/* ============================================================
   VWAP
============================================================ */

function calculateVWAP(
  candles
) {

  if (
    !candles.length
  ) {

    return null;

  }


  let volume =
    0;


  let priceVolume =
    0;


  for (
    const candle of
    candles
  ) {

    const typicalPrice =
      (
        candle.high +
        candle.low +
        candle.close
      ) /
      3;


    priceVolume +=
      typicalPrice *
      candle.volume;


    volume +=
      candle.volume;

  }


  if (
    volume <=
    0
  ) {

    return null;

  }


  return (
    priceVolume /
    volume
  );

}


/* ============================================================
   TODAY BARS
============================================================ */

function todayBars(
  candles
) {

  const now =
    new Date();


  const midnight =
    Date.UTC(

      now.getUTCFullYear(),

      now.getUTCMonth(),

      now.getUTCDate()

    );


  return candles.filter(
    candle =>
      candle.timestamp >=
      midnight
  );

}


/* ============================================================
   DAILY LEVELS
============================================================ */

function getDailyLevels(
  daily
) {

  if (
    daily.length <
    2
  ) {

    return {

      previousDayHigh:
        null,

      previousDayLow:
        null,

      previousDayClose:
        null,

      dailyOpen:
        null

    };

  }


  const current =
    daily.at(-1);


  const previous =
    daily.at(-2);


  return {

    previousDayHigh:
      previous.high,

    previousDayLow:
      previous.low,

    previousDayClose:
      previous.close,

    dailyOpen:
      current.open

  };

}


/* ============================================================
   WEEK START
============================================================ */

function weekStartUTC(
  timestamp
) {

  const date =
    new Date(
      timestamp
    );


  const day =
    date.getUTCDay();


  const offset =
    day ===
    0
      ? 6
      : day - 1;


  return Date.UTC(

    date.getUTCFullYear(),

    date.getUTCMonth(),

    date.getUTCDate() -
      offset

  );

}


/* ============================================================
   WEEKLY LEVELS
============================================================ */

function getWeeklyLevels(
  daily
) {

  const weeks =
    new Map();


  for (
    const candle of
    daily
  ) {

    const key =
      weekStartUTC(
        candle.timestamp
      );


    if (
      !weeks.has(
        key
      )
    ) {

      weeks.set(
        key,
        []
      );

    }


    weeks.get(
      key
    ).push(
      candle
    );

  }


  const keys =
    [...weeks.keys()]
      .sort(
        (
          a,
          b
        ) =>
          a -
          b
      );


  if (
    keys.length <
    2
  ) {

    return {

      previousWeekHigh:
        null,

      previousWeekLow:
        null,

      weeklyOpen:
        null

    };

  }


  const current =
    weeks.get(
      keys.at(-1)
    );


  const previous =
    weeks.get(
      keys.at(-2)
    );


  return {

    previousWeekHigh:
      Math.max(
        ...previous.map(
          c =>
            c.high
        )
      ),

    previousWeekLow:
      Math.min(
        ...previous.map(
          c =>
            c.low
        )
      ),

    weeklyOpen:
      current[0]
        ?.open ??
      null

  };

}


/* ============================================================
   SESSION LEVELS
============================================================ */

function getSessionLevels(
  candles
) {

  const now =
    new Date();


  const midnight =
    Date.UTC(

      now.getUTCFullYear(),

      now.getUTCMonth(),

      now.getUTCDate()

    );


  function buildWindow(
    startHour,
    endHour
  ) {

    const start =
      midnight +
      startHour *
      3600000;


    const end =
      midnight +
      endHour *
      3600000;


    const bars =
      candles.filter(
        candle =>
          candle.timestamp >=
            start &&
          candle.timestamp <
            end
      );


    if (
      !bars.length
    ) {

      return null;

    }


    return {

      open:
        bars[0].open,

      high:
        Math.max(
          ...bars.map(
            c =>
              c.high
          )
        ),

      low:
        Math.min(
          ...bars.map(
            c =>
              c.low
          )
        ),

      close:
        bars.at(-1)
          .close

    };

  }


  return {

    asia:
      buildWindow(
        0,
        8
      ),

    london:
      buildWindow(
        7,
        16
      ),

    newYork:
      buildWindow(
        13,
        22
      )

  };

}


/* ============================================================
   CURRENT SESSION
============================================================ */

function currentSession() {

  const now =
    new Date();


  const hour =
    now.getUTCHours();


  const day =
    now.getUTCDay();


  const active =
    [];


  if (
    hour >=
      0 &&
    hour <
      8
  ) {

    active.push(
      "ASIA"
    );

  }


  if (
    hour >=
      7 &&
    hour <
      16
  ) {

    active.push(
      "LONDON"
    );

  }


  if (
    hour >=
      13 &&
    hour <
      22
  ) {

    active.push(
      "NEW YORK"
    );

  }


  if (
    !active.length
  ) {

    active.push(
      "CRYPTO 24/7"
    );

  }


  return {

    active,

    utcHour:
      hour,

    weekend:
      day ===
        0 ||
      day ===
        6,

    day:
      [

        "Sunday",

        "Monday",

        "Tuesday",

        "Wednesday",

        "Thursday",

        "Friday",

        "Saturday"

      ][day]

  };

}


/* ============================================================
   SWINGS
============================================================ */

function findSwings(
  candles,
  strength = 2
) {

  const highs =
    [];


  const lows =
    [];


  for (
    let i =
      strength;
    i <
      candles.length -
      strength;
    i++
  ) {

    let high =
      true;


    let low =
      true;


    for (
      let j = 1;
      j <=
        strength;
      j++
    ) {

      if (
        candles[i].high <=
          candles[i - j].high ||
        candles[i].high <=
          candles[i + j].high
      ) {

        high =
          false;

      }


      if (
        candles[i].low >=
          candles[i - j].low ||
        candles[i].low >=
          candles[i + j].low
      ) {

        low =
          false;

      }

    }


    if (
      high
    ) {

      highs.push({

        price:
          candles[i].high,

        timestamp:
          candles[i].timestamp

      });

    }


    if (
      low
    ) {

      lows.push({

        price:
          candles[i].low,

        timestamp:
          candles[i].timestamp

      });

    }

  }


  return {

    highs,

    lows

  };

}


/* ============================================================
   EQUAL LIQUIDITY
============================================================ */

function equalLiquidity(
  swings,
  atr
) {

  const tolerance =
    atr *
    SETTINGS
      .EQUAL_ATR_TOLERANCE;


  const equalHighs =
    [];


  const equalLows =
    [];


  function scan(
    points,
    result
  ) {

    const recent =
      points.slice(
        -20
      );


    for (
      let i = 0;
      i <
        recent.length;
      i++
    ) {

      for (
        let j =
          i +
          1;
        j <
          recent.length;
        j++
      ) {

        if (
          Math.abs(
            recent[i].price -
            recent[j].price
          ) <=
          tolerance
        ) {

          result.push({

            price:
              (
                recent[i].price +
                recent[j].price
              ) /
              2

          });

        }

      }

    }

  }


  scan(
    swings.highs,
    equalHighs
  );


  scan(
    swings.lows,
    equalLows
  );


  return {

    equalHighs:
      equalHighs.slice(
        -5
      ),

    equalLows:
      equalLows.slice(
        -5
      )

  };

}


/* ============================================================
   ROUND NUMBER LIQUIDITY
============================================================ */

function roundNumbers(
  price
) {

  const step =
    SETTINGS
      .ROUND_STEP;


  const majorStep =
    SETTINGS
      .MAJOR_ROUND_STEP;


  return {

    lower:
      Math.floor(
        price /
        step
      ) *
      step,

    upper:
      Math.ceil(
        price /
        step
      ) *
      step,

    majorLower:
      Math.floor(
        price /
        majorStep
      ) *
      majorStep,

    majorUpper:
      Math.ceil(
        price /
        majorStep
      ) *
      majorStep

  };

}


/* ============================================================
   VOLUME ANALYSIS
============================================================ */

function volumeAnalysis(
  candles
) {

  const recent =
    candles.slice(
      -SETTINGS
        .VOLUME_LOOKBACK
    );


  const avg =
    average(
      recent.map(
        candle =>
          candle.volume
      )
    );


  const current =
    candles.at(-1)
      ?.volume ??
    0;


  const ratio =
    avg >
    0
      ? current /
        avg
      : 1;


  let state =
    "NORMAL";


  if (
    ratio >=
    1.40
  ) {

    state =
      "HIGH";

  }


  if (
    ratio <=
    0.65
  ) {

    state =
      "LOW";

  }


  return {

    current:
      round(
        current,
        5
      ),

    average:
      round(
        avg,
        5
      ),

    ratio:
      round(
        ratio,
        2
      ),

    state

  };

}


/* ============================================================
   COINBASE TRADE FLOW

   Coinbase returns MAKER side.

   maker sell
   =
   aggressive buyer

   maker buy
   =
   aggressive seller
============================================================ */

function analyzeTrades(
  trades
) {

  if (
    !Array.isArray(
      trades
    )
  ) {

    return {

      available:
        false,

      trades:
        0,

      aggressiveBuyBTC:
        0,

      aggressiveSellBTC:
        0,

      deltaBTC:
        0,

      deltaPercent:
        0,

      cvd:
        0,

      pressure:
        "UNAVAILABLE"

    };

  }


  let aggressiveBuy =
    0;


  let aggressiveSell =
    0;


  let cvd =
    0;


  const sorted =
    [...trades]
      .sort(
        (
          a,
          b
        ) =>
          new Date(
            a.time
          ) -
          new Date(
            b.time
          )
      );


  for (
    const trade of
    sorted
  ) {

    const size =
      num(
        trade.size
      );


    if (
      trade.side ===
      "sell"
    ) {

      aggressiveBuy +=
        size;


      cvd +=
        size;

    }


    if (
      trade.side ===
      "buy"
    ) {

      aggressiveSell +=
        size;


      cvd -=
        size;

    }

  }


  const total =
    aggressiveBuy +
    aggressiveSell;


  const delta =
    aggressiveBuy -
    aggressiveSell;


  const deltaPercent =
    total >
    0

      ? delta /
        total *
        100

      : 0;


  let pressure =
    "BALANCED";


  if (
    deltaPercent >
    8
  ) {

    pressure =
      "AGGRESSIVE BUYING";

  }


  if (
    deltaPercent <
    -8
  ) {

    pressure =
      "AGGRESSIVE SELLING";

  }


  return {

    available:
      true,

    trades:
      trades.length,

    aggressiveBuyBTC:
      round(
        aggressiveBuy,
        5
      ),

    aggressiveSellBTC:
      round(
        aggressiveSell,
        5
      ),

    deltaBTC:
      round(
        delta,
        5
      ),

    deltaPercent:
      round(
        deltaPercent,
        2
      ),

    cvd:
      round(
        cvd,
        5
      ),

    pressure

  };

}


/* ============================================================
   LIGHTWEIGHT LEVEL-1 BOOK

   We deliberately do NOT use Coinbase level=2 here.
============================================================ */

function analyzeBook(
  rawBook,
  ticker
) {

  let bid =
    null;


  let ask =
    null;


  if (
    Array.isArray(
      rawBook?.bids
    ) &&
    rawBook.bids.length
  ) {

    bid =
      num(
        rawBook
          .bids[0][0],
        null
      );

  }


  if (
    Array.isArray(
      rawBook?.asks
    ) &&
    rawBook.asks.length
  ) {

    ask =
      num(
        rawBook
          .asks[0][0],
        null
      );

  }


  /*
     Ticker fallback.
  */

  if (
    !Number.isFinite(
      bid
    )
  ) {

    bid =
      num(
        ticker?.bid,
        null
      );

  }


  if (
    !Number.isFinite(
      ask
    )
  ) {

    ask =
      num(
        ticker?.ask,
        null
      );

  }


  const spread =

    Number.isFinite(
      bid
    ) &&
    Number.isFinite(
      ask
    )

      ? ask -
        bid

      : null;


  /*
     No fake imbalance value.

     Level 1 only tells us top-of-book.
  */

  return {

    available:
      Number.isFinite(
        bid
      ) &&
      Number.isFinite(
        ask
      ),

    bestBid:
      round(
        bid
      ),

    bestAsk:
      round(
        ask
      ),

    spread:
      round(
        spread,
        2
      ),

    imbalancePercent:
      0,

    pressure:
      "TOP OF BOOK"

  };

}


/* ============================================================
   BUILD LIQUIDITY POOLS
============================================================ */

function buildLiquidityPools({

  price,

  atr,

  daily,

  weekly,

  sessions,

  equals,

  swings,

  roundLevels

}) {

  const pools =
    [];


  function add(

    name,

    level,

    side,

    baseWeight,

    type

  ) {

    if (
      !Number.isFinite(
        Number(
          level
        )
      )
    ) {

      return;

    }


    const value =
      Number(
        level
      );


    const distance =
      Math.abs(
        price -
        value
      );


    const distanceATR =
      atr >
      0

        ? distance /
          atr

        : 999;


    if (
      distanceATR >
      12
    ) {

      return;

    }


    let proximity =
      0;


    if (
      distanceATR <=
      0.25
    ) {

      proximity =
        30;

    }

    else if (
      distanceATR <=
      0.50
    ) {

      proximity =
        25;

    }

    else if (
      distanceATR <=
      1.00
    ) {

      proximity =
        18;

    }

    else if (
      distanceATR <=
      1.50
    ) {

      proximity =
        10;

    }

    else if (
      distanceATR <=
      3
    ) {

      proximity =
        5;

    }


    pools.push({

      name,

      level:
        value,

      side,

      type,

      baseWeight,

      distance,

      distanceATR,

      score:
        clamp(

          baseWeight +
          proximity,

          0,

          65

        )

    });

  }


  add(

    "Previous Day High",

    daily.previousDayHigh,

    "BUY_SIDE",

    24,

    "PDH"

  );


  add(

    "Previous Day Low",

    daily.previousDayLow,

    "SELL_SIDE",

    24,

    "PDL"

  );


  add(

    "Previous Week High",

    weekly.previousWeekHigh,

    "BUY_SIDE",

    27,

    "PWH"

  );


  add(

    "Previous Week Low",

    weekly.previousWeekLow,

    "SELL_SIDE",

    27,

    "PWL"

  );


  if (
    sessions.asia
  ) {

    add(

      "Asia High",

      sessions.asia.high,

      "BUY_SIDE",

      14,

      "ASIA"

    );


    add(

      "Asia Low",

      sessions.asia.low,

      "SELL_SIDE",

      14,

      "ASIA"

    );

  }


  if (
    sessions.london
  ) {

    add(

      "London High",

      sessions.london.high,

      "BUY_SIDE",

      15,

      "LONDON"

    );


    add(

      "London Low",

      sessions.london.low,

      "SELL_SIDE",

      15,

      "LONDON"

    );

  }


  if (
    sessions.newYork
  ) {

    add(

      "New York High",

      sessions.newYork.high,

      "BUY_SIDE",

      15,

      "NEW_YORK"

    );


    add(

      "New York Low",

      sessions.newYork.low,

      "SELL_SIDE",

      15,

      "NEW_YORK"

    );

  }


  for (
    const item of
    equals.equalHighs
  ) {

    add(

      "Equal Highs",

      item.price,

      "BUY_SIDE",

      20,

      "EQH"

    );

  }


  for (
    const item of
    equals.equalLows
  ) {

    add(

      "Equal Lows",

      item.price,

      "SELL_SIDE",

      20,

      "EQL"

    );

  }


  for (
    const item of
    swings.highs.slice(
      -4
    )
  ) {

    add(

      "M15 Swing High",

      item.price,

      "BUY_SIDE",

      15,

      "SWING_HIGH"

    );

  }


  for (
    const item of
    swings.lows.slice(
      -4
    )
  ) {

    add(

      "M15 Swing Low",

      item.price,

      "SELL_SIDE",

      15,

      "SWING_LOW"

    );

  }


  add(

    "Round Number Above",

    roundLevels.upper,

    "BUY_SIDE",

    10,

    "ROUND"

  );


  add(

    "Round Number Below",

    roundLevels.lower,

    "SELL_SIDE",

    10,

    "ROUND"

  );


  if (
    roundLevels.majorUpper !==
    roundLevels.upper
  ) {

    add(

      "Major Round Number Above",

      roundLevels.majorUpper,

      "BUY_SIDE",

      17,

      "MAJOR_ROUND"

    );

  }


  if (
    roundLevels.majorLower !==
    roundLevels.lower
  ) {

    add(

      "Major Round Number Below",

      roundLevels.majorLower,

      "SELL_SIDE",

      17,

      "MAJOR_ROUND"

    );

  }


  const unique =
    new Map();


  for (
    const pool of
    pools
  ) {

    const key =

      pool.name +

      ":" +

      round(
        pool.level,
        2
      );


    unique.set(
      key,
      pool
    );

  }


  return [
    ...unique.values()
  ].sort(
    (
      a,
      b
    ) => {

      if (
        b.score !==
        a.score
      ) {

        return (
          b.score -
          a.score
        );

      }


      return (
        a.distance -
        b.distance
      );

    }
  );

}


/* ============================================================
   CHOOSE PRIMARY LIQUIDITY
============================================================ */

function choosePrimaryLiquidity(
  pools
) {

  if (
    !pools.length
  ) {

    return null;

  }


  return [
    ...pools
  ].sort(
    (
      a,
      b
    ) => {

      const aRank =

        a.score -

        Math.min(
          a.distanceATR *
          4,
          25
        );


      const bRank =

        b.score -

        Math.min(
          b.distanceATR *
          4,
          25
        );


      return (
        bRank -
        aRank
      );

    }
  )[0];

}


/* ============================================================
   CANDLE REJECTION
============================================================ */

function candleRejection(
  candle
) {

  if (
    !candle
  ) {

    return {

      bullish:
        false,

      bearish:
        false,

      upperWickPercent:
        0,

      lowerWickPercent:
        0

    };

  }


  const range =
    candle.high -
    candle.low;


  if (
    range <=
    0
  ) {

    return {

      bullish:
        false,

      bearish:
        false,

      upperWickPercent:
        0,

      lowerWickPercent:
        0

    };

  }


  const bodyHigh =
    Math.max(
      candle.open,
      candle.close
    );


  const bodyLow =
    Math.min(
      candle.open,
      candle.close
    );


  const upper =
    candle.high -
    bodyHigh;


  const lower =
    bodyLow -
    candle.low;


  const upperPct =
    upper /
    range *
    100;


  const lowerPct =
    lower /
    range *
    100;


  return {

    bullish:

      lowerPct >=
      38 &&

      candle.close >
      candle.open,

    bearish:

      upperPct >=
      38 &&

      candle.close <
      candle.open,

    upperWickPercent:
      round(
        upperPct,
        1
      ),

    lowerWickPercent:
      round(
        lowerPct,
        1
      )

  };

}


/* ============================================================
   STRUCTURE BREAK
============================================================ */

function structureTrigger(
  candles
) {

  if (
    candles.length <
    10
  ) {

    return {

      bullish:
        false,

      bearish:
        false,

      previousHigh:
        null,

      previousLow:
        null

    };

  }


  const prior =
    candles.slice(
      -8,
      -1
    );


  const current =
    candles.at(-1);


  const previousHigh =
    Math.max(
      ...prior.map(
        c =>
          c.high
      )
    );


  const previousLow =
    Math.min(
      ...prior.map(
        c =>
          c.low
      )
    );


  return {

    bullish:
      current.close >
      previousHigh,

    bearish:
      current.close <
      previousLow,

    previousHigh:
      round(
        previousHigh
      ),

    previousLow:
      round(
        previousLow
      )

  };

}


/* ============================================================
   RAID MODEL
============================================================ */

function analyzeRaid({

  pool,

  price,

  atr,

  candle,

  m15,

  h1,

  h4,

  flow,

  volume

}) {

  if (
    !pool
  ) {

    return null;

  }


  const distance =
    Math.abs(
      price -
      pool.level
    );


  const distanceATR =

    atr >
    0

      ? distance /
        atr

      : 999;


  let score =
    pool.baseWeight;


  const reasons =
    [];


  if (
    distanceATR <=
    1.5
  ) {

    score +=
      10;


    reasons.push(
      "Price is approaching this liquidity pool"
    );

  }


  if (
    distanceATR <=
    0.75
  ) {

    score +=
      8;


    reasons.push(
      "Liquidity is inside 0.75 ATR"
    );

  }


  if (
    distanceATR <=
    0.30
  ) {

    score +=
      8;


    reasons.push(
      "Price is extremely close to liquidity"
    );

  }


  let swept =
    false;


  let rejected =
    false;


  if (
    pool.side ===
    "BUY_SIDE"
  ) {

    if (
      candle.high >
      pool.level
    ) {

      swept =
        true;


      score +=
        12;


      reasons.push(
        "Buy-side liquidity has been swept"
      );

    }


    if (
      swept &&
      candle.close <
      pool.level
    ) {

      rejected =
        true;


      score +=
        14;


      reasons.push(
        "Price closed back below the swept level"
      );

    }


    if (
      flow.available &&
      flow.deltaPercent <
      -5
    ) {

      score +=
        8;


      reasons.push(
        "Aggressive order flow is bearish"
      );

    }


    if (
      m15.bias ===
      "BEARISH"
    ) {

      score +=
        7;


      reasons.push(
        "M15 supports downside"
      );

    }


    if (
      h1.bias ===
      "BEARISH"
    ) {

      score +=
        5;


      reasons.push(
        "H1 supports downside"
      );

    }


    if (
      h4.bias ===
      "BULLISH"
    ) {

      score -=
        5;

    }

  }


  if (
    pool.side ===
    "SELL_SIDE"
  ) {

    if (
      candle.low <
      pool.level
    ) {

      swept =
        true;


      score +=
        12;


      reasons.push(
        "Sell-side liquidity has been swept"
      );

    }


    if (
      swept &&
      candle.close >
      pool.level
    ) {

      rejected =
        true;


      score +=
        14;


      reasons.push(
        "Price closed back above the swept level"
      );

    }


    if (
      flow.available &&
      flow.deltaPercent >
      5
    ) {

      score +=
        8;


      reasons.push(
        "Aggressive order flow is bullish"
      );

    }


    if (
      m15.bias ===
      "BULLISH"
    ) {

      score +=
        7;


      reasons.push(
        "M15 supports upside"
      );

    }


    if (
      h1.bias ===
      "BULLISH"
    ) {

      score +=
        5;


      reasons.push(
        "H1 supports upside"
      );

    }


    if (
      h4.bias ===
      "BEARISH"
    ) {

      score -=
        5;

    }

  }


  if (
    volume.state ===
    "HIGH"
  ) {

    score +=
      5;


    reasons.push(
      "M5 volume is elevated"
    );

  }


  score =
    clamp(
      score,
      0,
      95
    );


  let stage =
    "MONITORING";


  if (
    score >=
    SETTINGS.TRACKING_SCORE
  ) {

    stage =
      "TRACKING";

  }


  if (
    score >=
    SETTINGS.ARMED_SCORE
  ) {

    stage =
      "ARMED";

  }


  if (
    swept
  ) {

    stage =
      "SWEPT";

  }


  if (
    swept &&
    rejected
  ) {

    stage =
      "REVERSAL WATCH";

  }


  const minimum =
    atr *
    SETTINGS
      .SWEEP_MIN_ATR;


  let maximum =
    atr *
    SETTINGS
      .SWEEP_MAX_ATR;


  if (
    volume.state ===
    "HIGH"
  ) {

    maximum *=
      1.20;

  }


  if (
    flow.available &&
    Math.abs(
      flow.deltaPercent
    ) >
    20
  ) {

    maximum *=
      1.15;

  }


  let zone;


  if (
    pool.side ===
    "BUY_SIDE"
  ) {

    zone = {

      low:
        pool.level +
        minimum,

      high:
        pool.level +
        maximum

    };

  }

  else {

    zone = {

      low:
        pool.level -
        maximum,

      high:
        pool.level -
        minimum

    };

  }


  return {

    target:
      pool.name,

    type:
      pool.type,

    side:
      pool.side,

    level:
      round(
        pool.level
      ),

    livePrice:
      round(
        price
      ),

    distance:
      round(
        distance
      ),

    distanceATR:
      round(
        distanceATR,
        2
      ),

    score:
      round(
        score
      ),

    maxScore:
      95,

    stage,

    swept,

    rejected,

    projectedSweepZone: {

      low:
        round(
          zone.low
        ),

      high:
        round(
          zone.high
        )

    },

    reasons

  };

}


/* ============================================================
   SIGNAL ENGINE
============================================================ */

function generateSignal({

  price,

  atr,

  vwap,

  raid,

  m5,

  m15,

  h1,

  h4,

  flow,

  rejection,

  trigger

}) {

  let buyScore =
    0;


  let sellScore =
    0;


  const buyReasons =
    [];


  const sellReasons =
    [];


  /* M5 */

  if (
    m5.bias ===
    "BULLISH"
  ) {

    buyScore +=
      7;


    buyReasons.push(
      "M5 bullish"
    );

  }


  if (
    m5.bias ===
    "BEARISH"
  ) {

    sellScore +=
      7;


    sellReasons.push(
      "M5 bearish"
    );

  }


  /* M15 */

  if (
    m15.bias ===
    "BULLISH"
  ) {

    buyScore +=
      13;


    buyReasons.push(
      "M15 bullish"
    );

  }


  if (
    m15.bias ===
    "BEARISH"
  ) {

    sellScore +=
      13;


    sellReasons.push(
      "M15 bearish"
    );

  }


  /* H1 */

  if (
    h1.bias ===
    "BULLISH"
  ) {

    buyScore +=
      12;


    buyReasons.push(
      "H1 bullish"
    );

  }


  if (
    h1.bias ===
    "BEARISH"
  ) {

    sellScore +=
      12;


    sellReasons.push(
      "H1 bearish"
    );

  }


  /* H4 */

  if (
    h4.bias ===
    "BULLISH"
  ) {

    buyScore +=
      8;


    buyReasons.push(
      "H4 bullish"
    );

  }


  if (
    h4.bias ===
    "BEARISH"
  ) {

    sellScore +=
      8;


    sellReasons.push(
      "H4 bearish"
    );

  }


  /* VWAP */

  if (
    Number.isFinite(
      vwap
    )
  ) {

    if (
      price >
      vwap
    ) {

      buyScore +=
        5;


      buyReasons.push(
        "Price above daily VWAP"
      );

    }

    else {

      sellScore +=
        5;


      sellReasons.push(
        "Price below daily VWAP"
      );

    }

  }


  /* TRADE FLOW */

  if (
    flow.available
  ) {

    if (
      flow.deltaPercent >
      5
    ) {

      buyScore +=
        10;


      buyReasons.push(
        "Positive Coinbase trade delta"
      );

    }


    if (
      flow.deltaPercent <
      -5
    ) {

      sellScore +=
        10;


      sellReasons.push(
        "Negative Coinbase trade delta"
      );

    }

  }


  /* REJECTION */

  if (
    rejection.bullish
  ) {

    buyScore +=
      7;


    buyReasons.push(
      "Bullish rejection candle"
    );

  }


  if (
    rejection.bearish
  ) {

    sellScore +=
      7;


    sellReasons.push(
      "Bearish rejection candle"
    );

  }


  /* STRUCTURE */

  if (
    trigger.bullish
  ) {

    buyScore +=
      10;


    buyReasons.push(
      "Bullish M5 structure break"
    );

  }


  if (
    trigger.bearish
  ) {

    sellScore +=
      10;


    sellReasons.push(
      "Bearish M5 structure break"
    );

  }


  /* RAID */

  if (
    raid?.swept &&
    raid?.rejected
  ) {

    if (
      raid.side ===
      "SELL_SIDE"
    ) {

      buyScore +=
        23;


      buyReasons.push(
        "Sell-side liquidity sweep rejected"
      );

    }


    if (
      raid.side ===
      "BUY_SIDE"
    ) {

      sellScore +=
        23;


      sellReasons.push(
        "Buy-side liquidity sweep rejected"
      );

    }

  }


  buyScore =
    clamp(
      buyScore,
      0,
      100
    );


  sellScore =
    clamp(
      sellScore,
      0,
      100
    );


  const gap =
    Math.abs(
      buyScore -
      sellScore
    );


  let signal =
    "WAIT";


  if (
    buyScore >=
      SETTINGS.SIGNAL_SCORE &&
    buyScore >
      sellScore &&
    gap >=
      SETTINGS.SIGNAL_GAP
  ) {

    signal =
      "BUY";

  }


  if (
    sellScore >=
      SETTINGS.SIGNAL_SCORE &&
    sellScore >
      buyScore &&
    gap >=
      SETTINGS.SIGNAL_GAP
  ) {

    signal =
      "SELL";

  }


  let entry =
    null;


  let stopLoss =
    null;


  let takeProfit1 =
    null;


  let takeProfit2 =
    null;


  if (
    signal ===
    "BUY"
  ) {

    entry =
      price;


    stopLoss =
      price -
      atr *
      SETTINGS.STOP_ATR;


    if (
      raid?.side ===
      "SELL_SIDE"
    ) {

      stopLoss =
        Math.min(

          stopLoss,

          raid
            .projectedSweepZone
            .low -
          atr *
          0.10

        );

    }


    const risk =
      entry -
      stopLoss;


    takeProfit1 =
      entry +
      risk *
      SETTINGS.TP1_R;


    takeProfit2 =
      entry +
      risk *
      SETTINGS.TP2_R;

  }


  if (
    signal ===
    "SELL"
  ) {

    entry =
      price;


    stopLoss =
      price +
      atr *
      SETTINGS.STOP_ATR;


    if (
      raid?.side ===
      "BUY_SIDE"
    ) {

      stopLoss =
        Math.max(

          stopLoss,

          raid
            .projectedSweepZone
            .high +
          atr *
          0.10

        );

    }


    const risk =
      stopLoss -
      entry;


    takeProfit1 =
      entry -
      risk *
      SETTINGS.TP1_R;


    takeProfit2 =
      entry -
      risk *
      SETTINGS.TP2_R;

  }


  return {

    signal,

    buyScore:
      round(
        buyScore,
        1
      ),

    sellScore:
      round(
        sellScore,
        1
      ),

    confidence:
      round(
        Math.max(
          buyScore,
          sellScore
        ),
        1
      ),

    scoreGap:
      round(
        gap,
        1
      ),

    entry:
      round(
        entry
      ),

    stopLoss:
      round(
        stopLoss
      ),

    takeProfit1:
      round(
        takeProfit1
      ),

    takeProfit2:
      round(
        takeProfit2
      ),

    riskReward1:

      signal ===
      "WAIT"

        ? null

        : SETTINGS
          .TP1_R,

    riskReward2:

      signal ===
      "WAIT"

        ? null

        : SETTINGS
          .TP2_R,

    buyReasons,

    sellReasons

  };

}


/* ============================================================
   MAIN VERCEL HANDLER
============================================================ */

module.exports =
async function handler(
  req,
  res
) {

  const started =
    Date.now();


  res.setHeader(

    "Cache-Control",

    "no-store, no-cache, must-revalidate"

  );


  res.setHeader(

    "Content-Type",

    "application/json; charset=utf-8"

  );


  if (
    req.method ===
    "OPTIONS"
  ) {

    return res
      .status(200)
      .end();

  }


  try {

    /* ======================================================
       CORE REQUESTS

       Critical:
       - ticker
       - M5
       - H1
       - D1

       Optional:
       - trades
       - level 1 book
    ====================================================== */

    const [

      ticker,

      m5,

      h1,

      d1

    ] =
      await Promise.all([

        fetchTicker(),

        fetchCandles(

          SETTINGS
            .M5_GRANULARITY,

          SETTINGS
            .M5_COUNT

        ),

        fetchCandles(

          SETTINGS
            .H1_GRANULARITY,

          SETTINGS
            .H1_COUNT

        ),

        fetchCandles(

          SETTINGS
            .D1_GRANULARITY,

          SETTINGS
            .D1_COUNT

        )

      ]);


    /* ======================================================
       OPTIONAL MARKET MICROSTRUCTURE

       Failure here DOES NOT kill engine.
    ====================================================== */

    const [

      rawTrades,

      rawBook

    ] =
      await Promise.all([

        safeFetch(
          fetchTrades(),
          []
        ),

        safeFetch(
          fetchBestBook(),
          null
        )

      ]);


    /* ======================================================
       VALIDATION
    ====================================================== */

    if (
      m5.length <
      40
    ) {

      throw new Error(
        `Coinbase returned only ${m5.length} M5 candles`
      );

    }


    if (
      h1.length <
      40
    ) {

      throw new Error(
        `Coinbase returned only ${h1.length} H1 candles`
      );

    }


    if (
      d1.length <
      8
    ) {

      throw new Error(
        `Coinbase returned only ${d1.length} D1 candles`
      );

    }


    /* ======================================================
       PRICE
    ====================================================== */

    const price =
      num(
        ticker?.price,
        m5.at(-1)
          .close
      );


    if (
      price <=
      0
    ) {

      throw new Error(
        "Coinbase returned an invalid BTC price"
      );

    }


    /* ======================================================
       TIMEFRAMES
    ====================================================== */

    const m15 =
      resample(
        m5,
        15
      );


    const h4 =
      resample(
        h1,
        240
      );


    /* ======================================================
       STRUCTURE
    ====================================================== */

    const m5Structure =
      detectStructure(
        m5
      );


    const m15Structure =
      detectStructure(
        m15
      );


    const h1Structure =
      detectStructure(
        h1
      );


    const h4Structure =
      detectStructure(
        h4
      );


    /* ======================================================
       ATR
    ====================================================== */

    const atr =
      calculateATR(
        m5,
        SETTINGS
          .ATR_PERIOD
      );


    if (
      atr <=
      0
    ) {

      throw new Error(
        "Unable to calculate BTC ATR"
      );

    }


    /* ======================================================
       LEVELS
    ====================================================== */

    const daily =
      getDailyLevels(
        d1
      );


    const weekly =
      getWeeklyLevels(
        d1
      );


    /* ======================================================
       SESSIONS
    ====================================================== */

    const sessions =
      getSessionLevels(
        m5
      );


    const session =
      currentSession();


    /* ======================================================
       VWAP
    ====================================================== */

    const today =
      todayBars(
        m5
      );


    const vwap =
      calculateVWAP(
        today.length
          ? today
          : m5.slice(-50)
      );


    /* ======================================================
       SWINGS
    ====================================================== */

    const swings =
      findSwings(
        m15,
        SETTINGS
          .SWING_STRENGTH
      );


    const equals =
      equalLiquidity(
        swings,
        atr
      );


    /* ======================================================
       ROUND NUMBERS
    ====================================================== */

    const roundLevels =
      roundNumbers(
        price
      );


    /* ======================================================
       FLOW
    ====================================================== */

    const flow =
      analyzeTrades(
        rawTrades
      );


    const book =
      analyzeBook(
        rawBook,
        ticker
      );


    const volume =
      volumeAnalysis(
        m5
      );


    /* ======================================================
       LIQUIDITY
    ====================================================== */

    const pools =
      buildLiquidityPools({

        price,

        atr,

        daily,

        weekly,

        sessions,

        equals,

        swings,

        roundLevels

      });


    const primary =
      choosePrimaryLiquidity(
        pools
      );


    /* ======================================================
       RAID
    ====================================================== */

    const raid =
      analyzeRaid({

        pool:
          primary,

        price,

        atr,

        candle:
          m5.at(-1),

        m15:
          m15Structure,

        h1:
          h1Structure,

        h4:
          h4Structure,

        flow,

        volume

      });


    /* ======================================================
       CONFIRMATION
    ====================================================== */

    const rejection =
      candleRejection(
        m5.at(-1)
      );


    const trigger =
      structureTrigger(
        m5
      );


    /* ======================================================
       SIGNAL
    ====================================================== */

    const signal =
      generateSignal({

        price,

        atr,

        vwap,

        raid,

        m5:
          m5Structure,

        m15:
          m15Structure,

        h1:
          h1Structure,

        h4:
          h4Structure,

        flow,

        rejection,

        trigger

      });


    /* ======================================================
       MACRO BIAS
    ====================================================== */

    const bullish =
      [

        m15Structure,

        h1Structure,

        h4Structure

      ].filter(
        x =>
          x.bias ===
          "BULLISH"
      ).length;


    const bearish =
      [

        m15Structure,

        h1Structure,

        h4Structure

      ].filter(
        x =>
          x.bias ===
          "BEARISH"
      ).length;


    let macroBias =
      "MIXED";


    if (
      bullish >=
      2
    ) {

      macroBias =
        "BULLISH";

    }


    if (
      bearish >=
      2
    ) {

      macroBias =
        "BEARISH";

    }


    /* ======================================================
       VOLATILITY
    ====================================================== */

    const atrPercent =

      atr /
      price *
      100;


    let regime =
      "NORMAL";


    if (
      atrPercent <
      0.08
    ) {

      regime =
        "LOW";

    }


    if (
      atrPercent >=
      0.25
    ) {

      regime =
        "HIGH";

    }


    if (
      atrPercent >=
      0.50
    ) {

      regime =
        "EXTREME";

    }


    /* ======================================================
       RESPONSE
    ====================================================== */

    return res
      .status(200)
      .json({

        ok:
          true,

        engine:
          "MKAYFX BTC LIQUIDITY INTELLIGENCE V3",

        source:
          "Coinbase Exchange",

        product:
          PRODUCT,

        timestamp:
          new Date()
            .toISOString(),

        latencyMs:
          Date.now() -
          started,


        market: {

          price:
            round(
              price
            ),

          bid:
            book.bestBid,

          ask:
            book.bestAsk,

          spread:
            book.spread

        },


        session,


        sessionLevels: {

          asia:
            sessions.asia
              ? {

                high:
                  round(
                    sessions
                      .asia
                      .high
                  ),

                low:
                  round(
                    sessions
                      .asia
                      .low
                  )

              }
              : null,


          london:
            sessions.london
              ? {

                high:
                  round(
                    sessions
                      .london
                      .high
                  ),

                low:
                  round(
                    sessions
                      .london
                      .low
                  )

              }
              : null,


          newYork:
            sessions.newYork
              ? {

                high:
                  round(
                    sessions
                      .newYork
                      .high
                  ),

                low:
                  round(
                    sessions
                      .newYork
                      .low
                  )

              }
              : null

        },


        macroBias,


        timeframes: {

          M5:
            m5Structure,

          M15:
            m15Structure,

          H1:
            h1Structure,

          H4:
            h4Structure

        },


        volatility: {

          atr5m:
            round(
              atr
            ),

          atrPercent:
            round(
              atrPercent,
              4
            ),

          regime

        },


        vwap: {

          daily:
            round(
              vwap
            ),

          position:

            Number.isFinite(
              vwap
            )

              ? price >
                vwap

                ? "ABOVE"

                : "BELOW"

              : "UNKNOWN"

        },


        levels: {

          previousDayHigh:
            round(
              daily
                .previousDayHigh
            ),

          previousDayLow:
            round(
              daily
                .previousDayLow
            ),

          dailyOpen:
            round(
              daily
                .dailyOpen
            ),

          previousWeekHigh:
            round(
              weekly
                .previousWeekHigh
            ),

          previousWeekLow:
            round(
              weekly
                .previousWeekLow
            ),

          weeklyOpen:
            round(
              weekly
                .weeklyOpen
            ),

          roundNumberAbove:
            roundLevels
              .upper,

          roundNumberBelow:
            roundLevels
              .lower,

          majorRoundAbove:
            roundLevels
              .majorUpper,

          majorRoundBelow:
            roundLevels
              .majorLower

        },


        flow,


        orderBook:
          book,


        volume,


        raid,


        signal,


        confirmation: {

          rejection,

          structureTrigger:
            trigger

        },


        liquidityPools:

          pools
            .slice(
              0,
              15
            )
            .map(
              pool => ({

                name:
                  pool.name,

                level:
                  round(
                    pool.level
                  ),

                side:
                  pool.side,

                type:
                  pool.type,

                distance:
                  round(
                    pool.distance
                  ),

                distanceATR:
                  round(
                    pool.distanceATR,
                    2
                  ),

                score:
                  round(
                    pool.score
                  )

              })
            ),


        candles: {

          M5:
            m5.length,

          M15:
            m15.length,

          H1:
            h1.length,

          H4:
            h4.length,

          D1:
            d1.length

        },


        diagnostics: {

          ticker:
            true,

          trades:
            flow.available,

          topOfBook:
            book.available,

          level2Book:
            false,

          heavyOrderBookDisabled:
            true

        }

      });

  }

  catch (
    error
  ) {

    const message =
      errorText(
        error
      );


    console.error(
      "MKAYFX BTC V3 ERROR:",
      message
    );


    /*
       Important:
       always return our own JSON.
    */

    return res
      .status(500)
      .json({

        ok:
          false,

        engine:
          "MKAYFX BTC LIQUIDITY INTELLIGENCE V3",

        source:
          "Coinbase Exchange",

        error:
          message,

        timestamp:
          new Date()
            .toISOString(),

        latencyMs:
          Date.now() -
          started

      });

  }

};