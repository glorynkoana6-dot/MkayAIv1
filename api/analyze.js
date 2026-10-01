/* =========================================================
   MKAYFX GOLD LOCKED SIGNAL ENGINE V9
   XAU/USD ONLY

   IMPORTANT BEHAVIOUR
   -------------------
   This endpoint is called ONLY when a NEW signal is needed.

   It immediately:
   1. Reads XAU/USD
   2. Analyses M1 / M5 / M15 / H1
   3. Chooses BUY or SELL
   4. Creates ENTRY
   5. Creates STOP LOSS
   6. Creates TAKE PROFIT
   7. Returns the signal

   The frontend then LOCKS that signal.

   While the trade is active:
   THIS ENDPOINT IS NOT CALLED AGAIN.

========================================================= */

const API_KEY =
  process.env.TWELVE_DATA_API_KEY;

const BASE_URL =
  "https://api.twelvedata.com";

const SYMBOL =
  "XAU/USD";


/* =========================================================
   SETTINGS
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

const STALE_MS =
  envNumber(
    "STALE_MS",
    10 * 60_000,
    60_000
  );

const DEFAULT_EQUITY_ZAR =
  envNumber(
    "DEFAULT_EQUITY_ZAR",
    200,
    1
  );

const RISK_PERCENT =
  envNumber(
    "RISK_PER_TRADE_PCT",
    0.25,
    0.01,
    0.50
  );

const PRIMARY_TP_R =
  envNumber(
    "PRIMARY_TP_R",
    1.20,
    0.70,
    4
  );

const SECONDARY_TP_R =
  envNumber(
    "SECONDARY_TP_R",
    1.60,
    1,
    5
  );

const MIN_STOP_ATR =
  envNumber(
    "MIN_STOP_ATR",
    0.65,
    0.20,
    2
  );

const DEFAULT_STOP_ATR =
  envNumber(
    "DEFAULT_STOP_ATR",
    1.00,
    0.40,
    3
  );

const MAX_STOP_ATR =
  envNumber(
    "MAX_STOP_ATR",
    1.70,
    0.50,
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
   UTILITY
========================================================= */

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
      (sum, value) =>
        sum + value,
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

  const clean =
    String(value)
      .trim()
      .replace(
        " ",
        "T"
      );

  return new Date(
    /Z$|[+-]\d\d:\d\d$/.test(
      clean
    )
      ? clean
      : `${clean}Z`
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
   TIMEZONE
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


/* =========================================================
   TWELVE DATA
========================================================= */

async function fetchJSON(
  url,
  timeout = 20000
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
      !response.ok ||
      data.status ===
        "error"
    ) {

      throw new Error(
        data.message ||
        `HTTP ${response.status}`
      );

    }

    return data;

  }
  finally {

    clearTimeout(
      timer
    );

  }

}


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
    await fetchJSON(
      `${BASE_URL}/time_series?${query}`
    );

  if (
    !Array.isArray(
      data.values
    )
  ) {
    throw new Error(
      `${interval} XAU/USD data unavailable.`
    );
  }

  return data.values
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
        ].every(
          Number.isFinite
        )
    )
    .reverse();

}


async function fetchPrice() {

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
      "Current XAU/USD price unavailable."
    );
  }

  return price;

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
   RESAMPLING
========================================================= */

function resample(
  candles,
  minutes
) {

  const bucketSize =
    minutes *
    60_000;

  const map =
    new Map();

  for (
    const candle of
    candles
  ) {

    const ms =
      parseUTC(
        candle.t
      );

    if (
      !Number.isFinite(ms)
    ) {
      continue;
    }

    const bucket =
      Math.floor(
        ms /
        bucketSize
      ) *
      bucketSize;

    if (
      !map.has(bucket)
    ) {
      map.set(
        bucket,
        []
      );
    }

    map
      .get(bucket)
      .push(candle);

  }

  const output = [];

  for (
    const [
      timestamp,
      raw
    ] of map
  ) {

    const unique =
      new Map();

    for (
      const candle of
      raw
    ) {
      unique.set(
        parseUTC(
          candle.t
        ),
        candle
      );
    }

    const group =
      [
        ...unique.values()
      ].sort(
        (a, b) =>
          parseUTC(a.t) -
          parseUTC(b.t)
      );

    if (
      group.length <
      Math.ceil(
        minutes *
        0.90
      )
    ) {
      continue;
    }

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
            candle
          ) =>
            sum +
            (
              candle.v ||
              0
            ),
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

  const multiplier =
    2 /
    (
      period +
      1
    );

  let current =
    mean(
      values.slice(
        0,
        period
      )
    );

  const output =
    Array(
      period - 1
    ).fill(null);

  output.push(current);

  for (
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


function ema(
  values,
  period
) {

  const series =
    emaSeries(
      values,
      period
    );

  return series.length
    ? series.at(-1)
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

  let gains = 0;
  let losses = 0;

  for (
    let i = 1;
    i <= period;
    i++
  ) {

    const change =
      closes[i] -
      closes[i - 1];

    gains +=
      Math.max(
        change,
        0
      );

    losses +=
      Math.max(
        -change,
        0
      );

  }

  let avgGain =
    gains /
    period;

  let avgLoss =
    losses /
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

    const current =
      candles[i];

    const previous =
      candles[i - 1];

    output.push(
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

  let current =
    mean(
      values.slice(
        0,
        period
      )
    );

  const output = [
    current
  ];

  for (
    let i =
      period;

    i <
      values.length;

    i++
  ) {

    current =
      (
        current *
          (
            period -
            1
          ) +
        values[i]
      ) /
      period;

    output.push(
      current
    );

  }

  return output;

}


function atr(
  candles,
  period = 14
) {

  const values =
    wilder(
      trueRanges(
        candles
      ),
      period
    );

  return values.length
    ? values.at(-1)
    : null;

}


/* =========================================================
   MACD
========================================================= */

function macdHistogram(
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
    return null;
  }

  const line =
    values.at(-1);

  const signal =
    ema(
      values,
      9
    );

  return signal == null
    ? null
    : line -
      signal;

}


/* =========================================================
   TREND
========================================================= */

function trendBias(
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

    const body =
      Math.abs(
        candle.c -
        candle.o
      ) /
      range;

    if (
      candle.c >
      candle.o
    ) {
      bull += body;
    }

    if (
      candle.c <
      candle.o
    ) {
      bear += body;
    }

  }

  if (
    bull >
    bear *
      1.20
  ) {
    return "BULLISH";
  }

  if (
    bear >
    bull *
      1.20
  ) {
    return "BEARISH";
  }

  return "MIXED";

}


/* =========================================================
   SWINGS
========================================================= */

function findSwings(
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
        j === i
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


function structureLabel(
  swingData
) {

  const highs =
    swingData.highs.slice(-2);

  const lows =
    swingData.lows.slice(-2);

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

function detectStructure(
  candles,
  swingData
) {

  const currentClose =
    finite(
      candles.at(-1)?.c
    );

  const previousClose =
    finite(
      candles.at(-2)?.c
    );

  const high =
    swingData.highs.at(-1);

  const low =
    swingData.lows.at(-1);

  const structure =
    structureLabel(
      swingData
    );

  let bos =
    "NONE";

  let choch =
    "NONE";

  if (
    high &&
    previousClose !== null &&
    currentClose !== null &&
    previousClose <=
      high.price &&
    currentClose >
      high.price
  ) {

    bos =
      "BULLISH_BOS";

    if (
      structure ===
      "LH/LL"
    ) {
      choch =
        "BULLISH_CHOCH";
    }

  }

  if (
    low &&
    previousClose !== null &&
    currentClose !== null &&
    previousClose >=
      low.price &&
    currentClose <
      low.price
  ) {

    bos =
      "BEARISH_BOS";

    if (
      structure ===
      "HH/HL"
    ) {
      choch =
        "BEARISH_CHOCH";
    }

  }

  return {
    structure,
    bos,
    choch
  };

}


/* =========================================================
   GENERIC LIQUIDITY SWEEP
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

  const previous =
    candles.slice(
      -(lookback + 1),
      -1
    );

  const high =
    Math.max(
      ...previous.map(
        x => x.h
      )
    );

  const low =
    Math.min(
      ...previous.map(
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
      0.55 &&
    rangeAtr >=
      0.75 &&
    closePosition >=
      0.68
  ) {

    direction =
      "BULLISH";

  }

  if (
    last.c <
      last.o &&
    bodyRatio >=
      0.55 &&
    rangeAtr >=
      0.75 &&
    closePosition <=
      0.32
  ) {

    direction =
      "BEARISH";

  }

  return {
    direction,

    quality:
      clamp(
        Math.round(
          bodyRatio *
            55 +
          Math.min(
            rangeAtr,
            2
          ) *
            22
        ),
        0,
        100
      )
  };

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
    findSwings(
      candles
    );

  const marketStructure =
    detectStructure(
      candles,
      swingData
    );

  const sweep =
    genericSweep(
      candles
    );

  const histogram =
    macdHistogram(
      closes
    );

  return {
    price:
      round(
        closes.at(-1),
        2
      ),

    bias:
      trendBias(
        closes
      ),

    momentum:
      momentum(
        candles
      ),

    structure:
      marketStructure.structure,

    displacement:
      displacement(
        candles
      ),

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

      macdHistogram:
        round(
          histogram,
          5
        )
    },

    ict: {
      bos:
        marketStructure.bos,

      choch:
        marketStructure.choch,

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

function buildDayLevels(
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

    if (
      !Number.isFinite(ms)
    ) {
      continue;
    }

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

  function create(
    key
  ) {

    if (!key) {
      return null;
    }

    const group =
      groups.get(key);

    if (
      !group?.length
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

      open:
        group[0].o,

      close:
        group.at(-1).c
    };

  }

  return {
    current:
      create(
        keys.at(-1)
      ),

    previous:
      create(
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

  const latest =
    candles.at(-1);

  if (!latest) {
    return null;
  }

  const london =
    zoneParts(
      parseUTC(
        latest.t
      ),
      "Europe/London"
    );

  const group =
    candles.filter(
      candle => {

        const parts =
          zoneParts(
            parseUTC(
              candle.t
            ),
            "Europe/London"
          );

        return (
          parts.dateKey ===
            london.dateKey &&
          parts.hour >= 0 &&
          parts.hour < 8
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
      london.hour >= 8
  };

}


/* =========================================================
   RECENT LEVEL SWEEP
========================================================= */

function recentSweep(
  candles,
  level,
  side,
  lookback = 10
) {

  const price =
    finite(level);

  if (
    price === null
  ) {
    return null;
  }

  const start =
    Math.max(
      0,
      candles.length -
      lookback
    );

  for (
    let i =
      candles.length - 1;

    i >= start;

    i--
  ) {

    const candle =
      candles[i];

    if (
      side ===
        "SELL_SIDE" &&
      candle.l <
        price &&
      candle.c >
        price
    ) {

      return {
        age:
          candles.length -
          1 -
          i
      };

    }

    if (
      side ===
        "BUY_SIDE" &&
      candle.h >
        price &&
      candle.c <
        price
    ) {

      return {
        age:
          candles.length -
          1 -
          i
      };

    }

  }

  return null;

}


/* =========================================================
   GOLD LIQUIDITY
========================================================= */

function goldContext(
  packet,
  m1
) {

  const days =
    buildDayLevels(
      m1
    );

  const asia =
    asianRange(
      m1
    );

  const previous =
    days.previous;

  let bullish = 0;
  let bearish = 0;

  const signals = [];

  if (
    asia?.complete
  ) {

    const low =
      recentSweep(
        m1,
        asia.low,
        "SELL_SIDE"
      );

    const high =
      recentSweep(
        m1,
        asia.high,
        "BUY_SIDE"
      );

    if (low) {

      bullish +=
        low.age <= 2
          ? 38
          : 28;

      signals.push(
        "Asian low liquidity was swept."
      );

    }

    if (high) {

      bearish +=
        high.age <= 2
          ? 38
          : 28;

      signals.push(
        "Asian high liquidity was swept."
      );

    }

  }

  if (previous) {

    const pdl =
      recentSweep(
        m1,
        previous.low,
        "SELL_SIDE",
        12
      );

    const pdh =
      recentSweep(
        m1,
        previous.high,
        "BUY_SIDE",
        12
      );

    if (pdl) {

      bullish +=
        30;

      signals.push(
        "Previous-day low was swept."
      );

    }

    if (pdh) {

      bearish +=
        30;

      signals.push(
        "Previous-day high was swept."
      );

    }

  }

  if (
    packet.M1.ict
      .sweep.type ===
    "BULLISH_SELLSIDE_SWEEP"
  ) {
    bullish += 20;
  }

  if (
    packet.M1.ict
      .sweep.type ===
    "BEARISH_BUYSIDE_SWEEP"
  ) {
    bearish += 20;
  }

  if (
    packet.M1
      .displacement
      .direction ===
    "BULLISH"
  ) {
    bullish += 15;
  }

  if (
    packet.M1
      .displacement
      .direction ===
    "BEARISH"
  ) {
    bearish += 15;
  }

  if (
    packet.M5
      .displacement
      .direction ===
    "BULLISH"
  ) {
    bullish += 15;
  }

  if (
    packet.M5
      .displacement
      .direction ===
    "BEARISH"
  ) {
    bearish += 15;
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
        bullish,
        0,
        100
      ),

    bearishLiquidityScore:
      clamp(
        bearish,
        0,
        100
      ),

    signals
  };

}


/* =========================================================
   SIGNAL SCORING
========================================================= */

function biasSign(
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


function scoreMarket(
  packet
) {

  const trendScore =
    biasSign(
      packet.H1.bias
    ) *
      25 +

    biasSign(
      packet.M15.bias
    ) *
      35 +

    biasSign(
      packet.M5.bias
    ) *
      25 +

    biasSign(
      packet.M1.bias
    ) *
      15;


  const structureScore =
    biasSign(
      packet.M15.structure
    ) *
      18 +

    biasSign(
      packet.M5.structure
    ) *
      24 +

    biasSign(
      packet.M5.ict.bos
    ) *
      24 +

    biasSign(
      packet.M1.ict.bos
    ) *
      20 +

    biasSign(
      packet.M1.ict.choch
    ) *
      14;


  const liquidityScore =
    packet.gold
      .bullishLiquidityScore -
    packet.gold
      .bearishLiquidityScore;


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


  const rsi1 =
    finite(
      packet.M1
        .indicators
        .rsi14
    ) ??
    50;


  let momentumScore =
    biasSign(
      packet.M1.momentum
    ) *
      30 +

    biasSign(
      packet.M5.momentum
    ) *
      35;


  momentumScore +=
    macd1 > 0
      ? 15
      : macd1 < 0
        ? -15
        : 0;


  momentumScore +=
    macd5 > 0
      ? 12
      : macd5 < 0
        ? -12
        : 0;


  momentumScore +=
    clamp(
      (
        rsi1 -
        50
      ) *
        0.6,
      -10,
      10
    );


  let displacementScore =
    0;


  if (
    packet.M1
      .displacement
      .direction ===
    "BULLISH"
  ) {
    displacementScore +=
      40;
  }


  if (
    packet.M1
      .displacement
      .direction ===
    "BEARISH"
  ) {
    displacementScore -=
      40;
  }


  if (
    packet.M5
      .displacement
      .direction ===
    "BULLISH"
  ) {
    displacementScore +=
      40;
  }


  if (
    packet.M5
      .displacement
      .direction ===
    "BEARISH"
  ) {
    displacementScore -=
      40;
  }


  const weighted =
    trendScore *
      0.28 +

    structureScore *
      0.24 +

    liquidityScore *
      0.22 +

    momentumScore *
      0.18 +

    displacementScore *
      0.08;


  /*
     User requested an IMMEDIATE directional signal.

     If the score is exactly balanced, fall back through:
     M15 -> M5 -> H1 -> latest M1 candle.
  */

  let signal;


  if (
    weighted > 0
  ) {
    signal =
      "BUY";
  }
  else if (
    weighted < 0
  ) {
    signal =
      "SELL";
  }
  else if (
    packet.M15.bias ===
    "BULLISH"
  ) {
    signal =
      "BUY";
  }
  else if (
    packet.M15.bias ===
    "BEARISH"
  ) {
    signal =
      "SELL";
  }
  else if (
    packet.M5.bias ===
    "BULLISH"
  ) {
    signal =
      "BUY";
  }
  else if (
    packet.M5.bias ===
    "BEARISH"
  ) {
    signal =
      "SELL";
  }
  else {
    signal =
      packet.lastM1.c >=
      packet.lastM1.o
        ? "BUY"
        : "SELL";
  }


  const strength =
    clamp(
      Math.round(
        52 +
        Math.min(
          42,
          Math.abs(
            weighted
          ) *
            0.45
        )
      ),
      52,
      94
    );


  const reasons = [];


  reasons.push(
    `H1 ${packet.H1.bias}, M15 ${packet.M15.bias}, M5 ${packet.M5.bias}.`
  );


  reasons.push(
    `M1 structure ${packet.M1.structure}, ${packet.M1.ict.bos}, ${packet.M1.ict.choch}.`
  );


  if (
    packet.gold.signals.length
  ) {
    reasons.push(
      ...packet.gold.signals
    );
  }


  reasons.push(
    `M1 momentum ${packet.M1.momentum}, M5 momentum ${packet.M5.momentum}.`
  );


  if (
    packet.M1
      .displacement
      .direction !==
    "NONE"
  ) {

    reasons.push(
      `M1 ${packet.M1.displacement.direction.toLowerCase()} displacement detected.`
    );

  }


  return {
    signal,

    strength,

    signedScore:
      round(
        weighted,
        1
      ),

    componentScores: {
      trend:
        round(
          trendScore,
          1
        ),

      structure:
        round(
          structureScore,
          1
        ),

      liquidity:
        round(
          liquidityScore,
          1
        ),

      momentum:
        round(
          momentumScore,
          1
        ),

      displacement:
        round(
          displacementScore,
          1
        )
    },

    reasons
  };

}


/* =========================================================
   STOP + TARGET
========================================================= */

function createTradePlan(
  signal,
  entry,
  packet
) {

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
    throw new Error(
      "M1 ATR unavailable."
    );
  }


  const swingLow =
    finite(
      packet.M1
        .ict
        .lastSwingLow
    );


  const swingHigh =
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
    signal ===
    "BUY"
  ) {

    const validSwing =
      swingLow !==
        null &&
      lowAge !==
        null &&
      lowAge <=
        MAX_SWING_AGE &&
      swingLow <
        entry;


    stop =
      validSwing
        ? swingLow -
          buffer
        : entry -
          atr1 *
          DEFAULT_STOP_ATR;

  }
  else {

    const validSwing =
      swingHigh !==
        null &&
      highAge !==
        null &&
      highAge <=
        MAX_SWING_AGE &&
      swingHigh >
        entry;


    stop =
      validSwing
        ? swingHigh +
          buffer
        : entry +
          atr1 *
          DEFAULT_STOP_ATR;

  }


  let risk =
    Math.abs(
      entry -
      stop
    );


  const minimumRisk =
    atr1 *
    MIN_STOP_ATR;


  if (
    risk <
    minimumRisk
  ) {

    risk =
      minimumRisk;


    stop =
      signal ===
        "BUY"
        ? entry -
          risk
        : entry +
          risk;

  }


  /*
     If swing stop is excessively wide,
     replace it instead of refusing to generate a signal.
  */

  if (
    risk /
      atr1 >
    MAX_STOP_ATR
  ) {

    risk =
      atr1 *
      DEFAULT_STOP_ATR;


    stop =
      signal ===
        "BUY"
        ? entry -
          risk
        : entry +
          risk;

  }


  const sign =
    signal ===
      "BUY"
      ? 1
      : -1;


  const takeProfit =
    entry +
    sign *
      risk *
      PRIMARY_TP_R;


  const takeProfit2 =
    entry +
    sign *
      risk *
      SECONDARY_TP_R;


  return {
    direction:
      signal,

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

    takeProfit:
      round(
        takeProfit,
        2
      ),

    takeProfit2:
      round(
        takeProfit2,
        2
      ),

    riskDistance:
      round(
        risk,
        2
      ),

    stopAtr:
      round(
        risk /
        atr1,
        2
      ),

    riskReward:
      `1:${round(
        PRIMARY_TP_R,
        2
      )}`,

    riskReward2:
      `1:${round(
        SECONDARY_TP_R,
        2
      )}`
  };

}


/* =========================================================
   ACCOUNT RISK
========================================================= */

function buildAccount(
  body
) {

  const equity =
    finite(
      body.equity
    ) ??
    DEFAULT_EQUITY_ZAR;


  const maxRisk =
    equity *
    RISK_PERCENT /
    100;


  return {
    equityZAR:
      round(
        equity,
        2
      ),

    riskPercent:
      RISK_PERCENT,

    maxRiskZAR:
      round(
        maxRisk,
        2
      )
  };

}


/* =========================================================
   MAIN
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


  if (
    req.method !==
      "GET" &&
    req.method !==
      "POST"
  ) {

    return send(
      res,
      405,
      {
        success:
          false,

        error:
          "Use GET or POST."
      }
    );

  }


  try {

    const body =
      bodyOf(req);


    /*
       Full analysis is intentionally only triggered
       when the frontend requests a NEW trade.
    */

    const [
      rawM1,
      rawH1,
      livePrice
    ] =
      await Promise.all([
        fetchSeries(
          "1min",
          M1_OUTPUT
        ),

        fetchSeries(
          "1h",
          H1_OUTPUT
        ),

        fetchPrice()
      ]);


    const m1 =
      completed(
        rawM1,
        1
      );


    const h1 =
      completed(
        rawH1,
        60
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


    if (
      m1.length <
        300 ||
      m5.length <
        60 ||
      m15.length <
        40 ||
      h1.length <
        50
    ) {

      throw new Error(
        "Not enough completed XAU/USD data."
      );

    }


    const lastM1 =
      m1.at(-1);


    const latestEnd =
      parseUTC(
        lastM1.t
      ) +
      60_000;


    const dataAge =
      Date.now() -
      latestEnd;


    if (
      dataAge >
      STALE_MS
    ) {

      throw new Error(
        "Gold market data is stale. A fresh signal cannot be created."
      );

    }


    const packet = {
      lastM1,

      session:
        sessionFor(
          parseUTC(
            lastM1.t
          )
        ),

      M1:
        snapshot(
          m1
        ),

      M5:
        snapshot(
          m5
        ),

      M15:
        snapshot(
          m15
        ),

      H1:
        snapshot(
          h1
        )
    };


    packet.gold =
      goldContext(
        packet,
        m1
      );


    const technical =
      scoreMarket(
        packet
      );


    /*
       Signal is generated immediately.
    */

    const plan =
      createTradePlan(
        technical.signal,
        livePrice,
        packet
      );


    const account =
      buildAccount(
        body
      );


    const signalId =
      `MK-${Date.now()}-${technical.signal}`;


    return send(
      res,
      200,
      {
        success:
          true,

        model:
          "MKAYFX GOLD LOCKED SIGNAL V9",

        signalId,

        symbol:
          SYMBOL,

        signal:
          technical.signal,

        setupStrength:
          technical.strength,

        strengthType:
          "SETUP_STRENGTH_NOT_WIN_PROBABILITY",

        locked:
          true,

        createdAt:
          new Date()
            .toISOString(),

        session:
          packet.session,

        entry:
          plan.entry,

        stopLoss:
          plan.stopLoss,

        takeProfit:
          plan.takeProfit,

        takeProfit2:
          plan.takeProfit2,

        riskReward:
          plan.riskReward,

        riskReward2:
          plan.riskReward2,

        riskDistance:
          plan.riskDistance,

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

        structure: {
          M1:
            packet.M1.structure,

          M1_BOS:
            packet.M1
              .ict
              .bos,

          M1_CHOCH:
            packet.M1
              .ict
              .choch,

          M5:
            packet.M5.structure,

          M5_BOS:
            packet.M5
              .ict
              .bos
        },

        goldContext:
          packet.gold,

        technical,

        account,

        chart:
          m1
            .slice(-120)
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

        lifecycle: {
          state:
            "TRADE_ACTIVE",

          rule:
            "Signal remains locked until primary TP or SL is reached.",

          nextAnalysis:
            "Immediately after TP or SL."
        }
      }
    );

  }
  catch (
    error
  ) {

    console.error(
      "MKAYFX ANALYZE:",
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
          "Gold analysis failed."
      }
    );

  }
}