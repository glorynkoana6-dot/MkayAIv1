/* =========================================================
   MKAYFX GOLD SCALPER V6
   XAU/USD ONLY
   SMALL-ACCOUNT / LIQUIDITY / SESSION / REGIME ENGINE

   CORE MODEL
   ---------
   H1  = Macro intraday context
   M15 = Main directional bias
   M5  = Confirmation
   M1  = Entry trigger

   GOLD-SPECIFIC FEATURES
   ----------------------
   - Asian range liquidity
   - Previous-day high / low
   - London liquidity behavior
   - New York liquidity behavior
   - Sweep + reclaim detection
   - BOS / CHOCH
   - Displacement candles
   - Wilder RSI / ATR / ADX
   - Momentum confirmation
   - Volatility regime
   - Anti-chase filter
   - Spread protection
   - Optional broker lot sizing
   - High-impact USD news guard
   - R200 account protection

   IMPORTANT
   ---------
   "setupStrength" is NOT a win probability.

========================================================= */

const TWELVE_DATA_API_KEY =
  process.env.TWELVE_DATA_API_KEY;

const TWELVE_URL =
  "https://api.twelvedata.com/time_series";

const SYMBOL =
  "XAU/USD";

/* =========================================================
   DATA
========================================================= */

const CACHE_MS =
  Number(
    process.env.CACHE_MS ||
    50_000
  );

const OUTPUT_SIZE =
  Number(
    process.env.OUTPUT_SIZE ||
    1000
  );

const BASE_INTERVAL_MINUTES =
  1;

const STALE_DATA_MS =
  Number(
    process.env.STALE_DATA_MS ||
    5 * 60_000
  );

const HTF_MIN_COMPLETENESS =
  Number(
    process.env.HTF_MIN_COMPLETENESS ||
    0.92
  );

/* =========================================================
   ACCOUNT PROTECTION
========================================================= */

const DEFAULT_EQUITY_ZAR =
  Number(
    process.env.DEFAULT_EQUITY_ZAR ||
    200
  );

const RISK_PER_TRADE_PCT =
  Number(
    process.env.RISK_PER_TRADE_PCT ||
    0.25
  );

const MAX_RISK_PER_TRADE_PCT =
  0.50;

const DAILY_LOSS_LIMIT_PCT =
  Number(
    process.env.DAILY_LOSS_LIMIT_PCT ||
    1.50
  );

const MAX_TRADES_PER_DAY =
  Number(
    process.env.MAX_TRADES_PER_DAY ||
    6
  );

const MAX_CONSECUTIVE_LOSSES =
  Number(
    process.env.MAX_CONSECUTIVE_LOSSES ||
    3
  );

const LOSS_COOLDOWN_MINUTES =
  Number(
    process.env.LOSS_COOLDOWN_MINUTES ||
    10
  );

/* =========================================================
   GOLD EXECUTION FILTERS
========================================================= */

const MAX_SPREAD_USD =
  Number(
    process.env.MAX_SPREAD_USD ||
    0.45
  );

const MAX_ENTRY_STRETCH_ATR =
  Number(
    process.env.MAX_ENTRY_STRETCH_ATR ||
    1.55
  );

const MAX_STOP_ATR =
  Number(
    process.env.MAX_STOP_ATR ||
    1.75
  );

const MIN_STOP_ATR =
  Number(
    process.env.MIN_STOP_ATR ||
    0.65
  );

const MAX_SWING_AGE_M1 =
  Number(
    process.env.MAX_SWING_AGE_M1 ||
    18
  );

/* =========================================================
   PROFIT TARGETS
========================================================= */

const TP1_R =
  Number(
    process.env.TP1_R ||
    1.0
  );

const TP2_R =
  Number(
    process.env.TP2_R ||
    1.6
  );

const MIN_LIQUIDITY_ROOM_R =
  Number(
    process.env.MIN_LIQUIDITY_ROOM_R ||
    1.10
  );

const MAX_HOLD_MINUTES =
  Number(
    process.env.MAX_HOLD_MINUTES ||
    25
  );

/* =========================================================
   ENSEMBLE
========================================================= */

const MIN_ENSEMBLE_SCORE =
  Number(
    process.env.MIN_ENSEMBLE_SCORE ||
    67
  );

const MIN_ENSEMBLE_MARGIN =
  Number(
    process.env.MIN_ENSEMBLE_MARGIN ||
    34
  );

const MIN_ENSEMBLE_QUALITY =
  Number(
    process.env.MIN_ENSEMBLE_QUALITY ||
    60
  );

const MIN_MODULE_AGREEMENT =
  Number(
    process.env.MIN_MODULE_AGREEMENT ||
    60
  );

const WEIGHTS =
  Object.freeze({
    trend: 24,
    structure: 22,
    liquidity: 26,
    momentum: 12,
    regime: 8,
    gold: 8
  });

/* =========================================================
   CACHE
========================================================= */

const marketCache =
  new Map();

const inFlight =
  new Map();

/* =========================================================
   BASIC UTILITIES
========================================================= */

function send(
  res,
  status,
  data
) {
  return res
    .status(status)
    .json(data);
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

function round(
  value,
  digits = 2
) {
  const n =
    Number(value);

  if (
    !Number.isFinite(n)
  ) {
    return null;
  }

  return Number(
    n.toFixed(digits)
  );
}

function priceRound(
  value
) {
  return round(
    value,
    2
  );
}

function mean(
  values
) {
  if (
    !values.length
  ) {
    return null;
  }

  return (
    values.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    values.length
  );
}

function stdDev(
  values
) {
  if (
    !values.length
  ) {
    return null;
  }

  const avg =
    mean(values);

  return Math.sqrt(
    values.reduce(
      (
        sum,
        value
      ) =>
        sum +
        (
          value -
          avg
        ) ** 2,
      0
    ) /
      values.length
  );
}

function parseUTC(
  datetime
) {
  if (!datetime) {
    return NaN;
  }

  const clean =
    String(datetime)
      .trim()
      .replace(
        " ",
        "T"
      );

  const zoned =
    /Z$|[+-]\d\d:\d\d$/.test(
      clean
    )
      ? clean
      : `${clean}Z`;

  return new Date(
    zoned
  ).getTime();
}

function getRequestBody(
  req
) {
  if (
    !req.body
  ) {
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
  } catch {
    return {};
  }
}

/* =========================================================
   TIMEZONE UTILITIES

   London/NY local clocks are used so DST changes do not
   destroy the session model.
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

  const parts =
    formatter.formatToParts(
      new Date(ms)
    );

  const object = {};

  for (
    const item of
    parts
  ) {
    if (
      item.type !==
      "literal"
    ) {
      object[
        item.type
      ] =
        item.value;
    }
  }

  return {
    year:
      Number(
        object.year
      ),

    month:
      Number(
        object.month
      ),

    day:
      Number(
        object.day
      ),

    hour:
      Number(
        object.hour
      ),

    minute:
      Number(
        object.minute
      ),

    dateKey:
      `${object.year}-${object.month}-${object.day}`
  };
}

function sessionForTimestamp(
  ms
) {
  if (
    !Number.isFinite(ms)
  ) {
    return "UNKNOWN";
  }

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

  /*
     Main overlap.
  */

  if (
    london.hour >= 12 &&
    london.hour < 16 &&
    ny.hour >= 7 &&
    ny.hour < 11
  ) {
    return "LONDON_NEW_YORK_OVERLAP";
  }

  /*
     London AM.
  */

  if (
    london.hour >= 8 &&
    london.hour < 12
  ) {
    return "LONDON";
  }

  /*
     NY AM / early PM.
  */

  if (
    ny.hour >= 8 &&
    ny.hour < 13
  ) {
    return "NEW_YORK";
  }

  /*
     London-local overnight / Asia.
  */

  if (
    london.hour >= 0 &&
    london.hour < 8
  ) {
    return "ASIA";
  }

  return "TRANSITION";
}

/* =========================================================
   HTTP
========================================================= */

async function fetchJson(
  url,
  options = {},
  timeoutMs = 15_000
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );

  try {
    const response =
      await fetch(
        url,
        {
          ...options,
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

    return {
      response,
      data
    };
  } finally {
    clearTimeout(
      timer
    );
  }
}

/* =========================================================
   TWELVE DATA M1
========================================================= */

async function requestGoldM1() {
  if (
    !TWELVE_DATA_API_KEY
  ) {
    throw new Error(
      "TWELVE_DATA_API_KEY is missing."
    );
  }

  const params =
    new URLSearchParams({
      symbol:
        SYMBOL,

      interval:
        "1min",

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

  const {
    response,
    data
  } =
    await fetchJson(
      `${TWELVE_URL}?${params.toString()}`
    );

  if (
    !response.ok ||
    data.status ===
      "error" ||
    !Array.isArray(
      data.values
    )
  ) {
    throw new Error(
      data.message ||
      "Twelve Data XAU/USD request failed."
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
          ].every(
            Number.isFinite
          )
      )
      .reverse();

  if (
    candles.length <
    300
  ) {
    throw new Error(
      "Not enough XAU/USD M1 candles."
    );
  }

  return candles;
}

async function getGoldM1Cached() {
  const key =
    SYMBOL;

  const cached =
    marketCache.get(
      key
    );

  if (
    cached &&
    Date.now() -
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

  if (
    inFlight.has(
      key
    )
  ) {
    return {
      candles:
        await inFlight.get(
          key
        ),

      cacheHit:
        true
    };
  }

  const pending =
    requestGoldM1()
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

  return {
    candles:
      await pending,

    cacheHit:
      false
  };
}

/* =========================================================
   COMPLETED M1 CANDLES
========================================================= */

function completedM1(
  candles,
  nowMs = Date.now()
) {
  return candles.filter(
    candle => {
      const start =
        parseUTC(
          candle.t
        );

      return (
        Number.isFinite(
          start
        ) &&
        start +
          60_000 <=
          nowMs
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
  const bucketMs =
    minutes *
    60_000;

  const expected =
    minutes;

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
      !Number.isFinite(
        ms
      )
    ) {
      continue;
    }

    const bucket =
      Math.floor(
        ms /
          bucketMs
      ) *
      bucketMs;

    if (
      !map.has(
        bucket
      )
    ) {
      map.set(
        bucket,
        []
      );
    }

    map
      .get(bucket)
      .push(
        candle
      );
  }

  const output =
    [];

  for (
    const [
      timestamp,
      groupRaw
    ] of map
  ) {
    const unique =
      new Map();

    for (
      const candle of
      groupRaw
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

    const completeness =
      group.length /
      expected;

    if (
      completeness <
      HTF_MIN_COMPLETENESS
    ) {
      continue;
    }

    const first =
      group[0];

    const last =
      group.at(-1);

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
            x =>
              x.h
          )
        ),

      l:
        Math.min(
          ...group.map(
            x =>
              x.l
          )
        ),

      c:
        last.c,

      v:
        group.reduce(
          (
            sum,
            x
          ) =>
            sum +
            (
              x.v ||
              0
            ),
          0
        ),

      completeness:
        round(
          completeness,
          3
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

  const seed =
    mean(
      values.slice(
        0,
        period
      )
    );

  const out =
    Array(
      period -
      1
    ).fill(
      null
    );

  let current =
    seed;

  out.push(
    current
  );

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

    out.push(
      current
    );
  }

  return out;
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
   WILDER RSI
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
      closes[
        i - 1
      ];

    if (
      change >= 0
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
      closes[
        i - 1
      ];

    const gain =
      Math.max(
        change,
        0
      );

    const loss =
      Math.max(
        -change,
        0
      );

    avgGain =
      (
        avgGain *
          (
            period -
            1
          ) +
        gain
      ) /
      period;

    avgLoss =
      (
        avgLoss *
          (
            period -
            1
          ) +
        loss
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
   TRUE RANGE / ATR
========================================================= */

function trueRanges(
  candles
) {
  const out =
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
      candles[
        i - 1
      ];

    out.push(
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

  return out;
}

function wilderSeries(
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

  const out =
    [
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

    out.push(
      current
    );
  }

  return out;
}

function atrSeries(
  candles,
  period = 14
) {
  return wilderSeries(
    trueRanges(
      candles
    ),
    period
  );
}

function atr(
  candles,
  period = 14
) {
  const series =
    atrSeries(
      candles,
      period
    );

  return series.length
    ? series.at(-1)
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
    period * 2 +
      2
  ) {
    return null;
  }

  const tr = [];
  const plusDM = [];
  const minusDM = [];

  for (
    let i = 1;
    i <
      candles.length;

    i++
  ) {
    const current =
      candles[i];

    const previous =
      candles[
        i - 1
      ];

    const up =
      current.h -
      previous.h;

    const down =
      previous.l -
      current.l;

    plusDM.push(
      up >
          down &&
        up > 0
        ? up
        : 0
    );

    minusDM.push(
      down >
          up &&
        down > 0
        ? down
        : 0
    );

    tr.push(
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

  let smoothedTR =
    tr
      .slice(
        0,
        period
      )
      .reduce(
        (
          sum,
          value
        ) =>
          sum + value,
        0
      );

  let smoothedPlus =
    plusDM
      .slice(
        0,
        period
      )
      .reduce(
        (
          sum,
          value
        ) =>
          sum + value,
        0
      );

  let smoothedMinus =
    minusDM
      .slice(
        0,
        period
      )
      .reduce(
        (
          sum,
          value
        ) =>
          sum + value,
        0
      );

  const dx =
    [];

  function calculateDx() {
    if (
      smoothedTR <= 0
    ) {
      return;
    }

    const plusDI =
      100 *
      smoothedPlus /
      smoothedTR;

    const minusDI =
      100 *
      smoothedMinus /
      smoothedTR;

    const total =
      plusDI +
      minusDI;

    if (
      total <= 0
    ) {
      return;
    }

    dx.push(
      100 *
      Math.abs(
        plusDI -
        minusDI
      ) /
      total
    );
  }

  calculateDx();

  for (
    let i =
      period;

    i <
      tr.length;

    i++
  ) {
    smoothedTR =
      smoothedTR -
      smoothedTR /
        period +
      tr[i];

    smoothedPlus =
      smoothedPlus -
      smoothedPlus /
        period +
      plusDM[i];

    smoothedMinus =
      smoothedMinus -
      smoothedMinus /
        period +
      minusDM[i];

    calculateDx();
  }

  if (
    !dx.length
  ) {
    return null;
  }

  if (
    dx.length <
    period
  ) {
    return mean(
      dx
    );
  }

  let result =
    mean(
      dx.slice(
        0,
        period
      )
    );

  for (
    let i =
      period;

    i <
      dx.length;

    i++
  ) {
    result =
      (
        result *
          (
            period -
            1
          ) +
        dx[i]
      ) /
      period;
  }

  return result;
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

  const values =
    [];

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
      Number.isFinite(
        signal
      )
        ? line -
          signal
        : null
  };
}

/* =========================================================
   ROC
========================================================= */

function roc(
  closes,
  period = 10
) {
  if (
    closes.length <=
    period
  ) {
    return null;
  }

  const old =
    closes.at(
      -(
        period +
        1
      )
    );

  const now =
    closes.at(-1);

  if (
    !Number.isFinite(
      old
    ) ||
    old === 0
  ) {
    return null;
  }

  return (
    (
      now /
      old
    ) -
    1
  ) *
  100;
}

/* =========================================================
   ATR PERCENTILE
========================================================= */

function percentileRank(
  values,
  current
) {
  const clean =
    values.filter(
      Number.isFinite
    );

  if (
    !clean.length ||
    !Number.isFinite(
      current
    )
  ) {
    return null;
  }

  const count =
    clean.filter(
      x =>
        x <=
        current
    ).length;

  return (
    count /
    clean.length
  ) *
  100;
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
    let high =
      true;

    let low =
      true;

    for (
      let j =
        i -
        left;

      j <=
        i +
        right;

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
        high =
          false;
      }

      if (
        candles[j].l <=
        candles[i].l
      ) {
        low =
          false;
      }
    }

    if (high) {
      highs.push({
        index: i,

        ageBars:
          candles.length -
          1 -
          i,

        price:
          candles[i].h,

        t:
          candles[i].t
      });
    }

    if (low) {
      lows.push({
        index: i,

        ageBars:
          candles.length -
          1 -
          i,

        price:
          candles[i].l,

        t:
          candles[i].t
      });
    }
  }

  return {
    highs,
    lows
  };
}

function structureLabel(
  swings
) {
  const highs =
    swings.highs.slice(
      -2
    );

  const lows =
    swings.lows.slice(
      -2
    );

  if (
    highs.length <
      2 ||
    lows.length <
      2
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

function detectBosChoch(
  candles,
  swings
) {
  const close =
    candles.at(-1)?.c;

  const high =
    swings.highs.at(-1);

  const low =
    swings.lows.at(-1);

  const structure =
    structureLabel(
      swings
    );

  let bos =
    "NONE";

  let choch =
    "NONE";

  if (
    high &&
    close >
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
    close <
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
    bos,
    choch,
    structure
  };
}

/* =========================================================
   LIQUIDITY SWEEPS
========================================================= */

function detectGenericSweep(
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
      -(
        lookback +
        1
      ),
      -1
    );

  const high =
    Math.max(
      ...prior.map(
        x =>
          x.h
      )
    );

  const low =
    Math.min(
      ...prior.map(
        x =>
          x.l
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

function sweptLevelRecently(
  candles,
  level,
  type,
  lookback = 5
) {
  const n =
    Number(level);

  if (
    !Number.isFinite(
      n
    )
  ) {
    return false;
  }

  const recent =
    candles.slice(
      -lookback
    );

  if (
    type ===
    "SELL_SIDE"
  ) {
    return recent.some(
      candle =>
        candle.l <
          n &&
        candle.c >
          n
    );
  }

  if (
    type ===
    "BUY_SIDE"
  ) {
    return recent.some(
      candle =>
        candle.h >
          n &&
        candle.c <
          n
    );
  }

  return false;
}

/* =========================================================
   DISPLACEMENT

   Gold often makes aggressive expansion candles after
   liquidity is taken.
========================================================= */

function detectDisplacement(
  candles
) {
  const last =
    candles.at(-1);

  const atr14 =
    atr(
      candles,
      14
    );

  if (
    !last ||
    !Number.isFinite(
      atr14
    ) ||
    atr14 <= 0
  ) {
    return {
      direction:
        "NONE",

      strength:
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

  const bodyAtr =
    body /
    atr14;

  const closePosition =
    (
      last.c -
      last.l
    ) /
    range;

  if (
    last.c >
      last.o &&
    bodyAtr >=
      0.55 &&
    closePosition >=
      0.72
  ) {
    return {
      direction:
        "BULLISH",

      strength:
        round(
          bodyAtr,
          2
        )
    };
  }

  if (
    last.c <
      last.o &&
    bodyAtr >=
      0.55 &&
    closePosition <=
      0.28
  ) {
    return {
      direction:
        "BEARISH",

      strength:
        round(
          bodyAtr,
          2
        )
    };
  }

  return {
    direction:
      "NONE",

    strength:
      round(
        bodyAtr,
        2
      )
  };
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
   CANDLE MOMENTUM
========================================================= */

function candleMomentum(
  candles
) {
  const recent =
    candles.slice(
      -6
    );

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
      bull +=
        body;
    }

    if (
      candle.c <
      candle.o
    ) {
      bear +=
        body;
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
      x =>
        x.c
    );

  const atr14 =
    atr(
      candles,
      14
    );

  const atrHistory =
    atrSeries(
      candles.slice(
        -220
      ),
      14
    );

  const swings =
    findSwings(
      candles,
      2,
      2
    );

  const marketStructure =
    detectBosChoch(
      candles,
      swings
    );

  const sweep =
    detectGenericSweep(
      candles,
      20
    );

  const macdData =
    macd(
      closes
    );

  const displacement =
    detectDisplacement(
      candles
    );

  const latestHigh =
    swings.highs.at(-1);

  const latestLow =
    swings.lows.at(-1);

  return {
    price:
      priceRound(
        closes.at(-1)
      ),

    bias:
      trendBias(
        closes
      ),

    structure:
      marketStructure.structure,

    momentum:
      candleMomentum(
        candles
      ),

    displacement,

    indicators: {
      ema20:
        priceRound(
          ema(
            closes,
            20
          )
        ),

      ema50:
        priceRound(
          ema(
            closes,
            50
          )
        ),

      ema200:
        priceRound(
          ema(
            closes,
            200
          )
        ),

      atr14:
        priceRound(
          atr14
        ),

      atrPercentile:
        round(
          percentileRank(
            atrHistory,
            atr14
          ),
          1
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

      macd:
        round(
          macdData.line,
          5
        ),

      macdSignal:
        round(
          macdData.signal,
          5
        ),

      macdHistogram:
        round(
          macdData.histogram,
          5
        ),

      roc10:
        round(
          roc(
            closes,
            10
          ),
          4
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
          priceRound(
            sweep.level
          )
      },

      lastSwingHigh:
        priceRound(
          latestHigh
            ?.price
        ),

      lastSwingHighAge:
        latestHigh
          ?.ageBars ??
        null,

      lastSwingLow:
        priceRound(
          latestLow
            ?.price
        ),

      lastSwingLowAge:
        latestLow
          ?.ageBars ??
        null
    }
  };
}

/* =========================================================
   NEW YORK TRADING DAY LEVELS
========================================================= */

function buildDayLevels(
  candles
) {
  const groups =
    new Map();

  for (
    const candle of
    candles.slice(
      -900
    )
  ) {
    const ms =
      parseUTC(
        candle.t
      );

    if (
      !Number.isFinite(
        ms
      )
    ) {
      continue;
    }

    const key =
      zoneParts(
        ms,
        "America/New_York"
      ).dateKey;

    if (
      !groups.has(
        key
      )
    ) {
      groups.set(
        key,
        []
      );
    }

    groups
      .get(key)
      .push(
        candle
      );
  }

  const keys =
    [
      ...groups.keys()
    ].sort();

  function make(
    key
  ) {
    const group =
      groups.get(
        key
      ) ||
      [];

    if (
      !group.length
    ) {
      return null;
    }

    return {
      date:
        key,

      open:
        group[0].o,

      high:
        Math.max(
          ...group.map(
            x =>
              x.h
          )
        ),

      low:
        Math.min(
          ...group.map(
            x =>
              x.l
          )
        ),

      close:
        group.at(-1).c
    };
  }

  const current =
    keys.at(-1);

  const previous =
    keys.at(-2);

  return {
    currentDay:
      current
        ? make(
            current
          )
        : null,

    previousDay:
      previous
        ? make(
            previous
          )
        : null
  };
}

/* =========================================================
   ASIAN RANGE

   Defined using London-local time 00:00 -> 07:59.
   Using London-local time automatically handles UK DST.
========================================================= */

function buildAsianRange(
  candles
) {
  if (
    !candles.length
  ) {
    return null;
  }

  const latestMs =
    parseUTC(
      candles.at(-1).t
    );

  const latestLondon =
    zoneParts(
      latestMs,
      "Europe/London"
    );

  const currentDate =
    latestLondon.dateKey;

  const group =
    candles.filter(
      candle => {
        const ms =
          parseUTC(
            candle.t
          );

        const parts =
          zoneParts(
            ms,
            "Europe/London"
          );

        return (
          parts.dateKey ===
            currentDate &&
          parts.hour >=
            0 &&
          parts.hour <
            8
        );
      }
    );

  if (
    !group.length
  ) {
    return null;
  }

  return {
    date:
      currentDate,

    high:
      Math.max(
        ...group.map(
          x =>
            x.h
        )
      ),

    low:
      Math.min(
        ...group.map(
          x =>
            x.l
        )
      ),

    bars:
      group.length,

    complete:
      latestLondon.hour >=
      8
  };
}

/* =========================================================
   GOLD MARKET CONTEXT
========================================================= */

function buildGoldContext(
  packet,
  m1
) {
  const day =
    buildDayLevels(
      m1
    );

  const asia =
    buildAsianRange(
      m1
    );

  const previousDay =
    day.previousDay;

  const m1Displacement =
    packet.M1
      .displacement;

  const m5Displacement =
    packet.M5
      .displacement;

  const signals =
    [];

  let bullishLiquidity =
    0;

  let bearishLiquidity =
    0;

  if (
    asia?.complete
  ) {
    if (
      sweptLevelRecently(
        m1,
        asia.low,
        "SELL_SIDE",
        8
      )
    ) {
      bullishLiquidity +=
        35;

      signals.push(
        "Asian low swept and reclaimed."
      );
    }

    if (
      sweptLevelRecently(
        m1,
        asia.high,
        "BUY_SIDE",
        8
      )
    ) {
      bearishLiquidity +=
        35;

      signals.push(
        "Asian high swept and rejected."
      );
    }
  }

  if (
    previousDay
  ) {
    if (
      sweptLevelRecently(
        m1,
        previousDay.low,
        "SELL_SIDE",
        10
      )
    ) {
      bullishLiquidity +=
        28;

      signals.push(
        "Previous-day low swept and reclaimed."
      );
    }

    if (
      sweptLevelRecently(
        m1,
        previousDay.high,
        "BUY_SIDE",
        10
      )
    ) {
      bearishLiquidity +=
        28;

      signals.push(
        "Previous-day high swept and rejected."
      );
    }
  }

  if (
    packet.M1.ict
      .sweep.type ===
    "BULLISH_SELLSIDE_SWEEP"
  ) {
    bullishLiquidity +=
      18;
  }

  if (
    packet.M1.ict
      .sweep.type ===
    "BEARISH_BUYSIDE_SWEEP"
  ) {
    bearishLiquidity +=
      18;
  }

  if (
    m1Displacement.direction ===
    "BULLISH"
  ) {
    bullishLiquidity +=
      12;
  }

  if (
    m1Displacement.direction ===
    "BEARISH"
  ) {
    bearishLiquidity +=
      12;
  }

  if (
    m5Displacement.direction ===
    "BULLISH"
  ) {
    bullishLiquidity +=
      12;
  }

  if (
    m5Displacement.direction ===
    "BEARISH"
  ) {
    bearishLiquidity +=
      12;
  }

  return {
    asianRange:
      asia
        ? {
            high:
              priceRound(
                asia.high
              ),

            low:
              priceRound(
                asia.low
              ),

            complete:
              asia.complete,

            bars:
              asia.bars
          }
        : null,

    previousDay:
      previousDay
        ? {
            high:
              priceRound(
                previousDay.high
              ),

            low:
              priceRound(
                previousDay.low
              ),

            close:
              priceRound(
                previousDay.close
              )
          }
        : null,

    currentDay:
      day.currentDay
        ? {
            open:
              priceRound(
                day.currentDay.open
              ),

            high:
              priceRound(
                day.currentDay.high
              ),

            low:
              priceRound(
                day.currentDay.low
              )
          }
        : null,

    bullishLiquidityScore:
      clamp(
        bullishLiquidity,
        0,
        100
      ),

    bearishLiquidityScore:
      clamp(
        bearishLiquidity,
        0,
        100
      ),

    signals
  };
}

/* =========================================================
   REGIME
========================================================= */

function detectGoldRegime(
  packet
) {
  const adx5 =
    Number(
      packet.M5
        .indicators
        .adx14 ||
      0
    );

  const adx15 =
    Number(
      packet.M15
        .indicators
        .adx14 ||
      0
    );

  const atrPct =
    Number(
      packet.M5
        .indicators
        .atrPercentile ??
      50
    );

  if (
    atrPct >=
      95 &&
    packet.M5.bias !==
      packet.M15.bias
  ) {
    return {
      name:
        "EXTREME_CHOP",

      quality:
        25,

      volatility:
        "EXTREME"
    };
  }

  if (
    packet.M15.bias ===
      "BULLISH" &&
    packet.M5.bias ===
      "BULLISH" &&
    adx5 >=
      23
  ) {
    return {
      name:
        "TRENDING_BULLISH",

      quality:
        clamp(
          Math.round(
            68 +
            (
              adx5 -
              23
            )
          ),
          68,
          92
        ),

      volatility:
        atrPct >=
          75
          ? "HIGH"
          : "NORMAL"
    };
  }

  if (
    packet.M15.bias ===
      "BEARISH" &&
    packet.M5.bias ===
      "BEARISH" &&
    adx5 >=
      23
  ) {
    return {
      name:
        "TRENDING_BEARISH",

      quality:
        clamp(
          Math.round(
            68 +
            (
              adx5 -
              23
            )
          ),
          68,
          92
        ),

      volatility:
        atrPct >=
          75
          ? "HIGH"
          : "NORMAL"
    };
  }

  if (
    packet.M5.ict.bos ===
      "BULLISH_BOS" &&
    packet.M15.bias !==
      "BEARISH" &&
    adx5 >=
      20
  ) {
    return {
      name:
        "BREAKOUT_BULLISH",

      quality:
        76,

      volatility:
        atrPct >=
          70
          ? "HIGH"
          : "NORMAL"
    };
  }

  if (
    packet.M5.ict.bos ===
      "BEARISH_BOS" &&
    packet.M15.bias !==
      "BULLISH" &&
    adx5 >=
      20
  ) {
    return {
      name:
        "BREAKOUT_BEARISH",

      quality:
        76,

      volatility:
        atrPct >=
          70
          ? "HIGH"
          : "NORMAL"
    };
  }

  if (
    adx5 <
      17 &&
    adx15 <
      19
  ) {
    return {
      name:
        "RANGE",

      quality:
        42,

      volatility:
        atrPct <=
          30
          ? "LOW"
          : "NORMAL"
    };
  }

  return {
    name:
      "MIXED",

    quality:
      52,

    volatility:
      atrPct >=
        75
        ? "HIGH"
        : "NORMAL"
  };
}

/* =========================================================
   BIAS SIGN
========================================================= */

function biasSign(
  value
) {
  if (
    value ===
      "BULLISH" ||
    value ===
      "HH/HL" ||
    value ===
      "BULLISH_BOS" ||
    value ===
      "BULLISH_CHOCH"
  ) {
    return 1;
  }

  if (
    value ===
      "BEARISH" ||
    value ===
      "LH/LL" ||
    value ===
      "BEARISH_BOS" ||
    value ===
      "BEARISH_CHOCH"
  ) {
    return -1;
  }

  return 0;
}

/* =========================================================
   MODULE HELPER
========================================================= */

function moduleResult(
  name,
  signal,
  reliability,
  reasons = []
) {
  const value =
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
      value,

    reliability:
      clamp(
        Math.round(
          reliability
        ),
        0,
        100
      ),

    bias:
      value >=
        12
        ? "BULLISH"
        : value <=
            -12
          ? "BEARISH"
          : "NEUTRAL",

    reasons:
      reasons.slice(
        0,
        5
      )
  };
}

/* =========================================================
   TREND MODULE
========================================================= */

function trendModule(
  packet
) {
  let signal =
    biasSign(
      packet.H1.bias
    ) *
      20 +

    biasSign(
      packet.M15.bias
    ) *
      35 +

    biasSign(
      packet.M5.bias
    ) *
      30 +

    biasSign(
      packet.M1.bias
    ) *
      15;

  return moduleResult(
    "trend",
    signal,
    65 +
      Math.abs(
        signal
      ) *
        0.25,
    [
      `H1 ${packet.H1.bias}`,
      `M15 ${packet.M15.bias}`,
      `M5 ${packet.M5.bias}`,
      `M1 ${packet.M1.bias}`
    ]
  );
}

/* =========================================================
   STRUCTURE MODULE
========================================================= */

function structureModule(
  packet
) {
  let signal = 0;

  signal +=
    biasSign(
      packet.M15
        .structure
    ) *
      18;

  signal +=
    biasSign(
      packet.M5
        .structure
    ) *
      26;

  signal +=
    biasSign(
      packet.M5
        .ict
        .bos
    ) *
      20;

  signal +=
    biasSign(
      packet.M1
        .ict
        .bos
    ) *
      20;

  signal +=
    biasSign(
      packet.M1
        .ict
        .choch
    ) *
      16;

  return moduleResult(
    "structure",
    signal,
    58 +
      Math.abs(
        signal
      ) *
        0.32,
    [
      `M15 ${packet.M15.structure}`,
      `M5 ${packet.M5.structure}`,
      `M5 ${packet.M5.ict.bos}`,
      `M1 ${packet.M1.ict.bos}`,
      `M1 ${packet.M1.ict.choch}`
    ]
  );
}

/* =========================================================
   LIQUIDITY MODULE
========================================================= */

function liquidityModule(
  packet
) {
  const gold =
    packet.gold;

  let signal =
    gold.bullishLiquidityScore -
    gold.bearishLiquidityScore;

  if (
    packet.M1
      .ict
      .sweep
      .type ===
    "BULLISH_SELLSIDE_SWEEP"
  ) {
    signal += 15;
  }

  if (
    packet.M1
      .ict
      .sweep
      .type ===
    "BEARISH_BUYSIDE_SWEEP"
  ) {
    signal -= 15;
  }

  return moduleResult(
    "liquidity",
    signal,
    62 +
      Math.min(
        30,
        Math.abs(
          signal
        ) *
          0.25
      ),
    gold.signals
  );
}

/* =========================================================
   MOMENTUM MODULE
========================================================= */

function momentumModule(
  packet
) {
  let signal =
    biasSign(
      packet.M1.momentum
    ) *
      30 +

    biasSign(
      packet.M5.momentum
    ) *
      35;

  const hist1 =
    Number(
      packet.M1
        .indicators
        .macdHistogram ||
      0
    );

  const hist5 =
    Number(
      packet.M5
        .indicators
        .macdHistogram ||
      0
    );

  signal +=
    hist1 > 0
      ? 15
      : hist1 < 0
        ? -15
        : 0;

  signal +=
    hist5 > 0
      ? 10
      : hist5 < 0
        ? -10
        : 0;

  const rsi1 =
    Number(
      packet.M1
        .indicators
        .rsi14 ||
      50
    );

  signal +=
    clamp(
      (
        rsi1 -
        50
      ) *
        0.6,
      -10,
      10
    );

  return moduleResult(
    "momentum",
    signal,
    58 +
      Math.abs(
        signal
      ) *
        0.3,
    [
      `M1 ${packet.M1.momentum}`,
      `M5 ${packet.M5.momentum}`,
      `M1 RSI ${round(rsi1, 1)}`
    ]
  );
}

/* =========================================================
   REGIME MODULE
========================================================= */

function regimeModule(
  packet
) {
  let signal = 0;

  switch (
    packet.regime.name
  ) {
    case "TRENDING_BULLISH":
      signal = 80;
      break;

    case "TRENDING_BEARISH":
      signal = -80;
      break;

    case "BREAKOUT_BULLISH":
      signal = 88;
      break;

    case "BREAKOUT_BEARISH":
      signal = -88;
      break;

    default:
      signal = 0;
  }

  return moduleResult(
    "regime",
    signal,
    packet.regime
      .quality,
    [
      packet.regime.name
    ]
  );
}

/* =========================================================
   GOLD-SPECIFIC MODULE
========================================================= */

function goldModule(
  packet
) {
  let signal = 0;

  const reasons =
    [];

  /*
     Gold reacts best during London / NY liquidity.
  */

  if (
    [
      "LONDON",
      "LONDON_NEW_YORK_OVERLAP",
      "NEW_YORK"
    ].includes(
      packet.session
    )
  ) {
    if (
      packet.M15.bias ===
      "BULLISH"
    ) {
      signal += 15;
    }

    if (
      packet.M15.bias ===
      "BEARISH"
    ) {
      signal -= 15;
    }

    reasons.push(
      `${packet.session} gold liquidity window.`
    );
  }

  /*
     Displacement is more important than a weak BOS.
  */

  if (
    packet.M1
      .displacement
      .direction ===
    "BULLISH"
  ) {
    signal += 25;

    reasons.push(
      "M1 bullish displacement."
    );
  }

  if (
    packet.M1
      .displacement
      .direction ===
    "BEARISH"
  ) {
    signal -= 25;

    reasons.push(
      "M1 bearish displacement."
    );
  }

  if (
    packet.M5
      .displacement
      .direction ===
    "BULLISH"
  ) {
    signal += 25;

    reasons.push(
      "M5 bullish displacement."
    );
  }

  if (
    packet.M5
      .displacement
      .direction ===
    "BEARISH"
  ) {
    signal -= 25;

    reasons.push(
      "M5 bearish displacement."
    );
  }

  return moduleResult(
    "gold",
    signal,
    68,
    reasons
  );
}

/* =========================================================
   ENTRY TRIGGER
========================================================= */

function hasEntryTrigger(
  direction,
  packet
) {
  if (
    direction ===
    "BUY"
  ) {
    const liquidity =
      packet.M1.ict
        .sweep.type ===
        "BULLISH_SELLSIDE_SWEEP" ||
      packet.gold
        .bullishLiquidityScore >=
        30;

    const structure =
      packet.M1.ict
        .bos ===
        "BULLISH_BOS" ||
      packet.M1.ict
        .choch ===
        "BULLISH_CHOCH";

    const displacement =
      packet.M1
        .displacement
        .direction ===
        "BULLISH" ||
      packet.M5
        .displacement
        .direction ===
        "BULLISH";

    const momentum =
      packet.M1.momentum ===
        "BULLISH" ||
      Number(
        packet.M1
          .indicators
          .macdHistogram
      ) > 0;

    return (
      (
        liquidity ||
        structure
      ) &&
      displacement &&
      momentum
    );
  }

  if (
    direction ===
    "SELL"
  ) {
    const liquidity =
      packet.M1.ict
        .sweep.type ===
        "BEARISH_BUYSIDE_SWEEP" ||
      packet.gold
        .bearishLiquidityScore >=
        30;

    const structure =
      packet.M1.ict
        .bos ===
        "BEARISH_BOS" ||
      packet.M1.ict
        .choch ===
        "BEARISH_CHOCH";

    const displacement =
      packet.M1
        .displacement
        .direction ===
        "BEARISH" ||
      packet.M5
        .displacement
        .direction ===
        "BEARISH";

    const momentum =
      packet.M1.momentum ===
        "BEARISH" ||
      Number(
        packet.M1
          .indicators
          .macdHistogram
      ) < 0;

    return (
      (
        liquidity ||
        structure
      ) &&
      displacement &&
      momentum
    );
  }

  return false;
}

/* =========================================================
   TECHNICAL SCORE
========================================================= */

function scoreTechnical(
  packet
) {
  const modules =
    [
      trendModule(
        packet
      ),

      structureModule(
        packet
      ),

      liquidityModule(
        packet
      ),

      momentumModule(
        packet
      ),

      regimeModule(
        packet
      ),

      goldModule(
        packet
      )
    ];

  let numerator = 0;
  let denominator = 0;
  let reliabilityTotal = 0;

  for (
    const module of
    modules
  ) {
    const weight =
      WEIGHTS[
        module.name
      ];

    const reliability =
      Math.max(
        0.25,
        module.reliability /
          100
      );

    numerator +=
      module.signal *
      weight *
      reliability;

    denominator +=
      weight *
      reliability;

    reliabilityTotal +=
      module.reliability *
      weight;
  }

  const signal =
    denominator
      ? numerator /
        denominator
      : 0;

  const totalWeight =
    Object.values(
      WEIGHTS
    ).reduce(
      (
        sum,
        x
      ) =>
        sum + x,
      0
    );

  let quality =
    reliabilityTotal /
    totalWeight;

  const buyScore =
    clamp(
      Math.round(
        50 +
        signal /
          2
      ),
      0,
      100
    );

  const sellScore =
    clamp(
      Math.round(
        50 -
        signal /
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

  const provisional =
    signal > 0
      ? "BUY"
      : signal < 0
        ? "SELL"
        : "WAIT";

  const directional =
    modules.filter(
      x =>
        Math.abs(
          x.signal
        ) >=
        12
    );

  const agreeing =
    directional.filter(
      module =>
        provisional ===
        "BUY"
          ? module.signal >
            0
          : provisional ===
              "SELL"
            ? module.signal <
              0
            : false
    ).length;

  const agreementPct =
    directional.length
      ? agreeing /
        directional.length *
        100
      : 0;

  const penalties =
    [];

  /*
     Anti-chase logic.
  */

  const price =
    Number(
      packet.currentPrice
    );

  const ema20 =
    Number(
      packet.M1
        .indicators
        .ema20
    );

  const atr1 =
    Math.max(
      Number(
        packet.M1
          .indicators
          .atr14 ||
        0
      ),
      0.01
    );

  const stretch =
    Number.isFinite(
      ema20
    )
      ? Math.abs(
          price -
          ema20
        ) /
        atr1
      : 0;

  if (
    stretch >
    MAX_ENTRY_STRETCH_ATR
  ) {
    quality -= 18;

    penalties.push(
      `Price stretched ${round(
        stretch,
        2
      )} ATR from M1 EMA20.`
    );
  }

  /*
     Do not fight M5 + M15 together.
  */

  if (
    provisional ===
      "BUY" &&
    packet.M5.bias ===
      "BEARISH" &&
    packet.M15.bias ===
      "BEARISH"
  ) {
    quality -= 20;

    penalties.push(
      "BUY conflicts with both M5 and M15."
    );
  }

  if (
    provisional ===
      "SELL" &&
    packet.M5.bias ===
      "BULLISH" &&
    packet.M15.bias ===
      "BULLISH"
  ) {
    quality -= 20;

    penalties.push(
      "SELL conflicts with both M5 and M15."
    );
  }

  if (
    packet.regime.name ===
    "EXTREME_CHOP"
  ) {
    quality -= 30;

    penalties.push(
      "Extreme-volatility chop."
    );
  }

  if (
    packet.session ===
      "ASIA"
  ) {
    quality -= 8;

    penalties.push(
      "Asia session receives reduced gold scalp quality."
    );
  }

  if (
    packet.session ===
      "TRANSITION"
  ) {
    quality -= 18;

    penalties.push(
      "Transition session."
    );
  }

  if (
    agreementPct <
    MIN_MODULE_AGREEMENT
  ) {
    quality -= 10;

    penalties.push(
      `Module agreement only ${round(
        agreementPct,
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

  let direction =
    "WAIT";

  if (
    provisional !==
      "WAIT" &&
    best >=
      MIN_ENSEMBLE_SCORE &&
    margin >=
      MIN_ENSEMBLE_MARGIN &&
    quality >=
      MIN_ENSEMBLE_QUALITY &&
    agreementPct >=
      MIN_MODULE_AGREEMENT &&
    hasEntryTrigger(
      provisional,
      packet
    )
  ) {
    direction =
      provisional;
  }

  return {
    direction,

    provisional,

    buyScore,
    sellScore,
    score:
      best,

    margin,

    quality,

    agreementPct:
      round(
        agreementPct,
        1
      ),

    signedSignal:
      round(
        signal,
        1
      ),

    stretchAtr:
      round(
        stretch,
        2
      ),

    entryTrigger:
      provisional !==
        "WAIT"
        ? hasEntryTrigger(
            provisional,
            packet
          )
        : false,

    modules,

    penalties
  };
}

/* =========================================================
   GOLD TARGET LIQUIDITY
========================================================= */

function buildTargets(
  direction,
  packet,
  entry
) {
  const levels =
    [];

  function add(
    price,
    name
  ) {
    const n =
      Number(price);

    if (
      !Number.isFinite(
        n
      )
    ) {
      return;
    }

    if (
      direction ===
        "BUY" &&
      n >
        entry
    ) {
      levels.push({
        price:
          n,

        name
      });
    }

    if (
      direction ===
        "SELL" &&
      n <
        entry
    ) {
      levels.push({
        price:
          n,

        name
      });
    }
  }

  add(
    packet.gold
      .asianRange
      ?.high,
    "Asian high"
  );

  add(
    packet.gold
      .asianRange
      ?.low,
    "Asian low"
  );

  add(
    packet.gold
      .previousDay
      ?.high,
    "Previous-day high"
  );

  add(
    packet.gold
      .previousDay
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

  add(
    packet.M15
      .ict
      .lastSwingHigh,
    "M15 swing high"
  );

  add(
    packet.M15
      .ict
      .lastSwingLow,
    "M15 swing low"
  );

  const unique =
    [];

  for (
    const item of
    levels.sort(
      (a, b) =>
        Math.abs(
          a.price -
          entry
        ) -
        Math.abs(
          b.price -
          entry
        )
    )
  ) {
    if (
      unique.some(
        x =>
          Math.abs(
            x.price -
            item.price
          ) <=
          0.05
      )
    ) {
      continue;
    }

    unique.push(
      item
    );
  }

  return unique;
}

/* =========================================================
   RISK PLAN
========================================================= */

function buildRiskPlan(
  direction,
  packet
) {
  if (
    direction ===
    "WAIT"
  ) {
    return {
      valid:
        false,

      reason:
        "No qualified gold setup."
    };
  }

  const entry =
    Number(
      packet.currentPrice
    );

  const atr1 =
    Number(
      packet.M1
        .indicators
        .atr14
    );

  if (
    !Number.isFinite(
      atr1
    ) ||
    atr1 <= 0
  ) {
    return {
      valid:
        false,

      reason:
        "Invalid M1 ATR."
    };
  }

  const swingLow =
    Number(
      packet.M1.ict
        .lastSwingLow
    );

  const swingHigh =
    Number(
      packet.M1.ict
        .lastSwingHigh
    );

  const swingLowAge =
    Number(
      packet.M1.ict
        .lastSwingLowAge
    );

  const swingHighAge =
    Number(
      packet.M1.ict
        .lastSwingHighAge
    );

  const validLow =
    Number.isFinite(
      swingLow
    ) &&
    swingLowAge <=
      MAX_SWING_AGE_M1 &&
    swingLow <
      entry;

  const validHigh =
    Number.isFinite(
      swingHigh
    ) &&
    swingHighAge <=
      MAX_SWING_AGE_M1 &&
    swingHigh >
      entry;

  const buffer =
    atr1 *
    0.15;

  let stop;

  if (
    direction ===
    "BUY"
  ) {
    stop =
      validLow
        ? swingLow -
          buffer
        : entry -
          atr1 *
            1.0;
  } else {
    stop =
      validHigh
        ? swingHigh +
          buffer
        : entry +
          atr1 *
            1.0;
  }

  let risk =
    Math.abs(
      entry -
      stop
    );

  /*
     Prevent unrealistically tight gold stops.
  */

  const minimumRisk =
    atr1 *
    MIN_STOP_ATR;

  if (
    risk <
    minimumRisk
  ) {
    stop =
      direction ===
        "BUY"
        ? entry -
          minimumRisk
        : entry +
          minimumRisk;

    risk =
      minimumRisk;
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
        `Stop requires ${round(
          stopAtr,
          2
        )} ATR; too wide for scalp.`
    };
  }

  const targets =
    buildTargets(
      direction,
      packet,
      entry
    );

  const nearest =
    targets[0] ||
    null;

  const nearestR =
    nearest
      ? Math.abs(
          nearest.price -
          entry
        ) /
        risk
      : null;

  if (
    nearestR !==
      null &&
    nearestR <
      MIN_LIQUIDITY_ROOM_R
  ) {
    return {
      valid:
        false,

      reason:
        `${nearest.name} is only ${round(
          nearestR,
          2
        )}R away.`
    };
  }

  const sign =
    direction ===
      "BUY"
      ? 1
      : -1;

  let tp1 =
    entry +
    sign *
      risk *
      TP1_R;

  let tp2 =
    entry +
    sign *
      risk *
      TP2_R;

  if (
    nearest &&
    nearestR >=
      1.0 &&
    nearestR <
      TP1_R *
        1.15
  ) {
    tp1 =
      nearest.price;
  }

  const second =
    targets.find(
      level => {
        const rr =
          Math.abs(
            level.price -
            entry
          ) /
          risk;

        return (
          rr >=
            1.35 &&
          rr <=
            2.25
        );
      }
    );

  if (second) {
    tp2 =
      second.price;
  }

  const rr1 =
    Math.abs(
      tp1 -
      entry
    ) /
    risk;

  const rr2 =
    Math.abs(
      tp2 -
      entry
    ) /
    risk;

  if (
    rr1 <
      0.95 ||
    rr2 <
      1.35
  ) {
    return {
      valid:
        false,

      reason:
        `Weak RR: TP1 ${round(
          rr1,
          2
        )}R / TP2 ${round(
          rr2,
          2
        )}R.`
    };
  }

  return {
    valid:
      true,

    entry:
      priceRound(
        entry
      ),

    stopLoss:
      priceRound(
        stop
      ),

    takeProfit1:
      priceRound(
        tp1
      ),

    takeProfit2:
      priceRound(
        tp2
      ),

    riskDistance:
      priceRound(
        risk
      ),

    stopAtr:
      round(
        stopAtr,
        2
      ),

    riskRewardTP1:
      `1:${round(
        rr1,
        2
      )}`,

    riskRewardTP2:
      `1:${round(
        rr2,
        2
      )}`,

    targetLiquidity:
      second
        ? second.name
        : nearest
          ? nearest.name
          : null,

    management: {
      maxHoldMinutes:
        MAX_HOLD_MINUTES,

      moveStopToBreakevenAtR:
        0.8,

      partialTakeProfitAtR:
        1.0,

      runnerTargetR:
        round(
          rr2,
          2
        )
    }
  };
}

/* =========================================================
   SMALL ACCOUNT PROTECTION
========================================================= */

function buildAccountProtection(
  body
) {
  const equity =
    Number(
      body.equity ??
      DEFAULT_EQUITY_ZAR
    );

  const dailyPnL =
    Number(
      body.dailyPnL ??
      0
    );

  const tradesToday =
    Number(
      body.tradesToday ??
      0
    );

  const consecutiveLosses =
    Number(
      body.consecutiveLosses ??
      0
    );

  const minutesSinceLastLoss =
    Number(
      body.minutesSinceLastLoss ??
      999
    );

  const riskPct =
    Math.min(
      RISK_PER_TRADE_PCT,
      MAX_RISK_PER_TRADE_PCT
    );

  const riskMoney =
    equity *
    (
      riskPct /
      100
    );

  const dailyLossLimit =
    equity *
    (
      DAILY_LOSS_LIMIT_PCT /
      100
    );

  const blockers =
    [];

  if (
    !Number.isFinite(
      equity
    ) ||
    equity <= 0
  ) {
    blockers.push(
      "Invalid account equity."
    );
  }

  if (
    dailyPnL <=
    -dailyLossLimit
  ) {
    blockers.push(
      "Daily loss limit reached."
    );
  }

  if (
    tradesToday >=
    MAX_TRADES_PER_DAY
  ) {
    blockers.push(
      "Maximum daily trades reached."
    );
  }

  if (
    consecutiveLosses >=
    MAX_CONSECUTIVE_LOSSES
  ) {
    blockers.push(
      "Three-loss protection activated."
    );
  }

  if (
    minutesSinceLastLoss <
    LOSS_COOLDOWN_MINUTES
  ) {
    blockers.push(
      "Loss cooldown still active."
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
      riskPct,

    maxRiskZAR:
      round(
        riskMoney,
        2
      ),

    dailyLossLimitZAR:
      round(
        dailyLossLimit,
        2
      ),

    tradesToday,

    consecutiveLosses,

    blockers
  };
}

/* =========================================================
   BROKER / POSITION SIZING

   Send:
   {
     bid,
     ask,
     tickSize,
     tickValuePerLot,
     minLot,
     lotStep
   }

   Do not assume XAU contract specs because brokers differ.
========================================================= */

function floorToStep(
  value,
  step
) {
  return (
    Math.floor(
      value /
      step
    ) *
    step
  );
}

function buildExecutionSizing(
  body,
  account,
  riskPlan
) {
  const bid =
    Number(
      body.bid
    );

  const ask =
    Number(
      body.ask
    );

  const tickSize =
    Number(
      body.tickSize
    );

  const tickValuePerLot =
    Number(
      body.tickValuePerLot
    );

  const minLot =
    Number(
      body.minLot
    );

  const lotStep =
    Number(
      body.lotStep
    );

  const spreadKnown =
    Number.isFinite(
      bid
    ) &&
    Number.isFinite(
      ask
    );

  const spread =
    spreadKnown
      ? ask -
        bid
      : null;

  if (
    spreadKnown &&
    spread >
      MAX_SPREAD_USD
  ) {
    return {
      valid:
        false,

      executionReady:
        false,

      spread:
        priceRound(
          spread
        ),

      reason:
        `Gold spread ${priceRound(
          spread
        )} exceeds ${MAX_SPREAD_USD}.`
    };
  }

  if (
    !riskPlan.valid
  ) {
    return {
      valid:
        false,

      executionReady:
        false,

      spread:
        priceRound(
          spread
        ),

      reason:
        "No valid risk plan."
    };
  }

  const sizingAvailable =
    [
      tickSize,
      tickValuePerLot,
      minLot,
      lotStep
    ].every(
      value =>
        Number.isFinite(
          value
        ) &&
        value >
          0
    );

  if (
    !sizingAvailable
  ) {
    return {
      valid:
        true,

      executionReady:
        false,

      spread:
        priceRound(
          spread
        ),

      reason:
        "Signal valid, but broker tick value / lot specifications were not supplied."
    };
  }

  const stopDistance =
    Math.abs(
      riskPlan.entry -
      riskPlan.stopLoss
    );

  const ticks =
    stopDistance /
    tickSize;

  const lossPerLot =
    ticks *
    tickValuePerLot;

  if (
    !Number.isFinite(
      lossPerLot
    ) ||
    lossPerLot <= 0
  ) {
    return {
      valid:
        false,

      executionReady:
        false,

      reason:
        "Invalid broker tick-value calculation."
    };
  }

  const rawLot =
    account.maxRiskZAR /
    lossPerLot;

  const lot =
    floorToStep(
      rawLot,
      lotStep
    );

  /*
     Most important R200 protection:
     do NOT force minimum lot if minimum lot risks too much.
  */

  if (
    lot <
    minLot
  ) {
    const minLotRisk =
      lossPerLot *
      minLot;

    return {
      valid:
        false,

      executionReady:
        false,

      requiredLot:
        round(
          rawLot,
          4
        ),

      minimumLot:
        minLot,

      minimumLotRiskZAR:
        round(
          minLotRisk,
          2
        ),

      maxAllowedRiskZAR:
        account.maxRiskZAR,

      reason:
        "Broker minimum lot would exceed the account risk limit."
    };
  }

  const actualRisk =
    lot *
    lossPerLot;

  return {
    valid:
      actualRisk <=
      account.maxRiskZAR *
      1.05,

    executionReady:
      true,

    spread:
      priceRound(
        spread
      ),

    lot:
      round(
        lot,
        4
      ),

    estimatedRiskZAR:
      round(
        actualRisk,
        2
      ),

    maxAllowedRiskZAR:
      account.maxRiskZAR,

    tickSize,

    tickValuePerLot,

    minimumLot:
      minLot,

    lotStep
  };
}

/* =========================================================
   OPTIONAL USD NEWS GUARD

   Gold is extremely sensitive to:
   CPI
   Core CPI
   NFP
   Unemployment
   PCE
   FOMC
   Powell
   Fed rate decisions

   Your frontend/news service can pass
   minutesToHighImpactUsdNews.
========================================================= */

function buildNewsGuard(
  body
) {
  const minutes =
    Number(
      body.minutesToHighImpactUsdNews
    );

  const explicitRisk =
    Boolean(
      body.highImpactUsdNews
    );

  if (
    explicitRisk
  ) {
    return {
      connected:
        true,

      allowed:
        false,

      reason:
        "High-impact USD news risk is active."
    };
  }

  if (
    Number.isFinite(
      minutes
    )
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
          `High-impact USD news in ${minutes} minutes.`
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
      "USD news calendar not connected."
  };
}

/* =========================================================
   DATA QUALITY
========================================================= */

function buildDataQuality(
  m1
) {
  const last =
    m1.at(-1);

  if (!last) {
    return {
      valid:
        false,

      reason:
        "No completed M1 candle."
    };
  }

  const lastEnd =
    parseUTC(
      last.t
    ) +
    60_000;

  const age =
    Date.now() -
    lastEnd;

  return {
    valid:
      age <=
      STALE_DATA_MS,

    stale:
      age >
      STALE_DATA_MS,

    ageMinutes:
      round(
        age /
        60_000,
        1
      ),

    latestCompletedM1:
      last.t
  };
}

/* =========================================================
   FINAL PERMISSION
========================================================= */

function buildPermission(
  packet,
  technical,
  riskPlan,
  account,
  sizing,
  news
) {
  const blockers =
    [];

  const warnings =
    [];

  function require(
    condition,
    message
  ) {
    if (
      !condition
    ) {
      blockers.push(
        message
      );
    }
  }

  require(
    packet.dataQuality
      .valid,

    "Market data is stale."
  );

  require(
    technical.direction !==
      "WAIT",

    "No ensemble-qualified XAU/USD scalp."
  );

  require(
    technical.score >=
      MIN_ENSEMBLE_SCORE,

    `Technical score below ${MIN_ENSEMBLE_SCORE}.`
  );

  require(
    technical.margin >=
      MIN_ENSEMBLE_MARGIN,

    `Directional margin below ${MIN_ENSEMBLE_MARGIN}.`
  );

  require(
    technical.quality >=
      MIN_ENSEMBLE_QUALITY,

    `Quality below ${MIN_ENSEMBLE_QUALITY}.`
  );

  require(
    technical.agreementPct >=
      MIN_MODULE_AGREEMENT,

    `Module agreement below ${MIN_MODULE_AGREEMENT}%.`
  );

  require(
    technical.entryTrigger,

    "No confirmed M1 gold entry trigger."
  );

  require(
    riskPlan.valid,

    riskPlan.reason ||
      "Invalid risk plan."
  );

  require(
    account.allowed,

    account.blockers.join(
      " "
    ) ||
      "Account protection block."
  );

  require(
    news.allowed,

    news.reason ||
      "USD news block."
  );

  /*
     Spread is hard-blocked if known and excessive.
     Missing sizing data does not invalidate a signal,
     but executionReady remains false.
  */

  if (
    sizing.valid ===
    false &&
    sizing.reason?.includes(
      "spread"
    )
  ) {
    blockers.push(
      sizing.reason
    );
  }

  if (
    sizing.valid ===
      false &&
    sizing.reason?.includes(
      "minimum lot"
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
      "Broker sizing unavailable."
    );
  }

  if (
    !news.connected
  ) {
    warnings.push(
      "High-impact USD news feed not connected."
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
        ...new Set(
          blockers
        )
      ],

    warnings:
      [
        ...new Set(
          warnings
        )
      ]
  };
}

/* =========================================================
   FINAL ANALYSIS
========================================================= */

function buildFinalAnalysis(
  packet,
  technical,
  riskPlan,
  account,
  sizing,
  news,
  permission
) {
  const action =
    permission.allowed
      ? technical.direction
      : "WAIT";

  let setupStrength =
    Math.round(
      technical.score *
        0.55 +
      technical.quality *
        0.25 +
      technical.agreementPct *
        0.20
    );

  if (
    action ===
    "WAIT"
  ) {
    setupStrength =
      Math.min(
        setupStrength,
        64
      );
  }

  setupStrength =
    clamp(
      setupStrength,
      0,
      96
    );

  return {
    action,

    setupStrength,

    confidence:
      setupStrength,

    confidenceType:
      "SETUP_STRENGTH_NOT_WIN_PROBABILITY",

    symbol:
      SYMBOL,

    strategy:
      "MKAYFX GOLD SCALPER V6",

    session:
      packet.session,

    regime:
      packet.regime,

    currentPrice:
      packet.currentPrice,

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

    entry:
      action ===
        "WAIT"
        ? null
        : riskPlan.entry,

    stopLoss:
      action ===
        "WAIT"
        ? null
        : riskPlan.stopLoss,

    takeProfit1:
      action ===
        "WAIT"
        ? null
        : riskPlan.takeProfit1,

    takeProfit2:
      action ===
        "WAIT"
        ? null
        : riskPlan.takeProfit2,

    riskRewardTP1:
      action ===
        "WAIT"
        ? "—"
        : riskPlan.riskRewardTP1,

    riskRewardTP2:
      action ===
        "WAIT"
        ? "—"
        : riskPlan.riskRewardTP2,

    management:
      action ===
        "WAIT"
        ? null
        : riskPlan.management,

    accountProtection:
      account,

    executionSizing:
      sizing,

    newsGuard:
      news,

    tradePermission:
      permission,

    technical: {
      selected:
        technical.direction,

      provisional:
        technical.provisional,

      buyScore:
        technical.buyScore,

      sellScore:
        technical.sellScore,

      score:
        technical.score,

      margin:
        technical.margin,

      quality:
        technical.quality,

      agreementPct:
        technical.agreementPct,

      signedSignal:
        technical.signedSignal,

      entryTrigger:
        technical.entryTrigger,

      stretchAtr:
        technical.stretchAtr,

      modules:
        technical.modules,

      penalties:
        technical.penalties
    },

    invalidation:
      action ===
        "BUY"
        ? `BUY invalid below ${riskPlan.stopLoss}.`
        : action ===
            "SELL"
          ? `SELL invalid above ${riskPlan.stopLoss}.`
          : "No active setup.",

    nextTrigger:
      action ===
        "WAIT"
        ? "Wait for a fresh M1 liquidity sweep / structure shift with M5 confirmation."
        : `Manage as a scalp; maximum intended hold ${MAX_HOLD_MINUTES} minutes.`
  };
}

/* =========================================================
   MAIN HANDLER
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
    "GET, POST, OPTIONS"
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
      getRequestBody(
        req
      );

    /*
      GOLD ONLY.
    */

    const {
      candles:
        rawM1,
      cacheHit
    } =
      await getGoldM1Cached();

    const currentPrice =
      Number(
        body.ask ||
        body.bid ||
        rawM1.at(-1)?.c
      );

    if (
      !Number.isFinite(
        currentPrice
      )
    ) {
      throw new Error(
        "Current gold price unavailable."
      );
    }

    /*
      Analysis uses completed M1 candles.
    */

    const m1 =
      completedM1(
        rawM1
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
      resample(
        m1,
        60
      );

    if (
      m1.length <
        300 ||
      m5.length <
        60 ||
      m15.length <
        40 ||
      h1.length <
        12
    ) {
      throw new Error(
        "Not enough completed XAU/USD candles."
      );
    }

    const latestCompletedMs =
      parseUTC(
        m1.at(-1).t
      );

    const packet = {
      symbol:
        SYMBOL,

      currentPrice:
        priceRound(
          currentPrice
        ),

      session:
        sessionForTimestamp(
          latestCompletedMs
        ),

      currentUTC:
        new Date()
          .toISOString(),

      dataQuality:
        buildDataQuality(
          m1
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
      buildGoldContext(
        packet,
        m1
      );

    packet.regime =
      detectGoldRegime(
        packet
      );

    const technical =
      scoreTechnical(
        packet
      );

    const riskPlan =
      buildRiskPlan(
        technical.direction,
        packet
      );

    const account =
      buildAccountProtection(
        body
      );

    const sizing =
      buildExecutionSizing(
        body,
        account,
        riskPlan
      );

    const news =
      buildNewsGuard(
        body
      );

    const permission =
      buildPermission(
        packet,
        technical,
        riskPlan,
        account,
        sizing,
        news
      );

    const analysis =
      buildFinalAnalysis(
        packet,
        technical,
        riskPlan,
        account,
        sizing,
        news,
        permission
      );

    return send(
      res,
      200,
      {
        success:
          true,

        model:
          "MKAYFX GOLD SCALPER V6",

        symbol:
          SYMBOL,

        gold_only:
          true,

        price:
          priceRound(
            currentPrice
          ),

        analysis,

        chart:
          rawM1
            .slice(
              -120
            )
            .map(
              candle => ({
                t:
                  candle.t,

                o:
                  priceRound(
                    candle.o
                  ),

                h:
                  priceRound(
                    candle.h
                  ),

                l:
                  priceRound(
                    candle.l
                  ),

                c:
                  priceRound(
                    candle.c
                  )
              })
            ),

        timeframe_engine:
          {
            entry:
              "M1",

            confirmation:
              "M5",

            trend:
              "M15",

            higher_timeframe:
              "H1"
          },

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
          permission,

        cache_hit:
          cacheHit,

        timestamp:
          new Date()
            .toISOString()
      }
    );
  } catch (
    error
  ) {
    console.error(
      "MKAYFX GOLD V6 ERROR:",
      error
    );

    return send(
      res,
      500,
      {
        success:
          false,

        model:
          "MKAYFX GOLD SCALPER V6",

        error:
          error?.message ||
          "Unknown server error."
      }
    );
  }
}