/* =========================================================
   MKAYFX GOLD V8 LIVE
   XAU/USD ONLY

   SIGNAL != TRADE APPROVAL

   signal:
   BUY / SELL / WAIT
   = current directional analysis

   action:
   BUY / SELL / WAIT
   = actual approved trade

   STARTUP:
   immediately analyses when frontend calls API.

   DATA:
   live price = Twelve Data /price
   M1         = entry + gold liquidity
   M5         = confirmation
   M15        = main direction
   H1         = direct higher-timeframe feed

========================================================= */


/* =========================================================
   CONFIG
========================================================= */

const API_KEY =
  process.env.TWELVE_DATA_API_KEY;

const BASE_URL =
  "https://api.twelvedata.com";

const SYMBOL =
  "XAU/USD";


function envNumber(
  name,
  fallback,
  min = -Infinity,
  max = Infinity
) {

  const raw =
    process.env[name];

  if (
    raw === undefined ||
    raw === null ||
    raw === ""
  ) {
    return fallback;
  }

  const n =
    Number(raw);

  if (
    !Number.isFinite(n)
  ) {
    return fallback;
  }

  return Math.max(
    min,
    Math.min(
      max,
      n
    )
  );

}


/* =========================================================
   DATA SETTINGS
========================================================= */

const M1_OUTPUT =
  envNumber(
    "M1_OUTPUT",
    5000,
    500,
    5000
  );

const H1_OUTPUT =
  envNumber(
    "H1_OUTPUT",
    300,
    100,
    1000
  );

const M1_CACHE_MS =
  envNumber(
    "M1_CACHE_MS",
    55_000,
    15_000,
    120_000
  );

const H1_CACHE_MS =
  envNumber(
    "H1_CACHE_MS",
    10 * 60_000,
    60_000,
    60 * 60_000
  );

const PRICE_CACHE_MS =
  envNumber(
    "PRICE_CACHE_MS",
    20_000,
    5_000,
    60_000
  );

const STALE_MS =
  envNumber(
    "STALE_MS",
    5 * 60_000
  );


/* =========================================================
   ACCOUNT
========================================================= */

const DEFAULT_EQUITY =
  envNumber(
    "DEFAULT_EQUITY_ZAR",
    200,
    1
  );

const RISK_PCT =
  envNumber(
    "RISK_PER_TRADE_PCT",
    0.25,
    0.01,
    0.50
  );

const DAILY_LOSS_PCT =
  envNumber(
    "DAILY_LOSS_LIMIT_PCT",
    1.5,
    0.25,
    5
  );

const MAX_TRADES =
  envNumber(
    "MAX_TRADES_PER_DAY",
    6,
    1,
    30
  );

const MAX_LOSSES =
  envNumber(
    "MAX_CONSECUTIVE_LOSSES",
    3,
    1,
    10
  );

const LOSS_COOLDOWN =
  envNumber(
    "LOSS_COOLDOWN_MINUTES",
    10,
    0,
    240
  );


/* =========================================================
   SETUP FILTERS
========================================================= */

const MIN_SCORE =
  envNumber(
    "MIN_SCORE",
    66,
    50,
    95
  );

const MIN_MARGIN =
  envNumber(
    "MIN_MARGIN",
    30,
    5,
    90
  );

const MIN_QUALITY =
  envNumber(
    "MIN_QUALITY",
    58,
    20,
    95
  );

const MIN_AGREEMENT =
  envNumber(
    "MIN_AGREEMENT",
    58,
    20,
    100
  );

const MIN_SIGNAL_STRENGTH =
  envNumber(
    "MIN_SIGNAL_STRENGTH",
    8,
    0,
    40
  );

const MAX_ENTRY_STRETCH_ATR =
  envNumber(
    "MAX_ENTRY_STRETCH_ATR",
    1.45,
    0.5,
    4
  );

const ENTRY_ZONE_ATR =
  envNumber(
    "ENTRY_ZONE_ATR",
    0.22,
    0.05,
    1
  );

const MAX_LIVE_DEVIATION_ATR =
  envNumber(
    "MAX_LIVE_DEVIATION_ATR",
    0.65,
    0.20,
    3
  );

const MIN_STOP_ATR =
  envNumber(
    "MIN_STOP_ATR",
    0.65,
    0.2,
    2
  );

const MAX_STOP_ATR =
  envNumber(
    "MAX_STOP_ATR",
    1.70,
    0.5,
    5
  );

const MAX_SWING_AGE =
  envNumber(
    "MAX_SWING_AGE",
    18,
    3,
    100
  );


/* =========================================================
   TARGETS
========================================================= */

const TP1_R =
  envNumber(
    "TP1_R",
    1.0,
    0.5,
    4
  );

const TP2_R =
  envNumber(
    "TP2_R",
    1.6,
    1,
    5
  );

const MIN_ROOM_R =
  envNumber(
    "MIN_ROOM_R",
    1.05,
    0.5,
    4
  );

const MAX_HOLD_MINUTES =
  envNumber(
    "MAX_HOLD_MINUTES",
    25,
    5,
    180
  );


/* =========================================================
   SPREAD
========================================================= */

const MAX_SPREAD_USD =
  envNumber(
    "MAX_SPREAD_USD",
    0.45,
    0.01,
    5
  );

const MAX_SPREAD_ATR =
  envNumber(
    "MAX_SPREAD_ATR",
    0.35,
    0.05,
    1
  );


/* =========================================================
   WEIGHTS
========================================================= */

const WEIGHTS = {
  trend: 24,
  structure: 24,
  liquidity: 28,
  momentum: 16,
  gold: 8
};


/* =========================================================
   CACHE
========================================================= */

const cache = {
  m1: null,
  h1: null,
  price: null
};

const inFlight = {
  m1: null,
  h1: null,
  price: null
};


/* =========================================================
   UTILITIES
========================================================= */

function finite(
  value
) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : null;

}


function round(
  value,
  digits = 2
) {

  const n =
    finite(value);

  if (
    n === null
  ) {
    return null;
  }

  return Number(
    n.toFixed(digits)
  );

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

  return (
    clean.reduce(
      (a, b) =>
        a + b,
      0
    ) /
    clean.length
  );

}


function parseUTC(
  value
) {

  if (!value) {
    return NaN;
  }

  const text =
    String(value)
      .trim()
      .replace(
        " ",
        "T"
      );

  return new Date(
    /Z$|[+-]\d\d:\d\d$/.test(text)
      ? text
      : `${text}Z`
  ).getTime();

}


function bodyOf(
  req
) {

  if (!req.body) {
    return {};
  }

  if (
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


function send(
  res,
  status,
  payload
) {

  return res
    .status(status)
    .json(payload);

}


/* =========================================================
   TIME ZONES
========================================================= */

function zoneParts(
  ms,
  timeZone
) {

  const formatter =
    new Intl.DateTimeFormat(
      "en-GB",
      {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
      }
    );

  const map = {};

  for (
    const part of
    formatter.formatToParts(
      new Date(ms)
    )
  ) {

    if (
      part.type !==
      "literal"
    ) {
      map[part.type] =
        part.value;
    }

  }

  return {
    year:
      Number(map.year),

    month:
      Number(map.month),

    day:
      Number(map.day),

    hour:
      Number(map.hour),

    minute:
      Number(map.minute),

    dateKey:
      `${map.year}-${map.month}-${map.day}`
  };

}


function sessionFor(
  ms
) {

  const london =
    zoneParts(
      ms,
      "Europe/London"
    );

  const ny =
    zoneParts(
      ms,
      "America/New_York"
    );

  if (
    london.hour >= 12 &&
    london.hour < 16 &&
    ny.hour >= 7 &&
    ny.hour < 11
  ) {
    return "LONDON_NEW_YORK_OVERLAP";
  }

  if (
    london.hour >= 8 &&
    london.hour < 12
  ) {
    return "LONDON";
  }

  if (
    ny.hour >= 8 &&
    ny.hour < 13
  ) {
    return "NEW_YORK";
  }

  if (
    london.hour >= 0 &&
    london.hour < 8
  ) {
    return "ASIA";
  }

  return "TRANSITION";

}


function mainGoldSession(
  session
) {

  return [
    "LONDON",
    "LONDON_NEW_YORK_OVERLAP",
    "NEW_YORK"
  ].includes(session);

}


/* =========================================================
   HTTP
========================================================= */

async function fetchJSON(
  url,
  timeout = 15000
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
            controller.signal
        }
      );

    const data =
      await response
        .json()
        .catch(
          () => ({})
        );

    if (
      !response.ok
    ) {

      throw new Error(
        data.message ||
        `HTTP ${response.status}`
      );

    }

    return data;

  }
  finally {
    clearTimeout(timer);
  }

}


/* =========================================================
   TWELVE DATA
========================================================= */

async function fetchSeries(
  interval,
  outputsize
) {

  if (!API_KEY) {
    throw new Error(
      "TWELVE_DATA_API_KEY is missing."
    );
  }

  const query =
    new URLSearchParams({
      symbol:
        SYMBOL,

      interval,

      outputsize:
        String(outputsize),

      timezone:
        "UTC",

      format:
        "JSON",

      apikey:
        API_KEY
    });

  const data =
    await fetchJSON(
      `${BASE_URL}/time_series?${query}`
    );

  if (
    data.status === "error" ||
    !Array.isArray(
      data.values
    )
  ) {

    throw new Error(
      data.message ||
      `${interval} gold data unavailable.`
    );

  }

  return data.values
    .map(
      x => ({
        t:
          x.datetime,

        o:
          Number(x.open),

        h:
          Number(x.high),

        l:
          Number(x.low),

        c:
          Number(x.close),

        v:
          Number(
            x.volume ||
            0
          )
      })
    )
    .filter(
      x =>
        [
          x.o,
          x.h,
          x.l,
          x.c
        ].every(
          Number.isFinite
        )
    )
    .reverse();

}


async function fetchLivePrice() {

  const query =
    new URLSearchParams({
      symbol:
        SYMBOL,

      dp:
        "5",

      apikey:
        API_KEY
    });

  const data =
    await fetchJSON(
      `${BASE_URL}/price?${query}`,
      10000
    );

  const price =
    finite(
      data.price
    );

  if (
    price === null
  ) {
    throw new Error(
      "Live XAU/USD price unavailable."
    );
  }

  return price;

}


/* =========================================================
   GENERIC CACHE
========================================================= */

async function cached(
  key,
  maxAge,
  getter
) {

  const current =
    cache[key];

  if (
    current &&
    Date.now() -
      current.time <
      maxAge
  ) {

    return {
      value:
        current.value,

      cacheHit:
        true
    };

  }

  if (
    inFlight[key]
  ) {

    return {
      value:
        await inFlight[key],

      cacheHit:
        true
    };

  }

  inFlight[key] =
    getter()
      .then(
        value => {

          cache[key] = {
            time:
              Date.now(),

            value
          };

          return value;

        }
      )
      .finally(
        () => {
          inFlight[key] =
            null;
        }
      );

  return {
    value:
      await inFlight[key],

    cacheHit:
      false
  };

}


/* =========================================================
   COMPLETED CANDLES
========================================================= */

function completed(
  candles,
  minutes,
  now = Date.now()
) {

  const duration =
    minutes *
    60_000;

  return candles.filter(
    candle => {

      const start =
        parseUTC(
          candle.t
        );

      return (
        Number.isFinite(start) &&
        start +
          duration <=
          now
      );

    }
  );

}


/* =========================================================
   M1 -> M5 / M15
========================================================= */

function resample(
  candles,
  minutes
) {

  const ms =
    minutes *
    60_000;

  const groups =
    new Map();

  for (
    const candle of
    candles
  ) {

    const time =
      parseUTC(
        candle.t
      );

    if (
      !Number.isFinite(time)
    ) {
      continue;
    }

    const bucket =
      Math.floor(
        time /
        ms
      ) *
      ms;

    if (
      !groups.has(bucket)
    ) {
      groups.set(
        bucket,
        []
      );
    }

    groups
      .get(bucket)
      .push(candle);

  }

  const output = [];

  for (
    const [
      timestamp,
      group
    ] of groups
  ) {

    if (
      group.length <
      Math.ceil(
        minutes *
        0.90
      )
    ) {
      continue;
    }

    group.sort(
      (a, b) =>
        parseUTC(a.t) -
        parseUTC(b.t)
    );

    output.push({
      t:
        new Date(
          timestamp
        ).toISOString(),

      o:
        group[0].o,

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
        group.at(-1).c,

      v:
        group.reduce(
          (
            sum,
            x
          ) =>
            sum +
            (x.v || 0),
          0
        )
    });

  }

  return output.sort(
    (a, b) =>
      parseUTC(a.t) -
      parseUTC(b.t)
  );

}


/* =========================================================
   EMA
========================================================= */

function emaSeries(
  values,
  period
) {

  if (
    values.length <
    period
  ) {
    return [];
  }

  const k =
    2 /
    (
      period +
      1
    );

  let value =
    mean(
      values.slice(
        0,
        period
      )
    );

  const output =
    Array(
      period -
      1
    ).fill(null);

  output.push(value);

  for (
    let i =
      period;

    i <
      values.length;

    i++
  ) {

    value =
      values[i] *
        k +
      value *
        (
          1 -
          k
        );

    output.push(value);

  }

  return output;

}


function ema(
  values,
  period
) {

  const valuesOut =
    emaSeries(
      values,
      period
    );

  return valuesOut.length
    ? valuesOut.at(-1)
    : null;

}


/* =========================================================
   RSI
========================================================= */

function rsi(
  closes,
  period = 14
) {

  if (
    closes.length <=
    period
  ) {
    return null;
  }

  let gain = 0;
  let loss = 0;

  for (
    let i = 1;
    i <= period;
    i++
  ) {

    const change =
      closes[i] -
      closes[i - 1];

    gain +=
      Math.max(
        change,
        0
      );

    loss +=
      Math.max(
        -change,
        0
      );

  }

  let avgGain =
    gain /
    period;

  let avgLoss =
    loss /
    period;

  for (
    let i =
      period + 1;

    i <
      closes.length;

    i++
  ) {

    const change =
      closes[i] -
      closes[i - 1];

    avgGain =
      (
        avgGain *
          (
            period -
            1
          ) +
        Math.max(
          change,
          0
        )
      ) /
      period;

    avgLoss =
      (
        avgLoss *
          (
            period -
            1
          ) +
        Math.max(
          -change,
          0
        )
      ) /
      period;

  }

  if (
    avgLoss === 0
  ) {
    return 100;
  }

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

function trueRanges(
  candles
) {

  const output = [];

  for (
    let i = 1;
    i <
      candles.length;

    i++
  ) {

    const c =
      candles[i];

    const p =
      candles[i - 1];

    output.push(
      Math.max(
        c.h - c.l,
        Math.abs(
          c.h - p.c
        ),
        Math.abs(
          c.l - p.c
        )
      )
    );

  }

  return output;

}


function wilder(
  values,
  period
) {

  if (
    values.length <
    period
  ) {
    return [];
  }

  let value =
    mean(
      values.slice(
        0,
        period
      )
    );

  const output = [
    value
  ];

  for (
    let i =
      period;

    i <
      values.length;

    i++
  ) {

    value =
      (
        value *
          (
            period -
            1
          ) +
        values[i]
      ) /
      period;

    output.push(value);

  }

  return output;

}


function atrSeries(
  candles,
  period = 14
) {

  return wilder(
    trueRanges(candles),
    period
  );

}


function atr(
  candles,
  period = 14
) {

  const values =
    atrSeries(
      candles,
      period
    );

  return values.length
    ? values.at(-1)
    : null;

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
    period *
      2 +
      2
  ) {
    return null;
  }

  const trs = [];
  const plus = [];
  const minus = [];

  for (
    let i = 1;
    i <
      candles.length;

    i++
  ) {

    const c =
      candles[i];

    const p =
      candles[i - 1];

    const up =
      c.h -
      p.h;

    const down =
      p.l -
      c.l;

    plus.push(
      up >
          down &&
        up >
          0
        ? up
        : 0
    );

    minus.push(
      down >
          up &&
        down >
          0
        ? down
        : 0
    );

    trs.push(
      Math.max(
        c.h -
          c.l,

        Math.abs(
          c.h -
          p.c
        ),

        Math.abs(
          c.l -
          p.c
        )
      )
    );

  }

  const smoothTR =
    wilder(
      trs,
      period
    );

  const smoothPlus =
    wilder(
      plus,
      period
    );

  const smoothMinus =
    wilder(
      minus,
      period
    );

  const length =
    Math.min(
      smoothTR.length,
      smoothPlus.length,
      smoothMinus.length
    );

  const dx = [];

  for (
    let i = 0;
    i < length;
    i++
  ) {

    const tr =
      smoothTR[i];

    if (
      !tr
    ) {
      continue;
    }

    const pdi =
      100 *
      smoothPlus[i] /
      tr;

    const mdi =
      100 *
      smoothMinus[i] /
      tr;

    const total =
      pdi +
      mdi;

    if (
      total > 0
    ) {

      dx.push(
        100 *
        Math.abs(
          pdi -
          mdi
        ) /
        total
      );

    }

  }

  const smoothDX =
    wilder(
      dx,
      period
    );

  return smoothDX.length
    ? smoothDX.at(-1)
    : null;

}


/* =========================================================
   MACD
========================================================= */

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

  const values = [];

  for (
    let i = 0;
    i <
      closes.length;

    i++
  ) {

    if (
      fast[i] == null ||
      slow[i] == null
    ) {
      continue;
    }

    values.push(
      fast[i] -
      slow[i]
    );

  }

  if (
    values.length <
    9
  ) {

    return {
      line: null,
      signal: null,
      histogram: null
    };

  }

  const line =
    values.at(-1);

  const signal =
    ema(
      values,
      9
    );

  return {
    line,
    signal,

    histogram:
      signal != null
        ? line -
          signal
        : null
  };

}


/* =========================================================
   SWINGS
========================================================= */

function swings(
  candles,
  left = 2,
  right = 2
) {

  const highs = [];
  const lows = [];

  for (
    let i = left;
    i <
      candles.length -
      right;

    i++
  ) {

    let high = true;
    let low = true;

    for (
      let j =
        i - left;

      j <=
        i + right;

      j++
    ) {

      if (
        i === j
      ) {
        continue;
      }

      if (
        candles[j].h >=
        candles[i].h
      ) {
        high = false;
      }

      if (
        candles[j].l <=
        candles[i].l
      ) {
        low = false;
      }

    }

    if (high) {
      highs.push({
        index: i,
        price:
          candles[i].h,
        t:
          candles[i].t,
        age:
          candles.length -
          1 -
          i
      });
    }

    if (low) {
      lows.push({
        index: i,
        price:
          candles[i].l,
        t:
          candles[i].t,
        age:
          candles.length -
          1 -
          i
      });
    }

  }

  return {
    highs,
    lows
  };

}


function structure(
  data
) {

  const highs =
    data.highs.slice(-2);

  const lows =
    data.lows.slice(-2);

  if (
    highs.length < 2 ||
    lows.length < 2
  ) {
    return "MIXED";
  }

  if (
    highs[1].price >
      highs[0].price &&
    lows[1].price >
      lows[0].price
  ) {
    return "HH/HL";
  }

  if (
    highs[1].price <
      highs[0].price &&
    lows[1].price <
      lows[0].price
  ) {
    return "LH/LL";
  }

  return "MIXED";

}


/* =========================================================
   FRESH BOS / CHOCH
========================================================= */

function bos(
  candles,
  data
) {

  const current =
    finite(
      candles.at(-1)?.c
    );

  const previous =
    finite(
      candles.at(-2)?.c
    );

  const high =
    data.highs.at(-1);

  const low =
    data.lows.at(-1);

  const marketStructure =
    structure(data);

  let breakType =
    "NONE";

  let choch =
    "NONE";

  if (
    high &&
    current !== null &&
    previous !== null &&
    previous <=
      high.price &&
    current >
      high.price
  ) {

    breakType =
      "BULLISH_BOS";

    if (
      marketStructure ===
      "LH/LL"
    ) {
      choch =
        "BULLISH_CHOCH";
    }

  }

  if (
    low &&
    current !== null &&
    previous !== null &&
    previous >=
      low.price &&
    current <
      low.price
  ) {

    breakType =
      "BEARISH_BOS";

    if (
      marketStructure ===
      "HH/HL"
    ) {
      choch =
        "BEARISH_CHOCH";
    }

  }

  return {
    structure:
      marketStructure,

    bos:
      breakType,

    choch
  };

}


/* =========================================================
   LIQUIDITY SWEEP
========================================================= */

function genericSweep(
  candles,
  lookback = 20
) {

  if (
    candles.length <
    lookback +
      2
  ) {
    return {
      type:
        "NONE",

      level:
        null
    };
  }

  const last =
    candles.at(-1);

  const prior =
    candles.slice(
      -(lookback + 1),
      -1
    );

  const high =
    Math.max(
      ...prior.map(
        x => x.h
      )
    );

  const low =
    Math.min(
      ...prior.map(
        x => x.l
      )
    );

  if (
    last.h >
      high &&
    last.c <
      high
  ) {
    return {
      type:
        "BEARISH_BUYSIDE_SWEEP",

      level:
        high
    };
  }

  if (
    last.l <
      low &&
    last.c >
      low
  ) {
    return {
      type:
        "BULLISH_SELLSIDE_SWEEP",

      level:
        low
    };
  }

  return {
    type:
      "NONE",

    level:
      null
  };

}


function recentLevelSweep(
  candles,
  level,
  side,
  lookback
) {

  const target =
    finite(level);

  if (
    target === null
  ) {
    return null;
  }

  for (
    let i =
      candles.length -
      1;

    i >=
      Math.max(
        0,
        candles.length -
        lookback
      );

    i--
  ) {

    const c =
      candles[i];

    if (
      side ===
        "SELL_SIDE" &&
      c.l <
        target &&
      c.c >
        target
    ) {

      return {
        age:
          candles.length -
          1 -
          i,

        price:
          target
      };

    }

    if (
      side ===
        "BUY_SIDE" &&
      c.h >
        target &&
      c.c <
        target
    ) {

      return {
        age:
          candles.length -
          1 -
          i,

        price:
          target
      };

    }

  }

  return null;

}


/* =========================================================
   DISPLACEMENT
========================================================= */

function displacement(
  candles
) {

  const last =
    candles.at(-1);

  const a =
    atr(
      candles,
      14
    );

  if (
    !last ||
    !Number.isFinite(a) ||
    a <= 0
  ) {

    return {
      direction:
        "NONE",

      quality:
        0
    };

  }

  const range =
    Math.max(
      last.h -
        last.l,
      1e-9
    );

  const body =
    Math.abs(
      last.c -
      last.o
    );

  const bodyRatio =
    body /
    range;

  const rangeAtr =
    range /
    a;

  const bodyAtr =
    body /
    a;

  const closePosition =
    (
      last.c -
      last.l
    ) /
    range;

  let direction =
    "NONE";

  if (
    last.c >
      last.o &&
    bodyRatio >=
      0.58 &&
    rangeAtr >=
      0.80 &&
    bodyAtr >=
      0.48 &&
    closePosition >=
      0.70
  ) {
    direction =
      "BULLISH";
  }

  if (
    last.c <
      last.o &&
    bodyRatio >=
      0.58 &&
    rangeAtr >=
      0.80 &&
    bodyAtr >=
      0.48 &&
    closePosition <=
      0.30
  ) {
    direction =
      "BEARISH";
  }

  return {
    direction,

    bodyRatio:
      round(
        bodyRatio,
        2
      ),

    rangeAtr:
      round(
        rangeAtr,
        2
      ),

    quality:
      clamp(
        Math.round(
          bodyRatio *
            45 +
          Math.min(
            rangeAtr,
            2
          ) *
            20 +
          Math.min(
            bodyAtr,
            1.5
          ) *
            20
        ),
        0,
        100
      )
  };

}


/* =========================================================
   TREND
========================================================= */

function trend(
  closes
) {

  if (
    closes.length <
    50
  ) {
    return "NEUTRAL";
  }

  const price =
    closes.at(-1);

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

  const e200 =
    closes.length >=
      200
      ? ema(
          closes,
          200
        )
      : null;

  if (
    price >
      e20 &&
    e20 >
      e50 &&
    (
      e200 == null ||
      e50 >
        e200
    )
  ) {
    return "BULLISH";
  }

  if (
    price <
      e20 &&
    e20 <
      e50 &&
    (
      e200 == null ||
      e50 <
        e200
    )
  ) {
    return "BEARISH";
  }

  return "NEUTRAL";

}


/* =========================================================
   MOMENTUM
========================================================= */

function momentum(
  candles
) {

  const recent =
    candles.slice(-6);

  let bull = 0;
  let bear = 0;

  for (
    const candle of
    recent
  ) {

    const range =
      Math.max(
        candle.h -
          candle.l,
        1e-9
      );

    const strength =
      Math.abs(
        candle.c -
        candle.o
      ) /
      range;

    if (
      candle.c >
      candle.o
    ) {
      bull +=
        strength;
    }

    if (
      candle.c <
      candle.o
    ) {
      bear +=
        strength;
    }

  }

  if (
    bull >
    bear *
      1.25
  ) {
    return "BULLISH";
  }

  if (
    bear >
    bull *
      1.25
  ) {
    return "BEARISH";
  }

  return "MIXED";

}


/* =========================================================
   SNAPSHOT
========================================================= */

function snapshot(
  candles
) {

  const closes =
    candles.map(
      x => x.c
    );

  const swingData =
    swings(candles);

  const structureData =
    bos(
      candles,
      swingData
    );

  const sweep =
    genericSweep(candles);

  const m =
    macd(closes);

  return {
    price:
      round(
        closes.at(-1),
        2
      ),

    bias:
      trend(closes),

    structure:
      structureData.structure,

    momentum:
      momentum(candles),

    displacement:
      displacement(candles),

    indicators: {
      ema20:
        round(
          ema(
            closes,
            20
          ),
          2
        ),

      ema50:
        round(
          ema(
            closes,
            50
          ),
          2
        ),

      ema200:
        round(
          ema(
            closes,
            200
          ),
          2
        ),

      atr14:
        round(
          atr(
            candles,
            14
          ),
          2
        ),

      rsi14:
        round(
          rsi(
            closes,
            14
          ),
          1
        ),

      adx14:
        round(
          adx(
            candles,
            14
          ),
          1
        ),

      macdHistogram:
        round(
          m.histogram,
          5
        )
    },

    ict: {
      bos:
        structureData.bos,

      choch:
        structureData.choch,

      sweep: {
        type:
          sweep.type,

        level:
          round(
            sweep.level,
            2
          )
      },

      lastSwingHigh:
        round(
          swingData
            .highs
            .at(-1)
            ?.price,
          2
        ),

      lastSwingHighAge:
        swingData
          .highs
          .at(-1)
          ?.age ??
        null,

      lastSwingLow:
        round(
          swingData
            .lows
            .at(-1)
            ?.price,
          2
        ),

      lastSwingLowAge:
        swingData
          .lows
          .at(-1)
          ?.age ??
        null
    }
  };

}


/* =========================================================
   DAY LEVELS
========================================================= */

function dayLevels(
  candles
) {

  const groups =
    new Map();

  for (
    const candle of
    candles.slice(-5000)
  ) {

    const ms =
      parseUTC(
        candle.t
      );

    const key =
      zoneParts(
        ms,
        "America/New_York"
      ).dateKey;

    if (
      !groups.has(key)
    ) {
      groups.set(
        key,
        []
      );
    }

    groups
      .get(key)
      .push(candle);

  }

  const keys =
    [
      ...groups.keys()
    ].sort();

  function make(
    key
  ) {

    if (!key) {
      return null;
    }

    const g =
      groups.get(key);

    if (
      !g?.length
    ) {
      return null;
    }

    return {
      date:
        key,

      open:
        g[0].o,

      high:
        Math.max(
          ...g.map(
            x => x.h
          )
        ),

      low:
        Math.min(
          ...g.map(
            x => x.l
          )
        ),

      close:
        g.at(-1).c
    };

  }

  return {
    current:
      make(
        keys.at(-1)
      ),

    previous:
      make(
        keys.at(-2)
      )
  };

}


/* =========================================================
   ASIAN RANGE
========================================================= */

function asianRange(
  candles
) {

  if (
    !candles.length
  ) {
    return null;
  }

  const latest =
    parseUTC(
      candles.at(-1).t
    );

  const londonNow =
    zoneParts(
      latest,
      "Europe/London"
    );

  const group =
    candles.filter(
      candle => {

        const p =
          zoneParts(
            parseUTC(
              candle.t
            ),
            "Europe/London"
          );

        return (
          p.dateKey ===
            londonNow.dateKey &&
          p.hour >= 0 &&
          p.hour < 8
        );

      }
    );

  if (
    !group.length
  ) {
    return null;
  }

  return {
    high:
      Math.max(
        ...group.map(
          x => x.h
        )
      ),

    low:
      Math.min(
        ...group.map(
          x => x.l
        )
      ),

    complete:
      londonNow.hour >=
      8
  };

}


/* =========================================================
   GOLD LIQUIDITY CONTEXT
========================================================= */

function goldContext(
  packet,
  m1
) {

  const days =
    dayLevels(m1);

  const asia =
    asianRange(m1);

  let bullish = 0;
  let bearish = 0;

  const signals = [];

  function ageWeight(
    age
  ) {

    if (
      age <= 1
    ) {
      return 1;
    }

    if (
      age <= 3
    ) {
      return 0.85;
    }

    if (
      age <= 6
    ) {
      return 0.65;
    }

    return 0.45;

  }

  if (
    asia?.complete
  ) {

    const low =
      recentLevelSweep(
        m1,
        asia.low,
        "SELL_SIDE",
        10
      );

    const high =
      recentLevelSweep(
        m1,
        asia.high,
        "BUY_SIDE",
        10
      );

    if (low) {
      bullish +=
        36 *
        ageWeight(
          low.age
        );

      signals.push(
        `Asian low swept ${low.age} M1 bars ago.`
      );
    }

    if (high) {
      bearish +=
        36 *
        ageWeight(
          high.age
        );

      signals.push(
        `Asian high swept ${high.age} M1 bars ago.`
      );
    }

  }

  const previous =
    days.previous;

  if (previous) {

    const pdl =
      recentLevelSweep(
        m1,
        previous.low,
        "SELL_SIDE",
        12
      );

    const pdh =
      recentLevelSweep(
        m1,
        previous.high,
        "BUY_SIDE",
        12
      );

    if (pdl) {
      bullish +=
        30 *
        ageWeight(
          pdl.age
        );

      signals.push(
        `Previous-day low swept ${pdl.age} M1 bars ago.`
      );
    }

    if (pdh) {
      bearish +=
        30 *
        ageWeight(
          pdh.age
        );

      signals.push(
        `Previous-day high swept ${pdh.age} M1 bars ago.`
      );
    }

  }

  if (
    packet.M1.ict
      .sweep.type ===
    "BULLISH_SELLSIDE_SWEEP"
  ) {
    bullish += 18;
  }

  if (
    packet.M1.ict
      .sweep.type ===
    "BEARISH_BUYSIDE_SWEEP"
  ) {
    bearish += 18;
  }

  if (
    packet.M1
      .displacement
      .direction ===
    "BULLISH"
  ) {
    bullish += 12;
  }

  if (
    packet.M1
      .displacement
      .direction ===
    "BEARISH"
  ) {
    bearish += 12;
  }

  if (
    packet.M5
      .displacement
      .direction ===
    "BULLISH"
  ) {
    bullish += 12;
  }

  if (
    packet.M5
      .displacement
      .direction ===
    "BEARISH"
  ) {
    bearish += 12;
  }

  return {
    asianRange:
      asia
        ? {
            high:
              round(
                asia.high,
                2
              ),

            low:
              round(
                asia.low,
                2
              ),

            complete:
              asia.complete
          }
        : null,

    previousDay:
      previous
        ? {
            high:
              round(
                previous.high,
                2
              ),

            low:
              round(
                previous.low,
                2
              ),

            close:
              round(
                previous.close,
                2
              )
          }
        : null,

    bullishLiquidityScore:
      clamp(
        Math.round(
          bullish
        ),
        0,
        100
      ),

    bearishLiquidityScore:
      clamp(
        Math.round(
          bearish
        ),
        0,
        100
      ),

    signals
  };

}


/* =========================================================
   REGIME
========================================================= */

function regime(
  packet
) {

  const adx5 =
    finite(
      packet.M5
        .indicators
        .adx14
    ) ??
    0;

  const adx15 =
    finite(
      packet.M15
        .indicators
        .adx14
    ) ??
    0;

  if (
    packet.M15.bias ===
      "BULLISH" &&
    packet.M5.bias ===
      "BULLISH" &&
    adx5 >= 23
  ) {

    return {
      name:
        "TRENDING_BULLISH",

      quality:
        clamp(
          Math.round(
            68 +
            adx5 -
            23
          ),
          68,
          92
        ),

      volatility:
        adx5 >=
          35
          ? "HIGH"
          : "NORMAL"
    };

  }

  if (
    packet.M15.bias ===
      "BEARISH" &&
    packet.M5.bias ===
      "BEARISH" &&
    adx5 >= 23
  ) {

    return {
      name:
        "TRENDING_BEARISH",

      quality:
        clamp(
          Math.round(
            68 +
            adx5 -
            23
          ),
          68,
          92
        ),

      volatility:
        adx5 >=
          35
          ? "HIGH"
          : "NORMAL"
    };

  }

  if (
    packet.M5.ict.bos ===
      "BULLISH_BOS"
  ) {

    return {
      name:
        "BREAKOUT_BULLISH",

      quality:
        75,

      volatility:
        "EXPANDING"
    };

  }

  if (
    packet.M5.ict.bos ===
      "BEARISH_BOS"
  ) {

    return {
      name:
        "BREAKOUT_BEARISH",

      quality:
        75,

      volatility:
        "EXPANDING"
    };

  }

  if (
    adx5 < 17 &&
    adx15 < 19
  ) {

    return {
      name:
        "RANGE",

      quality:
        42,

      volatility:
        "LOW"
    };

  }

  return {
    name:
      "MIXED",

    quality:
      52,

    volatility:
      "NORMAL"
  };

}


/* =========================================================
   SIGN
========================================================= */

function sign(
  value
) {

  if (
    [
      "BULLISH",
      "HH/HL",
      "BULLISH_BOS",
      "BULLISH_CHOCH"
    ].includes(value)
  ) {
    return 1;
  }

  if (
    [
      "BEARISH",
      "LH/LL",
      "BEARISH_BOS",
      "BEARISH_CHOCH"
    ].includes(value)
  ) {
    return -1;
  }

  return 0;

}


/* =========================================================
   MODULE RESULT
========================================================= */

function moduleResult(
  name,
  signal,
  reliability,
  reasons
) {

  const score =
    clamp(
      Math.round(
        signal
      ),
      -100,
      100
    );

  return {
    name,

    signal:
      score,

    reliability:
      clamp(
        Math.round(
          reliability
        ),
        0,
        100
      ),

    bias:
      score >= 12
        ? "BULLISH"
        : score <= -12
          ? "BEARISH"
          : "NEUTRAL",

    reasons:
      reasons.filter(Boolean)
  };

}


/* =========================================================
   MODULES
========================================================= */

function modules(
  packet
) {

  const trendSignal =
    sign(
      packet.H1.bias
    ) *
      25 +
    sign(
      packet.M15.bias
    ) *
      35 +
    sign(
      packet.M5.bias
    ) *
      28 +
    sign(
      packet.M1.bias
    ) *
      12;

  const structureSignal =
    sign(
      packet.M15.structure
    ) *
      15 +
    sign(
      packet.M5.structure
    ) *
      20 +
    sign(
      packet.M5.ict.bos
    ) *
      25 +
    sign(
      packet.M1.ict.bos
    ) *
      24 +
    sign(
      packet.M1.ict.choch
    ) *
      16;

  let liquiditySignal =
    packet.gold
      .bullishLiquidityScore -
    packet.gold
      .bearishLiquidityScore;

  if (
    packet.M1.ict
      .sweep.type ===
    "BULLISH_SELLSIDE_SWEEP"
  ) {
    liquiditySignal += 15;
  }

  if (
    packet.M1.ict
      .sweep.type ===
    "BEARISH_BUYSIDE_SWEEP"
  ) {
    liquiditySignal -= 15;
  }

  let momentumSignal =
    sign(
      packet.M1.momentum
    ) *
      30 +
    sign(
      packet.M5.momentum
    ) *
      35;

  const macd1 =
    finite(
      packet.M1
        .indicators
        .macdHistogram
    ) ??
    0;

  const macd5 =
    finite(
      packet.M5
        .indicators
        .macdHistogram
    ) ??
    0;

  momentumSignal +=
    macd1 > 0
      ? 18
      : macd1 < 0
        ? -18
        : 0;

  momentumSignal +=
    macd5 > 0
      ? 12
      : macd5 < 0
        ? -12
        : 0;

  const r =
    finite(
      packet.M1
        .indicators
        .rsi14
    ) ??
    50;

  momentumSignal +=
    clamp(
      (
        r -
        50
      ) *
        0.5,
      -10,
      10
    );

  let goldSignal = 0;

  if (
    packet.M1
      .displacement
      .direction ===
    "BULLISH"
  ) {
    goldSignal += 35;
  }

  if (
    packet.M1
      .displacement
      .direction ===
    "BEARISH"
  ) {
    goldSignal -= 35;
  }

  if (
    packet.M5
      .displacement
      .direction ===
    "BULLISH"
  ) {
    goldSignal += 35;
  }

  if (
    packet.M5
      .displacement
      .direction ===
    "BEARISH"
  ) {
    goldSignal -= 35;
  }

  if (
    mainGoldSession(
      packet.session
    )
  ) {

    goldSignal +=
      sign(
        packet.M15.bias
      ) *
      15;

  }

  return [
    moduleResult(
      "trend",
      trendSignal,
      75,
      [
        `H1 ${packet.H1.bias}`,
        `M15 ${packet.M15.bias}`,
        `M5 ${packet.M5.bias}`
      ]
    ),

    moduleResult(
      "structure",
      structureSignal,
      72,
      [
        `M5 ${packet.M5.ict.bos}`,
        `M1 ${packet.M1.ict.bos}`,
        `M1 ${packet.M1.ict.choch}`
      ]
    ),

    moduleResult(
      "liquidity",
      liquiditySignal,
      76,
      packet.gold.signals
    ),

    moduleResult(
      "momentum",
      momentumSignal,
      67,
      [
        `M1 ${packet.M1.momentum}`,
        `M5 ${packet.M5.momentum}`,
        `RSI ${round(r, 1)}`
      ]
    ),

    moduleResult(
      "gold",
      goldSignal,
      70,
      [
        `${packet.session} session`,
        `M1 displacement ${packet.M1.displacement.direction}`,
        `M5 displacement ${packet.M5.displacement.direction}`
      ]
    )
  ];

}


/* =========================================================
   ENTRY TRIGGER
========================================================= */

function entryTrigger(
  direction,
  packet
) {

  if (
    direction ===
    "BUY"
  ) {

    const liquidity =
      packet.gold
        .bullishLiquidityScore >= 25 ||
      packet.M1.ict
        .sweep.type ===
        "BULLISH_SELLSIDE_SWEEP";

    const structureOK =
      packet.M1.ict.bos ===
        "BULLISH_BOS" ||
      packet.M1.ict.choch ===
        "BULLISH_CHOCH" ||
      packet.M5.ict.bos ===
        "BULLISH_BOS";

    const expansion =
      packet.M1
        .displacement
        .direction ===
        "BULLISH" ||
      packet.M5
        .displacement
        .direction ===
        "BULLISH";

    const momentumOK =
      packet.M1.momentum ===
        "BULLISH" ||
      (
        finite(
          packet.M1
            .indicators
            .macdHistogram
        ) ??
        0
      ) > 0;

    return (
      (
        liquidity ||
        structureOK
      ) &&
      expansion &&
      momentumOK
    );

  }

  if (
    direction ===
    "SELL"
  ) {

    const liquidity =
      packet.gold
        .bearishLiquidityScore >= 25 ||
      packet.M1.ict
        .sweep.type ===
        "BEARISH_BUYSIDE_SWEEP";

    const structureOK =
      packet.M1.ict.bos ===
        "BEARISH_BOS" ||
      packet.M1.ict.choch ===
        "BEARISH_CHOCH" ||
      packet.M5.ict.bos ===
        "BEARISH_BOS";

    const expansion =
      packet.M1
        .displacement
        .direction ===
        "BEARISH" ||
      packet.M5
        .displacement
        .direction ===
        "BEARISH";

    const momentumOK =
      packet.M1.momentum ===
        "BEARISH" ||
      (
        finite(
          packet.M1
            .indicators
            .macdHistogram
        ) ??
        0
      ) < 0;

    return (
      (
        liquidity ||
        structureOK
      ) &&
      expansion &&
      momentumOK
    );

  }

  return false;

}


/* =========================================================
   SCORE
========================================================= */

function score(
  packet
) {

  const list =
    modules(packet);

  let numerator = 0;
  let denominator = 0;
  let qualityTotal = 0;
  let weightTotal = 0;

  for (
    const module of
    list
  ) {

    const weight =
      WEIGHTS[module.name];

    const reliability =
      module.reliability /
      100;

    numerator +=
      module.signal *
      weight *
      reliability;

    denominator +=
      weight *
      reliability;

    qualityTotal +=
      module.reliability *
      weight;

    weightTotal +=
      weight;

  }

  const signed =
    denominator
      ? numerator /
        denominator
      : 0;

  const signal =
    Math.abs(signed) <
      MIN_SIGNAL_STRENGTH
      ? "WAIT"
      : signed >
          0
        ? "BUY"
        : "SELL";

  const buyScore =
    clamp(
      Math.round(
        50 +
        signed /
          2
      ),
      0,
      100
    );

  const sellScore =
    clamp(
      Math.round(
        50 -
        signed /
          2
      ),
      0,
      100
    );

  const best =
    Math.max(
      buyScore,
      sellScore
    );

  const margin =
    Math.abs(
      buyScore -
      sellScore
    );

  let quality =
    qualityTotal /
    weightTotal;

  let aligned = 0;
  let directional = 0;

  for (
    const module of
    list
  ) {

    if (
      module.name ===
      "gold"
    ) {
      continue;
    }

    if (
      Math.abs(
        module.signal
      ) < 12
    ) {
      continue;
    }

    const w =
      WEIGHTS[
        module.name
      ] *
      module.reliability /
      100;

    directional += w;

    if (
      signal === "BUY" &&
      module.signal > 0
    ) {
      aligned += w;
    }

    if (
      signal === "SELL" &&
      module.signal < 0
    ) {
      aligned += w;
    }

  }

  const agreement =
    directional
      ? aligned /
        directional *
        100
      : 0;

  const penalties = [];

  const atr1 =
    Math.max(
      finite(
        packet.M1
          .indicators
          .atr14
      ) ??
        0.01,
      0.01
    );

  const e20 =
    finite(
      packet.M1
        .indicators
        .ema20
    );

  const stretch =
    e20 === null
      ? 0
      : Math.abs(
          packet.anchor -
          e20
        ) /
        atr1;

  if (
    stretch >
    MAX_ENTRY_STRETCH_ATR
  ) {

    quality -= 18;

    penalties.push(
      `Signal candle stretched ${round(
        stretch,
        2
      )} ATR from M1 EMA20.`
    );

  }

  if (
    signal === "BUY" &&
    packet.M5.bias ===
      "BEARISH" &&
    packet.M15.bias ===
      "BEARISH"
  ) {

    quality -= 20;

    penalties.push(
      "BUY conflicts with M5 and M15."
    );

  }

  if (
    signal === "SELL" &&
    packet.M5.bias ===
      "BULLISH" &&
    packet.M15.bias ===
      "BULLISH"
  ) {

    quality -= 20;

    penalties.push(
      "SELL conflicts with M5 and M15."
    );

  }

  if (
    !mainGoldSession(
      packet.session
    )
  ) {

    quality -=
      packet.session ===
        "ASIA"
        ? 8
        : 16;

    penalties.push(
      `${packet.session} has reduced gold scalp quality.`
    );

  }

  if (
    agreement <
    MIN_AGREEMENT
  ) {

    quality -= 10;

    penalties.push(
      `Module agreement ${round(
        agreement,
        0
      )}%.`
    );

  }

  quality =
    clamp(
      Math.round(
        quality
      ),
      0,
      100
    );

  const trigger =
    entryTrigger(
      signal,
      packet
    );

  let direction =
    "WAIT";

  if (
    signal !== "WAIT" &&
    best >= MIN_SCORE &&
    margin >= MIN_MARGIN &&
    quality >= MIN_QUALITY &&
    agreement >=
      MIN_AGREEMENT &&
    trigger
  ) {

    direction =
      signal;

  }

  return {
    signal,

    direction,

    signedSignal:
      round(
        signed,
        1
      ),

    buyScore,

    sellScore,

    score:
      best,

    margin,

    quality,

    agreementPct:
      round(
        agreement,
        1
      ),

    entryTrigger:
      trigger,

    stretchAtr:
      round(
        stretch,
        2
      ),

    modules:
      list,

    penalties
  };

}


/* =========================================================
   LIVE STATE
========================================================= */

function liveState(
  technical,
  packet,
  livePrice
) {

  const atr1 =
    finite(
      packet.M1
        .indicators
        .atr14
    );

  if (
    technical.signal ===
      "WAIT"
  ) {

    return {
      state:
        "SEARCHING",

      direction:
        null,

      entryAllowed:
        false,

      message:
        "No strong directional gold signal yet."
    };

  }

  if (
    technical.direction ===
      "WAIT"
  ) {

    return {
      state:
        "SETUP_FORMING",

      direction:
        technical.signal,

      entryAllowed:
        false,

      message:
        `${technical.signal} pressure detected. Waiting for the remaining entry filters.`
    };

  }

  if (
    atr1 === null ||
    atr1 <= 0
  ) {

    return {
      state:
        "SEARCHING",

      direction:
        technical.signal,

      entryAllowed:
        false,

      message:
        "Waiting for valid M1 volatility data."
    };

  }

  const distance =
    (
      livePrice -
      packet.anchor
    ) /
    atr1;

  const abs =
    Math.abs(distance);

  if (
    abs >
    MAX_LIVE_DEVIATION_ATR
  ) {

    return {
      state:
        "CHASE_BLOCK",

      direction:
        technical.direction,

      entryAllowed:
        false,

      distanceAtr:
        round(abs, 2),

      message:
        "Setup exists, but live gold has moved too far. Do not chase."
    };

  }

  if (
    technical.direction ===
      "BUY" &&
    distance >
      ENTRY_ZONE_ATR
  ) {

    return {
      state:
        "WAITING_FOR_RETEST",

      direction:
        "BUY",

      entryAllowed:
        false,

      distanceAtr:
        round(abs, 2),

      message:
        "BUY setup detected. Waiting for gold to pull back into the entry zone."
    };

  }

  if (
    technical.direction ===
      "SELL" &&
    distance <
      -ENTRY_ZONE_ATR
  ) {

    return {
      state:
        "WAITING_FOR_RETEST",

      direction:
        "SELL",

      entryAllowed:
        false,

      distanceAtr:
        round(abs, 2),

      message:
        "SELL setup detected. Waiting for gold to bounce into the entry zone."
    };

  }

  return {
    state:
      "ENTRY_ZONE",

    direction:
      technical.direction,

    entryAllowed:
      true,

    distanceAtr:
      round(abs, 2),

    message:
      `${technical.direction} setup is inside the live entry zone.`
  };

}


/* =========================================================
   TARGET LEVELS
========================================================= */

function targets(
  direction,
  packet,
  entry
) {

  const levels = [];

  function add(
    price,
    name
  ) {

    const value =
      finite(price);

    if (
      value === null
    ) {
      return;
    }

    if (
      direction === "BUY" &&
      value > entry
    ) {
      levels.push({
        price:
          value,
        name
      });
    }

    if (
      direction === "SELL" &&
      value < entry
    ) {
      levels.push({
        price:
          value,
        name
      });
    }

  }

  add(
    packet.gold
      ?.asianRange
      ?.high,
    "Asian high"
  );

  add(
    packet.gold
      ?.asianRange
      ?.low,
    "Asian low"
  );

  add(
    packet.gold
      ?.previousDay
      ?.high,
    "Previous-day high"
  );

  add(
    packet.gold
      ?.previousDay
      ?.low,
    "Previous-day low"
  );

  add(
    packet.M5
      .ict
      .lastSwingHigh,
    "M5 swing high"
  );

  add(
    packet.M5
      .ict
      .lastSwingLow,
    "M5 swing low"
  );

  return levels.sort(
    (a, b) =>
      Math.abs(
        a.price -
        entry
      ) -
      Math.abs(
        b.price -
        entry
      )
  );

}


/* =========================================================
   RISK PLAN
========================================================= */

function riskPlan(
  direction,
  packet,
  entry
) {

  if (
    direction === "WAIT"
  ) {

    return {
      valid:
        false,

      reason:
        "No directional signal."
    };

  }

  const atr1 =
    finite(
      packet.M1
        .indicators
        .atr14
    );

  if (
    atr1 === null ||
    atr1 <= 0
  ) {

    return {
      valid:
        false,

      reason:
        "M1 ATR unavailable."
    };

  }

  const low =
    finite(
      packet.M1
        .ict
        .lastSwingLow
    );

  const high =
    finite(
      packet.M1
        .ict
        .lastSwingHigh
    );

  const lowAge =
    finite(
      packet.M1
        .ict
        .lastSwingLowAge
    );

  const highAge =
    finite(
      packet.M1
        .ict
        .lastSwingHighAge
    );

  const buffer =
    atr1 *
    0.15;

  let stop;

  if (
    direction === "BUY"
  ) {

    stop =
      low !== null &&
      lowAge !== null &&
      lowAge <=
        MAX_SWING_AGE &&
      low < entry
        ? low -
          buffer
        : entry -
          atr1;

  }
  else {

    stop =
      high !== null &&
      highAge !== null &&
      highAge <=
        MAX_SWING_AGE &&
      high > entry
        ? high +
          buffer
        : entry +
          atr1;

  }

  let risk =
    Math.abs(
      entry -
      stop
    );

  const minimum =
    atr1 *
    MIN_STOP_ATR;

  if (
    risk <
    minimum
  ) {

    risk =
      minimum;

    stop =
      direction ===
        "BUY"
        ? entry -
          risk
        : entry +
          risk;

  }

  const stopAtr =
    risk /
    atr1;

  if (
    stopAtr >
    MAX_STOP_ATR
  ) {

    return {
      valid:
        false,

      reason:
        `Stop is ${round(
          stopAtr,
          2
        )} ATR wide.`
    };

  }

  const liquidityTargets =
    targets(
      direction,
      packet,
      entry
    );

  const nearest =
    liquidityTargets[0];

  if (nearest) {

    const room =
      Math.abs(
        nearest.price -
        entry
      ) /
      risk;

    if (
      room <
      MIN_ROOM_R
    ) {

      return {
        valid:
          false,

        reason:
          `${nearest.name} is only ${round(
            room,
            2
          )}R away.`
      };

    }

  }

  const multiplier =
    direction ===
      "BUY"
      ? 1
      : -1;

  const tp1 =
    entry +
    multiplier *
      risk *
      TP1_R;

  let tp2 =
    entry +
    multiplier *
      risk *
      TP2_R;

  /*
     Only shorten TP2 to liquidity.
     Never extend it beyond TP2_R.
  */

  const inward =
    liquidityTargets.find(
      target => {

        const rr =
          Math.abs(
            target.price -
            entry
          ) /
          risk;

        return (
          rr >= 1.30 &&
          rr <
            TP2_R
        );

      }
    );

  if (inward) {
    tp2 =
      inward.price;
  }

  const rr2 =
    Math.abs(
      tp2 -
      entry
    ) /
      risk;

  return {
    valid:
      true,

    entry:
      round(
        entry,
        2
      ),

    stopLoss:
      round(
        stop,
        2
      ),

    takeProfit1:
      round(
        tp1,
        2
      ),

    takeProfit2:
      round(
        tp2,
        2
      ),

    riskDistance:
      round(
        risk,
        2
      ),

    stopAtr:
      round(
        stopAtr,
        2
      ),

    riskRewardTP1:
      `1:${round(
        TP1_R,
        2
      )}`,

    riskRewardTP2:
      `1:${round(
        rr2,
        2
      )}`,

    targetLiquidity:
      inward?.name ||
      nearest?.name ||
      null,

    management: {
      moveStopToBreakevenAtR:
        0.8,

      partialTakeProfitAtR:
        1.0,

      maxHoldMinutes:
        MAX_HOLD_MINUTES
    }
  };

}


/* =========================================================
   ACCOUNT
========================================================= */

function accountProtection(
  body
) {

  const equity =
    finite(
      body.equity
    ) ??
    DEFAULT_EQUITY;

  const pnl =
    finite(
      body.dailyPnL
    ) ??
    0;

  const trades =
    finite(
      body.tradesToday
    ) ??
    0;

  const losses =
    finite(
      body.consecutiveLosses
    ) ??
    0;

  const minutes =
    finite(
      body.minutesSinceLastLoss
    ) ??
    999;

  const maxRisk =
    equity *
    RISK_PCT /
    100;

  const dailyLimit =
    equity *
    DAILY_LOSS_PCT /
    100;

  const blockers = [];

  if (
    pnl <=
    -dailyLimit
  ) {
    blockers.push(
      "Daily loss limit reached."
    );
  }

  if (
    trades >=
    MAX_TRADES
  ) {
    blockers.push(
      "Maximum trades reached."
    );
  }

  if (
    losses >=
    MAX_LOSSES
  ) {
    blockers.push(
      "Loss-streak protection active."
    );
  }

  if (
    minutes <
    LOSS_COOLDOWN
  ) {
    blockers.push(
      "Loss cooldown active."
    );
  }

  return {
    allowed:
      blockers.length ===
      0,

    equityZAR:
      round(
        equity,
        2
      ),

    riskPercent:
      RISK_PCT,

    maxRiskZAR:
      round(
        maxRisk,
        2
      ),

    dailyLossLimitZAR:
      round(
        dailyLimit,
        2
      ),

    blockers
  };

}


/* =========================================================
   BROKER SIZING
========================================================= */

function floorStep(
  value,
  step
) {

  return (
    Math.floor(
      (
        value +
        1e-12
      ) /
      step
    ) *
    step
  );

}


function positionSize(
  body,
  account,
  plan,
  packet
) {

  const bid =
    finite(
      body.bid
    );

  const ask =
    finite(
      body.ask
    );

  const spread =
    bid !== null &&
    ask !== null &&
    ask >= bid
      ? ask -
        bid
      : null;

  const atr1 =
    finite(
      packet.M1
        .indicators
        .atr14
    );

  const maxSpread =
    atr1 !== null
      ? Math.min(
          MAX_SPREAD_USD,
          Math.max(
            0.15,
            atr1 *
            MAX_SPREAD_ATR
          )
        )
      : MAX_SPREAD_USD;

  if (
    spread !== null &&
    spread >
      maxSpread
  ) {

    return {
      valid:
        false,

      executionReady:
        false,

      spread:
        round(
          spread,
          2
        ),

      reason:
        "Gold spread is too wide."
    };

  }

  if (
    !plan.valid
  ) {

    return {
      valid:
        false,

      executionReady:
        false,

      spread:
        round(
          spread,
          2
        ),

      reason:
        plan.reason
    };

  }

  const tickSize =
    finite(
      body.tickSize
    );

  const tickValue =
    finite(
      body.tickValuePerLotZAR
    );

  const minLot =
    finite(
      body.minLot
    );

  const step =
    finite(
      body.lotStep
    );

  if (
    [
      tickSize,
      tickValue,
      minLot,
      step
    ].some(
      x =>
        x === null ||
        x <= 0
    )
  ) {

    return {
      valid:
        true,

      executionReady:
        false,

      spread:
        round(
          spread,
          2
        ),

      reason:
        "Broker lot specifications are not connected."
    };

  }

  const ticks =
    plan.riskDistance /
    tickSize;

  const riskPerLot =
    ticks *
    tickValue;

  const rawLot =
    account.maxRiskZAR /
    riskPerLot;

  const lot =
    floorStep(
      rawLot,
      step
    );

  if (
    lot <
    minLot
  ) {

    return {
      valid:
        false,

      executionReady:
        false,

      minimumLot:
        minLot,

      minimumLotRiskZAR:
        round(
          riskPerLot *
          minLot,
          2
        ),

      reason:
        "Broker minimum lot risks too much for this account."
    };

  }

  const actualRisk =
    lot *
    riskPerLot;

  return {
    valid:
      actualRisk <=
      account.maxRiskZAR +
      0.01,

    executionReady:
      true,

    lot:
      round(
        lot,
        4
      ),

    spread:
      round(
        spread,
        2
      ),

    estimatedRiskZAR:
      round(
        actualRisk,
        2
      )
  };

}


/* =========================================================
   NEWS
========================================================= */

function newsGuard(
  body
) {

  if (
    body.highImpactUsdNews ===
    true
  ) {

    return {
      connected:
        true,

      allowed:
        false,

      reason:
        "High-impact USD news is active."
    };

  }

  const minutes =
    finite(
      body.minutesToHighImpactUsdNews
    );

  if (
    minutes !== null
  ) {

    if (
      minutes >= 0 &&
      minutes <= 20
    ) {

      return {
        connected:
          true,

        allowed:
          false,

        minutesToNews:
          minutes,

        reason:
          `High-impact USD event in ${minutes} minutes.`
      };

    }

    return {
      connected:
        true,

      allowed:
        true,

      minutesToNews:
        minutes
    };

  }

  return {
    connected:
      false,

    allowed:
      true,

    warning:
      "USD economic calendar is not connected."
  };

}


/* =========================================================
   PERMISSION
========================================================= */

function permission(
  packet,
  technical,
  state,
  plan,
  account,
  sizing,
  news
) {

  const blockers = [];
  const warnings = [];

  function need(
    condition,
    message
  ) {

    if (!condition) {
      blockers.push(
        message
      );
    }

  }

  need(
    packet.dataFresh,
    "M1 market data is stale."
  );

  need(
    technical.direction !==
      "WAIT",
    "Technical setup has not fully qualified."
  );

  need(
    technical.entryTrigger,
    "Entry trigger is incomplete."
  );

  need(
    state.entryAllowed,
    state.message
  );

  need(
    plan.valid,
    plan.reason ||
    "Risk plan invalid."
  );

  need(
    account.allowed,
    account.blockers
      .join(" ") ||
    "Account protection blocked trade."
  );

  need(
    news.allowed,
    news.reason ||
    "USD news block."
  );

  if (
    sizing.valid === false &&
    (
      sizing.reason
        ?.toLowerCase()
        .includes("spread") ||
      sizing.reason
        ?.toLowerCase()
        .includes("minimum lot")
    )
  ) {

    blockers.push(
      sizing.reason
    );

  }

  if (
    !sizing.executionReady
  ) {

    warnings.push(
      sizing.reason ||
      "Broker execution sizing unavailable."
    );

  }

  if (
    !news.connected
  ) {

    warnings.push(
      "News calendar is not connected."
    );

  }

  return {
    allowed:
      blockers.length ===
      0,

    state:
      blockers.length ===
      0
        ? "APPROVED"
        : "BLOCKED",

    blockers:
      [
        ...new Set(blockers)
      ],

    warnings:
      [
        ...new Set(warnings)
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
    "no-store"
  );

  res.setHeader(
    "Allow",
    "GET,POST,OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
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

    const body =
      bodyOf(req);

    /*
       Fetch three feeds simultaneously.

       Cold startup:
       M1 + H1 + live price.

       After that caches greatly reduce requests.
    */

    const [
      m1Result,
      h1Result,
      priceResult
    ] =
      await Promise.all([
        cached(
          "m1",
          M1_CACHE_MS,
          () =>
            fetchSeries(
              "1min",
              M1_OUTPUT
            )
        ),

        cached(
          "h1",
          H1_CACHE_MS,
          () =>
            fetchSeries(
              "1h",
              H1_OUTPUT
            )
        ),

        cached(
          "price",
          PRICE_CACHE_MS,
          fetchLivePrice
        )
      ]);

    const rawM1 =
      m1Result.value;

    const rawH1 =
      h1Result.value;

    const livePrice =
      priceResult.value;

    const m1 =
      completed(
        rawM1,
        1
      );

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

    const h1 =
      completed(
        rawH1,
        60
      );

    if (
      m1.length < 300 ||
      m5.length < 60 ||
      m15.length < 40 ||
      h1.length < 50
    ) {

      throw new Error(
        "Not enough completed XAU/USD candles."
      );

    }

    const latestM1 =
      m1.at(-1);

    const candleEnd =
      parseUTC(
        latestM1.t
      ) +
      60_000;

    const dataAge =
      Date.now() -
      candleEnd;

    const packet = {
      anchor:
        latestM1.c,

      signalCandleTime:
        latestM1.t,

      dataFresh:
        dataAge <=
        STALE_MS,

      dataAgeSeconds:
        Math.max(
          0,
          Math.floor(
            dataAge /
            1000
          )
        ),

      session:
        sessionFor(
          parseUTC(
            latestM1.t
          )
        ),

      M1:
        snapshot(m1),

      M5:
        snapshot(m5),

      M15:
        snapshot(m15),

      H1:
        snapshot(h1)
    };

    packet.gold =
      goldContext(
        packet,
        m1
      );

    packet.regime =
      regime(packet);

    const technical =
      score(packet);

    /*
       Signal always represents what MKAYFX sees now,
       even when final trade approval remains blocked.
    */

    const signal =
      technical.signal;

    const state =
      liveState(
        technical,
        packet,
        livePrice
      );

    /*
       Preview trade plan uses the directional signal.

       This means BUY/SELL can immediately show levels,
       but it remains BLOCKED until final permission passes.
    */

    const previewPlan =
      riskPlan(
        signal,
        packet,
        livePrice
      );

    const account =
      accountProtection(body);

    const sizing =
      positionSize(
        body,
        account,
        previewPlan,
        packet
      );

    const news =
      newsGuard(body);

    const tradePermission =
      permission(
        packet,
        technical,
        state,
        previewPlan,
        account,
        sizing,
        news
      );

    const action =
      tradePermission.allowed
        ? technical.direction
        : "WAIT";

    let strength =
      Math.round(
        technical.score *
          0.50 +
        technical.quality *
          0.28 +
        technical.agreementPct *
          0.22
      );

    strength =
      clamp(
        strength,
        0,
        96
      );

    const analysis = {
      /*
         signal = immediate analysis.
         action = approved trade.
      */

      signal,

      action,

      tradeApproved:
        tradePermission.allowed,

      candidateDirection:
        technical.direction !==
          "WAIT"
          ? technical.direction
          : signal,

      setupStrength:
        strength,

      confidence:
        strength,

      confidenceType:
        "SETUP_STRENGTH_NOT_WIN_PROBABILITY",

      strategy:
        "MKAYFX GOLD V8 LIVE",

      symbol:
        SYMBOL,

      session:
        packet.session,

      regime:
        packet.regime,

      currentPrice:
        round(
          livePrice,
          2
        ),

      signalAnchorPrice:
        round(
          packet.anchor,
          2
        ),

      signalCandleTime:
        packet.signalCandleTime,

      liveState:
        state,

      timeframeBias: {
        M1:
          packet.M1.bias,

        M5:
          packet.M5.bias,

        M15:
          packet.M15.bias,

        H1:
          packet.H1.bias
      },

      goldContext:
        packet.gold,

      /*
         Show preview levels immediately when there
         is BUY/SELL pressure.

         Final approval is still separate.
      */

      entry:
        previewPlan.valid
          ? previewPlan.entry
          : null,

      stopLoss:
        previewPlan.valid
          ? previewPlan.stopLoss
          : null,

      takeProfit1:
        previewPlan.valid
          ? previewPlan.takeProfit1
          : null,

      takeProfit2:
        previewPlan.valid
          ? previewPlan.takeProfit2
          : null,

      riskRewardTP1:
        previewPlan.valid
          ? previewPlan.riskRewardTP1
          : "—",

      riskRewardTP2:
        previewPlan.valid
          ? previewPlan.riskRewardTP2
          : "—",

      riskPlan:
        previewPlan,

      management:
        previewPlan.management ||
        null,

      accountProtection:
        account,

      executionSizing:
        sizing,

      newsGuard:
        news,

      tradePermission,

      technical,

      invalidation:
        previewPlan.valid
          ? signal ===
              "BUY"
            ? `Bullish idea invalid below ${previewPlan.stopLoss}.`
            : signal ===
                "SELL"
              ? `Bearish idea invalid above ${previewPlan.stopLoss}.`
              : "No active setup."
          : "No valid risk structure yet.",

      nextTrigger:
        action !== "WAIT"
          ? `${action} LIVE ENTRY APPROVED.`
          : state.message
    };

    return send(
      res,
      200,
      {
        success:
          true,

        model:
          "MKAYFX GOLD V8 LIVE",

        symbol:
          SYMBOL,

        live:
          true,

        price:
          round(
            livePrice,
            2
          ),

        signal,

        action,

        trade_approved:
          tradePermission.allowed,

        live_state:
          state,

        analysis,

        chart:
          m1
            .slice(-160)
            .map(
              candle => ({
                t:
                  candle.t,

                o:
                  round(
                    candle.o,
                    2
                  ),

                h:
                  round(
                    candle.h,
                    2
                  ),

                l:
                  round(
                    candle.l,
                    2
                  ),

                c:
                  round(
                    candle.c,
                    2
                  )
              })
            ),

        session:
          packet.session,

        regime:
          packet.regime,

        gold_context:
          packet.gold,

        account_protection:
          account,

        execution_sizing:
          sizing,

        news_guard:
          news,

        trade_permission:
          tradePermission,

        data_quality: {
          fresh:
            packet.dataFresh,

          ageSeconds:
            packet.dataAgeSeconds,

          latestCompletedM1:
            packet.signalCandleTime
        },

        cache: {
          m1:
            m1Result.cacheHit,

          h1:
            h1Result.cacheHit,

          price:
            priceResult.cacheHit
        },

        timestamp:
          new Date()
            .toISOString()
      }
    );

  }
  catch (
    error
  ) {

    console.error(
      "MKAYFX GOLD V8:",
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
          "MKAYFX gold engine failed."
      }
    );

  }

}