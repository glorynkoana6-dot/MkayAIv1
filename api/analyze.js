/* =========================================================
   MKAYFX GOLD EDGE ENGINE V10
   XAU/USD ONLY

   CORE BEHAVIOUR
   --------------
   - Reads live XAU/USD + completed M1/H1 candles
   - Builds strict completed M5/M15 candles
   - Analyses trend / structure / liquidity / momentum
   - Detects the current market regime
   - Compares the current M5 state to historical M5 states
   - Estimates historical expectancy / MFE / MAE
   - Produces BUY / SELL only when an edge gate is passed
   - Otherwise returns WAIT
   - Qualified BUY/SELL signals can still be locked by frontend

   IMPORTANT
   ---------
   Historical statistics are empirical estimates from the candles
   fetched in this request. They are NOT guaranteed win probabilities.
========================================================= */

const API_KEY = process.env.TWELVE_DATA_API_KEY;
const BASE_URL = "https://api.twelvedata.com";
const SYMBOL = "XAU/USD";

/* =========================================================
   SETTINGS
========================================================= */

const M1_OUTPUT = envNumber("M1_OUTPUT", 5000, 500, 5000);
const H1_OUTPUT = envNumber("H1_OUTPUT", 300, 100, 1000);
const STALE_MS = envNumber("STALE_MS", 10 * 60_000, 60_000);

const DEFAULT_EQUITY_ZAR = envNumber(
  "DEFAULT_EQUITY_ZAR",
  200,
  1
);

const RISK_PERCENT = envNumber(
  "RISK_PER_TRADE_PCT",
  0.25,
  0.01,
  0.50
);

const PRIMARY_TP_R = envNumber(
  "PRIMARY_TP_R",
  1.20,
  0.70,
  4
);

const SECONDARY_TP_R = envNumber(
  "SECONDARY_TP_R",
  1.60,
  1,
  5
);

const MIN_STOP_ATR = envNumber(
  "MIN_STOP_ATR",
  0.65,
  0.20,
  2
);

const DEFAULT_STOP_ATR = envNumber(
  "DEFAULT_STOP_ATR",
  1.00,
  0.40,
  3
);

const MAX_STOP_ATR = envNumber(
  "MAX_STOP_ATR",
  1.70,
  0.50,
  5
);

const MAX_SWING_AGE = envNumber(
  "MAX_SWING_AGE",
  18,
  3,
  100
);

/* Edge gate */

const MIN_EDGE_SCORE = envNumber(
  "MIN_EDGE_SCORE",
  68,
  45,
  95
);

const MIN_TECHNICAL_SCORE = envNumber(
  "MIN_TECHNICAL_SCORE",
  20,
  0,
  100
);

const MIN_MODEL_AGREEMENT = envNumber(
  "MIN_MODEL_AGREEMENT",
  0.60,
  0.50,
  1
);

const MIN_EXPECTANCY_R = envNumber(
  "MIN_EXPECTANCY_R",
  0.05,
  -1,
  3
);

const MIN_HISTORICAL_MATCHES = envNumber(
  "MIN_HISTORICAL_MATCHES",
  18,
  5,
  200
);

const HISTORICAL_TOP_K = Math.round(
  envNumber(
    "HISTORICAL_TOP_K",
    80,
    10,
    250
  )
);

const HISTORICAL_MIN_SIMILARITY = envNumber(
  "HISTORICAL_MIN_SIMILARITY",
  55,
  20,
  95
);

const HISTORICAL_FORWARD_BARS = Math.round(
  envNumber(
    "HISTORICAL_FORWARD_BARS",
    12,
    3,
    48
  )
);

const HISTORICAL_CONTEXT_BARS = Math.round(
  envNumber(
    "HISTORICAL_CONTEXT_BARS",
    60,
    40,
    120
  )
);

const HISTORICAL_STRIDE = Math.round(
  envNumber(
    "HISTORICAL_STRIDE",
    1,
    1,
    10
  )
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

  const raw = process.env[name];

  if (
    raw === undefined ||
    raw === null ||
    raw === ""
  ) {
    return fallback;
  }

  const n = Number(raw);

  if (!Number.isFinite(n)) {
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


function finite(value) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


function round(
  value,
  digits = 2
) {

  const n = finite(value);

  if (n === null) {
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


function mean(values) {

  const clean =
    values.filter(
      Number.isFinite
    );

  if (!clean.length) {
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


function median(values) {

  const clean =
    values
      .filter(Number.isFinite)
      .sort(
        (a, b) =>
          a - b
      );

  if (!clean.length) {
    return null;
  }

  const mid =
    Math.floor(
      clean.length / 2
    );

  return clean.length % 2
    ? clean[mid]
    : (
        clean[mid - 1] +
        clean[mid]
      ) / 2;
}


function percentileRank(
  values,
  value
) {

  const clean =
    values.filter(
      Number.isFinite
    );

  if (
    !clean.length ||
    !Number.isFinite(value)
  ) {
    return null;
  }

  const belowOrEqual =
    clean.filter(
      v =>
        v <= value
    ).length;

  return (
    belowOrEqual /
    clean.length
  ) * 100;
}


function parseUTC(value) {

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


function bodyOf(req) {

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


function signToDirection(sign) {

  return sign >= 0
    ? "BUY"
    : "SELL";
}


function directionSign(direction) {

  return direction === "BUY"
    ? 1
    : direction === "SELL"
      ? -1
      : 0;
}


/* =========================================================
   TIMEZONE
========================================================= */

const ZONE_FORMATTERS =
  new Map();


function getZoneFormatter(
  timeZone
) {

  if (
    !ZONE_FORMATTERS.has(
      timeZone
    )
  ) {

    ZONE_FORMATTERS.set(
      timeZone,
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
      )
    );

  }

  return ZONE_FORMATTERS.get(
    timeZone
  );
}


function zoneParts(
  ms,
  timeZone
) {

  const formatter =
    getZoneFormatter(
      timeZone
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


function sessionFor(ms) {

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

    clearTimeout(timer);

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

  if (!API_KEY) {
    throw new Error(
      "TWELVE_DATA_API_KEY is missing."
    );
  }

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
   STRICT RESAMPLING
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

    /*
       Strict:
       M5 needs exactly 5 M1 candles.
       M15 needs exactly 15 M1 candles.
    */

    if (
      group.length !==
      minutes
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


function atrHistory(
  candles,
  period = 14,
  lookback = 120
) {

  const start =
    Math.max(
      period + 1,
      candles.length -
        lookback
    );

  const values = [];

  for (
    let i = start;
    i <
      candles.length;
    i++
  ) {

    const slice =
      candles.slice(
        Math.max(
          0,
          i -
            period -
            10
        ),
        i + 1
      );

    const a =
      atr(
        slice,
        period
      );

    if (
      Number.isFinite(a)
    ) {
      values.push(a);
    }

  }

  return values;
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


function efficiencyRatio(
  closes,
  period = 20
) {

  if (
    closes.length <=
    period
  ) {
    return 0;
  }

  const start =
    closes.length -
    1 -
    period;

  const net =
    Math.abs(
      closes.at(-1) -
      closes[start]
    );

  let travel = 0;

  for (
    let i =
      start + 1;

    i <
      closes.length;

    i++
  ) {

    travel +=
      Math.abs(
        closes[i] -
        closes[i - 1]
      );

  }

  return travel > 0
    ? net / travel
    : 0;
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
   BOS / CHOCH
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
          swingData.highs
            .at(-1)
            ?.price,
          2
        ),

      lastSwingHighAge:
        swingData.highs
          .at(-1)
          ?.age ??
        null,

      lastSwingLow:
        round(
          swingData.lows
            .at(-1)
            ?.price,
          2
        ),

      lastSwingLowAge:
        swingData.lows
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

  function create(key) {

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
   GOLD CONTEXT
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
   MARKET REGIME
========================================================= */

function detectRegime(m5) {

  const closes =
    m5.map(
      x => x.c
    );

  const currentAtr =
    atr(
      m5,
      14
    );

  const history =
    atrHistory(
      m5,
      14,
      120
    );

  const atrPercentile =
    percentileRank(
      history,
      currentAtr
    ) ??
    50;

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

  const price =
    closes.at(-1);

  const efficiency =
    efficiencyRatio(
      closes,
      20
    );

  const spreadAtr =
    Number.isFinite(currentAtr) &&
    currentAtr > 0 &&
    Number.isFinite(e20) &&
    Number.isFinite(e50)
      ? Math.abs(
          e20 -
          e50
        ) /
        currentAtr
      : 0;

  const priceVsE20 =
    Number.isFinite(currentAtr) &&
    currentAtr > 0 &&
    Number.isFinite(e20)
      ? (
          price -
          e20
        ) /
        currentAtr
      : 0;

  const trendSign =
    Number.isFinite(e20) &&
    Number.isFinite(e50)
      ? Math.sign(
          e20 -
          e50
        )
      : 0;

  const recentReturn =
    closes.length > 6 &&
    currentAtr > 0
      ? (
          closes.at(-1) -
          closes.at(-7)
        ) /
        currentAtr
      : 0;

  let type =
    "MIXED";

  if (
    atrPercentile >= 75 &&
    efficiency >= 0.52 &&
    Math.abs(
      recentReturn
    ) >= 0.70
  ) {

    type =
      recentReturn >= 0
        ? "BULLISH_EXPANSION"
        : "BEARISH_EXPANSION";

  }
  else if (
    efficiency >= 0.42 &&
    spreadAtr >= 0.45
  ) {

    type =
      trendSign >= 0
        ? "BULLISH_TREND"
        : "BEARISH_TREND";

  }
  else if (
    atrPercentile <= 30 &&
    efficiency <= 0.25
  ) {

    type =
      "QUIET_CHOP";

  }
  else if (
    efficiency <= 0.32
  ) {

    type =
      "RANGE";

  }

  let confidence =
    50;

  if (
    type.includes(
      "EXPANSION"
    )
  ) {

    confidence =
      clamp(
        55 +
        (
          atrPercentile -
          70
        ) *
          0.8 +
        (
          efficiency -
          0.45
        ) *
          70,
        50,
        95
      );

  }
  else if (
    type.includes(
      "TREND"
    )
  ) {

    confidence =
      clamp(
        55 +
        spreadAtr *
          22 +
        efficiency *
          25,
        50,
        92
      );

  }
  else if (
    type ===
    "RANGE"
  ) {

    confidence =
      clamp(
        55 +
        (
          0.35 -
          efficiency
        ) *
          100,
        50,
        88
      );

  }
  else if (
    type ===
    "QUIET_CHOP"
  ) {

    confidence =
      clamp(
        60 +
        (
          30 -
          atrPercentile
        ) *
          0.6 +
        (
          0.30 -
          efficiency
        ) *
          60,
        55,
        92
      );

  }

  return {
    type,

    confidence:
      round(
        confidence,
        1
      ),

    atrPercentile:
      round(
        atrPercentile,
        1
      ),

    efficiencyRatio:
      round(
        efficiency,
        3
      ),

    emaSpreadAtr:
      round(
        spreadAtr,
        3
      ),

    priceVsEma20Atr:
      round(
        priceVsE20,
        3
      ),

    recentReturnAtr:
      round(
        recentReturn,
        3
      )
  };
}


/* =========================================================
   SIGNAL SCORING
========================================================= */

function biasSign(value) {

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


function scoreMarket(packet) {

  const trendScore =
    clamp(
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
        15,
      -100,
      100
    );


  const structureScore =
    clamp(
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
        14,
      -100,
      100
    );


  const liquidityScore =
    clamp(
      packet.gold
        .bullishLiquidityScore -
      packet.gold
        .bearishLiquidityScore,
      -100,
      100
    );


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
      35 +

    (
      macd1 > 0
        ? 15
        : macd1 < 0
          ? -15
          : 0
    ) +

    (
      macd5 > 0
        ? 12
        : macd5 < 0
          ? -12
          : 0
    ) +

    clamp(
      (
        rsi1 -
        50
      ) *
        0.6,
      -10,
      10
    );


  momentumScore =
    clamp(
      momentumScore,
      -100,
      100
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


  displacementScore =
    clamp(
      displacementScore,
      -100,
      100
    );


  const weighted =
    clamp(
      trendScore *
        0.28 +

      structureScore *
        0.24 +

      liquidityScore *
        0.22 +

      momentumScore *
        0.18 +

      displacementScore *
        0.08,
      -100,
      100
    );


  const candidateDirection =
    signToDirection(
      weighted
    );


  const technicalStrength =
    Math.abs(
      weighted
    );


  const modelScores = {
    trend:
      trendScore,

    structure:
      structureScore,

    liquidity:
      liquidityScore,

    momentum:
      momentumScore,

    displacement:
      displacementScore
  };


  const targetSign =
    directionSign(
      candidateDirection
    );


  const magnitudes =
    Object.values(
      modelScores
    ).map(
      Math.abs
    );


  const totalMagnitude =
    magnitudes.reduce(
      (
        a,
        b
      ) =>
        a + b,
      0
    );


  const alignedMagnitude =
    Object.values(
      modelScores
    )
      .filter(
        score =>
          Math.sign(
            score
          ) ===
          targetSign
      )
      .reduce(
        (
          sum,
          score
        ) =>
          sum +
          Math.abs(
            score
          ),
        0
      );


  const modelAgreement =
    totalMagnitude > 0
      ? alignedMagnitude /
        totalMagnitude
      : 0.5;


  const reasons = [
    `H1 ${packet.H1.bias}, M15 ${packet.M15.bias}, M5 ${packet.M5.bias}.`,

    `M1 structure ${packet.M1.structure}, ${packet.M1.ict.bos}, ${packet.M1.ict.choch}.`,

    `M1 momentum ${packet.M1.momentum}, M5 momentum ${packet.M5.momentum}.`
  ];


  if (
    packet.gold
      .signals.length
  ) {

    reasons.push(
      ...packet.gold.signals
    );

  }


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
    candidateDirection,

    technicalStrength:
      round(
        technicalStrength,
        1
      ),

    signedScore:
      round(
        weighted,
        1
      ),

    modelAgreement:
      round(
        modelAgreement,
        3
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
   HISTORICAL FEATURE VECTOR
========================================================= */

function featureVector(
  candles,
  endIndex =
    candles.length - 1
) {

  const start =
    Math.max(
      0,
      endIndex -
        HISTORICAL_CONTEXT_BARS +
        1
    );


  const slice =
    candles.slice(
      start,
      endIndex + 1
    );


  if (
    slice.length <
    40
  ) {
    return null;
  }


  const closes =
    slice.map(
      x => x.c
    );


  const a =
    atr(
      slice,
      14
    );


  if (
    !Number.isFinite(a) ||
    a <= 0
  ) {
    return null;
  }


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


  const r =
    rsi(
      closes,
      14
    );


  const macd =
    macdHistogram(
      closes
    );


  const eff =
    efficiencyRatio(
      closes,
      12
    );


  const sweep =
    genericSweep(
      slice,
      20
    );


  const disp =
    displacement(
      slice
    );


  const swings =
    findSwings(
      slice.slice(-40)
    );


  const structure =
    structureLabel(
      swings
    );


  const momentum6 =
    closes.length > 6
      ? (
          closes.at(-1) -
          closes.at(-7)
        ) /
        a
      : 0;


  const avgRange =
    mean(
      slice
        .slice(-10)
        .map(
          candle =>
            candle.h -
            candle.l
        )
    ) ||
    a;


  const rangeToAtr =
    avgRange /
    a;


  const sweepValue =
    sweep.type ===
    "BULLISH_SELLSIDE_SWEEP"
      ? 1
      : sweep.type ===
        "BEARISH_BUYSIDE_SWEEP"
        ? -1
        : 0;


  const dispValue =
    disp.direction ===
    "BULLISH"
      ? disp.quality /
        100
      : disp.direction ===
        "BEARISH"
        ? -disp.quality /
          100
        : 0;


  return {
    vector: [
      clamp(
        (
          closes.at(-1) -
          e20
        ) /
          a,
        -4,
        4
      ),

      clamp(
        (
          e20 -
          e50
        ) /
          a,
        -4,
        4
      ),

      clamp(
        (
          (
            r ??
            50
          ) -
          50
        ) /
          20,
        -2.5,
        2.5
      ),

      clamp(
        (
          macd ??
          0
        ) /
          a,
        -2,
        2
      ),

      clamp(
        momentum6,
        -4,
        4
      ),

      clamp(
        (
          eff -
          0.5
        ) *
          2,
        -1,
        1
      ),

      clamp(
        rangeToAtr -
          1,
        -2,
        2
      ),

      sweepValue,

      dispValue,

      biasSign(
        structure
      )
    ],

    atr:
      a,

    session:
      sessionFor(
        parseUTC(
          slice.at(-1).t
        )
      ),

    timestamp:
      slice.at(-1).t
  };
}


const FEATURE_WEIGHTS = [
  1.2,
  1.2,
  0.7,
  0.7,
  1.0,
  0.8,
  0.5,
  0.9,
  0.8,
  0.8
];


function similarityScore(
  a,
  b,
  sessionA,
  sessionB
) {

  if (
    !a ||
    !b ||
    a.length !==
      b.length
  ) {
    return 0;
  }


  let sum = 0;
  let weightTotal = 0;


  for (
    let i = 0;
    i <
      a.length;

    i++
  ) {

    const w =
      FEATURE_WEIGHTS[i] ??
      1;


    const diff =
      a[i] -
      b[i];


    sum +=
      w *
      diff *
      diff;


    weightTotal +=
      w;

  }


  let distance =
    Math.sqrt(
      sum /
      Math.max(
        weightTotal,
        1e-9
      )
    );


  /*
     Same-session historical
     states get a small preference.
  */

  if (
    sessionA !==
    sessionB
  ) {
    distance +=
      0.12;
  }


  return clamp(
    100 *
      Math.exp(
        -0.85 *
        distance
      ),
    0,
    100
  );
}


/* =========================================================
   HISTORICAL OUTCOME SIMULATION
========================================================= */

function simulateHistoricalOutcome(
  candles,
  index,
  direction,
  riskAtr,
  targetR,
  forwardBars
) {

  const sign =
    directionSign(
      direction
    );


  const feature =
    featureVector(
      candles,
      index
    );


  if (!feature) {
    return null;
  }


  const entry =
    candles[index].c;


  const riskDistance =
    feature.atr *
    riskAtr;


  if (
    !Number.isFinite(
      riskDistance
    ) ||
    riskDistance <= 0
  ) {
    return null;
  }


  const stop =
    entry -
    sign *
      riskDistance;


  const target =
    entry +
    sign *
      riskDistance *
      targetR;


  const future =
    candles.slice(
      index + 1,
      index +
        1 +
        forwardBars
    );


  if (
    !future.length
  ) {
    return null;
  }


  let maxFavR = 0;
  let maxAdvR = 0;

  let resultR =
    null;

  let outcome =
    "UNRESOLVED";


  for (
    const candle of
    future
  ) {

    const favorable =
      sign === 1
        ? candle.h -
          entry
        : entry -
          candle.l;


    const adverse =
      sign === 1
        ? entry -
          candle.l
        : candle.h -
          entry;


    maxFavR =
      Math.max(
        maxFavR,
        favorable /
          riskDistance
      );


    maxAdvR =
      Math.max(
        maxAdvR,
        adverse /
          riskDistance
      );


    const hitStop =
      sign === 1
        ? candle.l <=
          stop
        : candle.h >=
          stop;


    const hitTarget =
      sign === 1
        ? candle.h >=
          target
        : candle.l <=
          target;


    /*
       Conservative:
       if both target and stop
       were touched in same M5 bar,
       count it as a loss because
       candle data cannot prove order.
    */

    if (
      hitStop &&
      hitTarget
    ) {

      resultR =
        -1;

      outcome =
        "LOSS_AMBIGUOUS_BAR";

      break;
    }


    if (
      hitStop
    ) {

      resultR =
        -1;

      outcome =
        "LOSS";

      break;
    }


    if (
      hitTarget
    ) {

      resultR =
        targetR;

      outcome =
        "WIN";

      break;
    }

  }


  if (
    resultR ===
    null
  ) {

    const finalMove =
      sign *
      (
        future.at(-1).c -
        entry
      ) /
      riskDistance;


    resultR =
      clamp(
        finalMove,
        -1,
        targetR
      );

  }


  return {
    resultR,

    outcome,

    mfeR:
      maxFavR,

    maeR:
      maxAdvR
  };
}


/* =========================================================
   HISTORICAL SIMILARITY ENGINE
========================================================= */

function historicalSimilarity(
  candles,
  direction
) {

  const current =
    featureVector(
      candles,
      candles.length - 1
    );


  if (!current) {

    return {
      available:
        false,

      matches:
        0,

      reason:
        "Current feature vector unavailable."
    };

  }


  const candidates = [];


  const earliest =
    HISTORICAL_CONTEXT_BARS -
    1;


  const latest =
    candles.length -
    1 -
    HISTORICAL_FORWARD_BARS;


  for (
    let i = earliest;
    i <= latest;
    i +=
      HISTORICAL_STRIDE
  ) {

    const historical =
      featureVector(
        candles,
        i
      );


    if (!historical) {
      continue;
    }


    const similarity =
      similarityScore(
        current.vector,
        historical.vector,
        current.session,
        historical.session
      );


    if (
      similarity <
      HISTORICAL_MIN_SIMILARITY
    ) {
      continue;
    }


    const outcome =
      simulateHistoricalOutcome(
        candles,
        i,
        direction,
        DEFAULT_STOP_ATR,
        PRIMARY_TP_R,
        HISTORICAL_FORWARD_BARS
      );


    if (!outcome) {
      continue;
    }


    candidates.push({
      similarity,

      timestamp:
        historical.timestamp,

      ...outcome
    });

  }


  candidates.sort(
    (a, b) =>
      b.similarity -
      a.similarity
  );


  const top =
    candidates.slice(
      0,
      HISTORICAL_TOP_K
    );


  if (
    !top.length
  ) {

    return {
      available:
        true,

      matches:
        0,

      direction,

      reason:
        "No sufficiently similar historical states in the fetched window."
    };

  }


  const wins =
    top.filter(
      x =>
        x.outcome ===
        "WIN"
    ).length;


  const losses =
    top.filter(
      x =>
        x.outcome ===
          "LOSS" ||
        x.outcome ===
          "LOSS_AMBIGUOUS_BAR"
    ).length;


  const unresolved =
    top.length -
    wins -
    losses;


  const expectancyR =
    mean(
      top.map(
        x =>
          x.resultR
      )
    );


  const medianMfeR =
    median(
      top.map(
        x =>
          x.mfeR
      )
    );


  const medianMaeR =
    median(
      top.map(
        x =>
          x.maeR
      )
    );


  const avgSimilarity =
    mean(
      top.map(
        x =>
          x.similarity
      )
    );


  return {
    available:
      true,

    direction,

    matches:
      top.length,

    winCount:
      wins,

    lossCount:
      losses,

    unresolvedCount:
      unresolved,

    targetHitRate:
      round(
        (
          wins /
          top.length
        ) *
          100,
        1
      ),

    stopHitRate:
      round(
        (
          losses /
          top.length
        ) *
          100,
        1
      ),

    unresolvedRate:
      round(
        (
          unresolved /
          top.length
        ) *
          100,
        1
      ),

    expectancyR:
      round(
        expectancyR,
        3
      ),

    medianMfeR:
      round(
        medianMfeR,
        3
      ),

    medianMaeR:
      round(
        medianMaeR,
        3
      ),

    averageSimilarity:
      round(
        avgSimilarity,
        1
      ),

    forwardBars:
      HISTORICAL_FORWARD_BARS,

    forwardMinutes:
      HISTORICAL_FORWARD_BARS *
      5,

    stopModelAtr:
      DEFAULT_STOP_ATR,

    targetModelR:
      PRIMARY_TP_R,

    sampleWindowType:
      "FETCHED_M5_HISTORY_ONLY",

    note:
      "Empirical similarity statistics, not a guaranteed probability."
  };
}


/* =========================================================
   EDGE ENGINE
========================================================= */

function regimeAlignmentScore(
  regime,
  direction
) {

  const sign =
    directionSign(
      direction
    );


  if (
    regime.type ===
    "QUIET_CHOP"
  ) {
    return 25;
  }


  if (
    regime.type ===
    "RANGE"
  ) {
    return 55;
  }


  if (
    regime.type ===
    "MIXED"
  ) {
    return 50;
  }


  if (
    regime.type ===
      "BULLISH_EXPANSION" ||
    regime.type ===
      "BULLISH_TREND"
  ) {

    return sign === 1
      ? 90
      : 25;

  }


  if (
    regime.type ===
      "BEARISH_EXPANSION" ||
    regime.type ===
      "BEARISH_TREND"
  ) {

    return sign === -1
      ? 90
      : 25;

  }


  return 50;
}


function buildEdgeDecision(
  technical,
  regime,
  historical
) {

  const direction =
    technical
      .candidateDirection;


  const technicalStrength =
    finite(
      technical
        .technicalStrength
    ) ??
    0;


  const agreement =
    finite(
      technical
        .modelAgreement
    ) ??
    0;


  const regimeAlignment =
    regimeAlignmentScore(
      regime,
      direction
    );


  const matchCount =
    historical.matches ||
    0;


  const sampleScore =
    clamp(
      (
        matchCount /
        MIN_HISTORICAL_MATCHES
      ) *
        100,
      0,
      100
    );


  const similarityScoreValue =
    finite(
      historical
        .averageSimilarity
    ) ??
    0;


  const expectancy =
    finite(
      historical
        .expectancyR
    ) ??
    -1;


  const targetHit =
    finite(
      historical
        .targetHitRate
    ) ??
    0;


  const expectancyScore =
    clamp(
      50 +
      expectancy *
        55,
      0,
      100
    );


  const historicalScore =
    clamp(
      targetHit *
        0.40 +

      similarityScoreValue *
        0.25 +

      sampleScore *
        0.20 +

      expectancyScore *
        0.15,
      0,
      100
    );


  const edgeScore =
    clamp(
      technicalStrength *
        0.30 +

      agreement *
        100 *
        0.18 +

      historicalScore *
        0.28 +

      regimeAlignment *
        0.14 +

      (
        finite(
          regime.confidence
        ) ??
        50
      ) *
        0.10,
      0,
      100
    );


  const gates = {

    technicalStrength:
      technicalStrength >=
      MIN_TECHNICAL_SCORE,

    modelAgreement:
      agreement >=
      MIN_MODEL_AGREEMENT,

    historicalSample:
      matchCount >=
      MIN_HISTORICAL_MATCHES,

    historicalExpectancy:
      expectancy >=
      MIN_EXPECTANCY_R,

    regimeNotQuietChop:
      regime.type !==
      "QUIET_CHOP",

    edgeScore:
      edgeScore >=
      MIN_EDGE_SCORE
  };


  const failed =
    Object.entries(
      gates
    )
      .filter(
        (
          [
            ,
            pass
          ]
        ) =>
          !pass
      )
      .map(
        (
          [
            name
          ]
        ) =>
          name
      );


  const qualified =
    failed.length ===
    0;


  return {
    signal:
      qualified
        ? direction
        : "WAIT",

    candidateDirection:
      direction,

    qualified,

    edgeScore:
      round(
        edgeScore,
        1
      ),

    technicalStrength:
      round(
        technicalStrength,
        1
      ),

    modelAgreement:
      round(
        agreement,
        3
      ),

    regimeAlignment:
      round(
        regimeAlignment,
        1
      ),

    historicalScore:
      round(
        historicalScore,
        1
      ),

    gates,

    failedGates:
      failed,

    thresholds: {
      minEdgeScore:
        MIN_EDGE_SCORE,

      minTechnicalScore:
        MIN_TECHNICAL_SCORE,

      minModelAgreement:
        MIN_MODEL_AGREEMENT,

      minHistoricalMatches:
        MIN_HISTORICAL_MATCHES,

      minExpectancyR:
        MIN_EXPECTANCY_R
    }
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

  if (
    ![
      "BUY",
      "SELL"
    ].includes(
      signal
    )
  ) {
    return null;
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
      bodyOf(
        req
      );


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
        80 ||
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
        "Gold market data is stale. A fresh analysis cannot be created."
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


    const regime =
      detectRegime(
        m5
      );


    const technical =
      scoreMarket(
        packet
      );


    const historical =
      historicalSimilarity(
        m5,
        technical
          .candidateDirection
      );


    const edge =
      buildEdgeDecision(
        technical,
        regime,
        historical
      );


    const plan =
      edge.qualified
        ? createTradePlan(
            edge.signal,
            livePrice,
            packet
          )
        : null;


    const account =
      buildAccount(
        body
      );


    const signalId =
      edge.qualified
        ? `MK-${Date.now()}-${edge.signal}`
        : null;


    return send(
      res,
      200,
      {
        success:
          true,

        model:
          "MKAYFX GOLD EDGE ENGINE V10",

        symbol:
          SYMBOL,

        signalId,

        signal:
          edge.signal,

        candidateDirection:
          edge.candidateDirection,

        tradeQualified:
          edge.qualified,

        locked:
          edge.qualified,

        createdAt:
          new Date()
            .toISOString(),

        session:
          packet.session,

        edgeScore:
          edge.edgeScore,

        edgeType:
          "COMPOSITE_EDGE_SCORE_NOT_WIN_PROBABILITY",

        entry:
          plan?.entry ??
          round(
            livePrice,
            2
          ),

        stopLoss:
          plan?.stopLoss ??
          null,

        takeProfit:
          plan?.takeProfit ??
          null,

        takeProfit2:
          plan?.takeProfit2 ??
          null,

        riskReward:
          plan?.riskReward ??
          null,

        riskReward2:
          plan?.riskReward2 ??
          null,

        riskDistance:
          plan?.riskDistance ??
          null,

        marketRegime:
          regime,

        edgeDecision:
          edge,

        historicalEdge:
          historical,

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

        lifecycle:
          edge.qualified
            ? {
                state:
                  "TRADE_ACTIVE",

                rule:
                  "Signal remains locked until primary TP or SL is reached.",

                nextAnalysis:
                  "Immediately after TP or SL."
              }
            : {
                state:
                  "WAITING_FOR_EDGE",

                rule:
                  "No trade is locked because the edge gate did not pass.",

                nextAnalysis:
                  "Frontend may request a fresh analysis on the next analysis cycle."
              },

        dataQuality: {
          rawM1:
            rawM1.length,

          completedM1:
            m1.length,

          completedM5:
            m5.length,

          completedM15:
            m15.length,

          completedH1:
            h1.length,

          staleMilliseconds:
            Math.max(
              0,
              dataAge
            )
        }
      }
    );

  }
  catch (
    error
  ) {

    console.error(
      "MKAYFX V10 ANALYZE:",
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