/* =========================================================
   MKAYFX EXTREME QUANT V5
   HARDENED DETERMINISTIC ENSEMBLE
   TREND / STRUCTURE / LIQUIDITY / MOMENTUM / REGIME / SESSION

   - NO GEMINI
   - NO EXTERNAL AI FILTER
   - WILDER RSI / ATR / ADX
   - STALE DATA GUARD
   - COMPLETED-CANDLE ENGINE
   - HTF BAR QUALITY FILTER
   - FVG LIFECYCLE CHECKS
   - SWING AGE VALIDATION
   - LIQUIDITY-ROOM FILTER
   - HARDENED RISK ENGINE
   - FIXED WAIT / PERMISSION LOGIC
========================================================= */

const TWELVE_DATA_API_KEY =
  process.env.TWELVE_DATA_API_KEY;

const TWELVE_URL =
  "https://api.twelvedata.com/time_series";

/* =========================================================
   DATA SETTINGS
========================================================= */

const CACHE_MS =
  Number(
    process.env.CACHE_MS ||
    55_000
  );

const OUTPUT_SIZE =
  Number(
    process.env.OUTPUT_SIZE ||
    1000
  );

const BASE_INTERVAL_MINUTES = 5;

const STALE_DATA_MS =
  Number(
    process.env.STALE_DATA_MS ||
    15 * 60_000
  );

const HTF_MIN_COMPLETENESS =
  Number(
    process.env.HTF_MIN_COMPLETENESS ||
    0.92
  );

/* =========================================================
   RISK SETTINGS
========================================================= */

const TP1_R =
  Number(
    process.env.TP1_R ||
    1.25
  );

const TP2_R =
  Number(
    process.env.TP2_R ||
    1.8
  );

const MIN_LIQUIDITY_ROOM_R =
  Number(
    process.env.MIN_LIQUIDITY_ROOM_R ||
    1.05
  );

const MAX_STOP_ATR =
  Number(
    process.env.MAX_STOP_ATR ||
    2.6
  );

const MAX_SWING_AGE_M5 =
  Number(
    process.env.MAX_SWING_AGE_M5 ||
    24
  );

const MAX_ENTRY_STRETCH_ATR =
  Number(
    process.env.MAX_ENTRY_STRETCH_ATR ||
    2.0
  );

/* =========================================================
   ENSEMBLE SETTINGS
========================================================= */

const MIN_ENSEMBLE_SCORE =
  Number(
    process.env.MIN_ENSEMBLE_SCORE ||
    64
  );

const MIN_ENSEMBLE_MARGIN =
  Number(
    process.env.MIN_ENSEMBLE_MARGIN ||
    30
  );

const MIN_ENSEMBLE_QUALITY =
  Number(
    process.env.MIN_ENSEMBLE_QUALITY ||
    55
  );

const MIN_MODULE_AGREEMENT =
  Number(
    process.env.MIN_MODULE_AGREEMENT ||
    55
  );

const ENSEMBLE_WEIGHTS =
  Object.freeze({
    trend: 27,
    structure: 23,
    liquidity: 22,
    momentum: 16,
    regime: 8,
    session: 4
  });

const ALLOWED_SYMBOLS =
  new Set([
    "XAU/USD",
    "EUR/USD",
    "GBP/USD",
    "USD/JPY",
    "BTC/USD",
    "XBR/USD"
  ]);

/* =========================================================
   CACHE
========================================================= */

const marketCache =
  new Map();

const inFlight =
  new Map();

/* =========================================================
   GENERIC UTILITIES
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

function priceDigits(
  symbol
) {
  if (
    symbol === "EUR/USD" ||
    symbol === "GBP/USD"
  ) {
    return 5;
  }

  if (
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
  } catch {
    return {};
  }
}

function mean(
  values
) {
  if (!values.length) {
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
  if (!values.length) {
    return null;
  }

  const avg =
    mean(values);

  const variance =
    values.reduce(
      (sum, value) =>
        sum +
        (
          value -
          avg
        ) ** 2,
      0
    ) /
    values.length;

  return Math.sqrt(
    variance
  );
}

/* =========================================================
   HTTP
========================================================= */

async function fetchJson(
  url,
  options = {},
  timeoutMs = 25_000
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
    clearTimeout(timer);
  }
}

/* =========================================================
   TWELVE DATA
========================================================= */

async function requestM5(
  symbol
) {
  if (
    !TWELVE_DATA_API_KEY
  ) {
    throw new Error(
      "TWELVE_DATA_API_KEY is missing."
    );
  }

  const params =
    new URLSearchParams({
      symbol,
      interval: "5min",
      outputsize:
        String(
          OUTPUT_SIZE
        ),
      timezone: "UTC",
      format: "JSON",
      apikey:
        TWELVE_DATA_API_KEY
    });

  const {
    response,
    data
  } =
    await fetchJson(
      `${TWELVE_URL}?${params.toString()}`,
      {},
      15_000
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
          ].every(
            Number.isFinite
          ) &&
          Number.isFinite(
            parseUTC(
              candle.t
            )
          )
      )
      .reverse();

  if (
    candles.length <
    240
  ) {
    throw new Error(
      "Not enough M5 candles returned."
    );
  }

  return candles;
}

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

  if (
    cached &&
    now -
      cached.time <
      CACHE_MS
  ) {
    return {
      candles:
        cached.candles,

      cacheHit: true
    };
  }

  if (
    inFlight.has(key)
  ) {
    return {
      candles:
        await inFlight.get(
          key
        ),

      cacheHit: true
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

  return {
    candles:
      await pending,

    cacheHit: false
  };
}

/* =========================================================
   DATA QUALITY
========================================================= */

function getCompletedM5(
  candles,
  nowMs = Date.now()
) {
  const barMs =
    BASE_INTERVAL_MINUTES *
    60_000;

  return candles.filter(
    candle => {
      const start =
        parseUTC(
          candle.t
        );

      if (
        !Number.isFinite(
          start
        )
      ) {
        return false;
      }

      return (
        start +
        barMs <=
        nowMs
      );
    }
  );
}

function marketDataAgeMs(
  candles
) {
  if (!candles.length) {
    return Infinity;
  }

  const latest =
    candles.at(-1);

  const start =
    parseUTC(
      latest.t
    );

  if (
    !Number.isFinite(
      start
    )
  ) {
    return Infinity;
  }

  const completedAt =
    start +
    BASE_INTERVAL_MINUTES *
      60_000;

  return Math.max(
    0,
    Date.now() -
      completedAt
  );
}

function buildDataQuality(
  raw,
  completed,
  m15,
  h1,
  h4
) {
  const ageMs =
    marketDataAgeMs(
      completed
    );

  const stale =
    ageMs >
    STALE_DATA_MS;

  const issues =
    [];

  if (
    raw.length < 240
  ) {
    issues.push(
      "Insufficient raw M5 history."
    );
  }

  if (
    completed.length < 200
  ) {
    issues.push(
      "Insufficient completed M5 history."
    );
  }

  if (
    m15.length < 60
  ) {
    issues.push(
      "Insufficient M15 history."
    );
  }

  if (
    h1.length < 30
  ) {
    issues.push(
      "Insufficient H1 history."
    );
  }

  if (
    h4.length < 8
  ) {
    issues.push(
      "Insufficient H4 history."
    );
  }

  if (stale) {
    issues.push(
      `Market data is stale by approximately ${round(
        ageMs /
          60_000,
        1
      )} minutes.`
    );
  }

  return {
    valid:
      issues.length ===
      0,

    stale,

    ageMs,

    ageMinutes:
      round(
        ageMs /
          60_000,
        1
      ),

    latestCompletedCandle:
      completed.at(-1)
        ?.t ||
      null,

    rawBars:
      raw.length,

    completedM5Bars:
      completed.length,

    m15Bars:
      m15.length,

    h1Bars:
      h1.length,

    h4Bars:
      h4.length,

    issues
  };
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

  const expectedBars =
    minutes /
    BASE_INTERVAL_MINUTES;

  const groups =
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
      !groups.has(
        bucket
      )
    ) {
      groups.set(
        bucket,
        []
      );
    }

    groups
      .get(bucket)
      .push(
        candle
      );
  }

  const result =
    [];

  for (
    const [
      timestamp,
      rawGroup
    ] of groups
  ) {
    const unique =
      new Map();

    for (
      const candle of
      rawGroup
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
      expectedBars;

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

    result.push({
      t:
        new Date(
          timestamp
        ).toISOString(),

      o:
        first.o,

      h:
        Math.max(
          ...group.map(
            item =>
              item.h
          )
        ),

      l:
        Math.min(
          ...group.map(
            item =>
              item.l
          )
        ),

      c:
        last.c,

      v:
        group.reduce(
          (
            sum,
            item
          ) =>
            sum +
            (
              item.v ||
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

  return result.sort(
    (a, b) =>
      parseUTC(a.t) -
      parseUTC(b.t)
  );
}

/* =========================================================
   MOVING AVERAGES
========================================================= */

function sma(
  values,
  period
) {
  if (
    values.length <
    period
  ) {
    return null;
  }

  const slice =
    values.slice(
      -period
    );

  return mean(
    slice
  );
}

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

  const output =
    Array(
      period -
      1
    ).fill(
      null
    );

  let current =
    seed;

  output.push(
    current
  );

  for (
    let index =
      period;

    index <
      values.length;

    index++
  ) {
    current =
      (
        values[
          index
        ] -
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

  let gainSum = 0;
  let lossSum = 0;

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
      gainSum +=
        change;
    } else {
      lossSum +=
        Math.abs(
          change
        );
    }
  }

  let avgGain =
    gainSum /
    period;

  let avgLoss =
    lossSum /
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
   TRUE RANGE / WILDER ATR
========================================================= */

function trueRanges(
  candles
) {
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
      candles[
        i - 1
      ];

    ranges.push(
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

  return ranges;
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

  const output =
    [];

  let smoothed =
    mean(
      values.slice(
        0,
        period
      )
    );

  output.push(
    smoothed
  );

  for (
    let i = period;
    i <
      values.length;
    i++
  ) {
    smoothed =
      (
        smoothed *
          (
            period -
            1
          ) +
        values[i]
      ) /
      period;

    output.push(
      smoothed
    );
  }

  return output;
}

function atrSeries(
  candles,
  period = 14,
  lookback = 160
) {
  if (
    candles.length <=
    period
  ) {
    return [];
  }

  const subset =
    candles.slice(
      -Math.max(
        lookback +
          period +
          5,
        period +
          2
      )
    );

  const trs =
    trueRanges(
      subset
    );

  return wilderSeries(
    trs,
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
      period,
      candles.length
    );

  return series.length
    ? series.at(-1)
    : null;
}

/* =========================================================
   WILDER ADX
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

    const upMove =
      current.h -
      previous.h;

    const downMove =
      previous.l -
      current.l;

    plusDM.push(
      upMove >
          downMove &&
        upMove > 0
        ? upMove
        : 0
    );

    minusDM.push(
      downMove >
          upMove &&
        downMove > 0
        ? downMove
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

  if (
    tr.length <
    period
  ) {
    return null;
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

  let smoothedPlusDM =
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

  let smoothedMinusDM =
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

  const dxValues =
    [];

  function pushDx() {
    if (
      smoothedTR <= 0
    ) {
      return;
    }

    const plusDI =
      100 *
      (
        smoothedPlusDM /
        smoothedTR
      );

    const minusDI =
      100 *
      (
        smoothedMinusDM /
        smoothedTR
      );

    const denominator =
      plusDI +
      minusDI;

    if (
      denominator <= 0
    ) {
      return;
    }

    dxValues.push(
      100 *
      Math.abs(
        plusDI -
        minusDI
      ) /
      denominator
    );
  }

  pushDx();

  for (
    let i = period;
    i <
      tr.length;
    i++
  ) {
    smoothedTR =
      smoothedTR -
      smoothedTR /
        period +
      tr[i];

    smoothedPlusDM =
      smoothedPlusDM -
      smoothedPlusDM /
        period +
      plusDM[i];

    smoothedMinusDM =
      smoothedMinusDM -
      smoothedMinusDM /
        period +
      minusDM[i];

    pushDx();
  }

  if (
    dxValues.length <
    period
  ) {
    return mean(
      dxValues
    );
  }

  let currentAdx =
    mean(
      dxValues.slice(
        0,
        period
      )
    );

  for (
    let i = period;
    i <
      dxValues.length;
    i++
  ) {
    currentAdx =
      (
        currentAdx *
          (
            period -
            1
          ) +
        dxValues[i]
      ) /
      period;
  }

  return currentAdx;
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

  const macdValues =
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

    macdValues.push(
      fast[i] -
      slow[i]
    );
  }

  if (
    macdValues.length <
    9
  ) {
    return {
      line: null,
      signal: null,
      histogram: null
    };
  }

  const line =
    macdValues.at(-1);

  const signal =
    ema(
      macdValues,
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
   BOLLINGER
========================================================= */

function bollingerMetrics(
  closes,
  period = 20,
  multiplier = 2
) {
  if (
    closes.length <
    period
  ) {
    return {
      middle: null,
      upper: null,
      lower: null,
      widthPct: null,
      position: null
    };
  }

  const window =
    closes.slice(
      -period
    );

  const middle =
    mean(
      window
    );

  const deviation =
    stdDev(
      window
    );

  const upper =
    middle +
    multiplier *
      deviation;

  const lower =
    middle -
    multiplier *
      deviation;

  const width =
    upper -
    lower;

  const price =
    closes.at(-1);

  return {
    middle,
    upper,
    lower,

    widthPct:
      middle
        ? (
            width /
            Math.abs(
              middle
            )
          ) *
          100
        : null,

    position:
      width > 0
        ? clamp(
            (
              price -
              lower
            ) /
              width,
            0,
            1
          )
        : 0.5
  };
}

/* =========================================================
   MOMENTUM HELPERS
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

  const oldPrice =
    closes.at(
      -(
        period +
        1
      )
    );

  const latest =
    closes.at(-1);

  if (
    !Number.isFinite(
      oldPrice
    ) ||
    oldPrice === 0 ||
    !Number.isFinite(
      latest
    )
  ) {
    return null;
  }

  return (
    (
      latest /
      oldPrice
    ) -
    1
  ) *
  100;
}

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
      value =>
        value <=
        current
    ).length;

  return (
    count /
    clean.length
  ) *
  100;
}

function normalizedEmaSlope(
  closes,
  candles,
  period = 20,
  bars = 5
) {
  const series =
    emaSeries(
      closes,
      period
    );

  if (
    !series.length ||
    series.length <=
      bars
  ) {
    return null;
  }

  const latest =
    series.at(-1);

  const earlier =
    series.at(
      -(
        bars +
        1
      )
    );

  const atr14 =
    atr(
      candles,
      14
    );

  if (
    !Number.isFinite(
      latest
    ) ||
    !Number.isFinite(
      earlier
    ) ||
    !Number.isFinite(
      atr14
    ) ||
    atr14 <= 0
  ) {
    return null;
  }

  return (
    latest -
    earlier
  ) /
  atr14;
}

function candleEfficiency(
  candles,
  bars = 10
) {
  const window =
    candles.slice(
      -bars
    );

  if (
    window.length <
    2
  ) {
    return null;
  }

  const net =
    Math.abs(
      window.at(-1).c -
      window[0].o
    );

  const path =
    window.reduce(
      (
        sum,
        candle
      ) =>
        sum +
        Math.abs(
          candle.c -
          candle.o
        ),
      0
    );

  if (!path) {
    return 0;
  }

  return clamp(
    net /
      path,
    0,
    1
  );
}

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

    const bodyRatio =
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
        bodyRatio;
    }

    if (
      candle.c <
      candle.o
    ) {
      bear +=
        bodyRatio;
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
   MARKET STRUCTURE
========================================================= */

function recentRange(
  candles,
  bars = 20
) {
  const window =
    candles.slice(
      -bars
    );

  return {
    high:
      window.length
        ? Math.max(
            ...window.map(
              candle =>
                candle.h
            )
          )
        : null,

    low:
      window.length
        ? Math.min(
            ...window.map(
              candle =>
                candle.l
            )
          )
        : null
  };
}

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
    const candle =
      candles[i];

    let isHigh = true;
    let isLow = true;

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
        candle.h
      ) {
        isHigh = false;
      }

      if (
        candles[j].l <=
        candle.l
      ) {
        isLow = false;
      }
    }

    if (isHigh) {
      highs.push({
        index: i,

        ageBars:
          candles.length -
          1 -
          i,

        price:
          candle.h,

        t:
          candle.t
      });
    }

    if (isLow) {
      lows.push({
        index: i,

        ageBars:
          candles.length -
          1 -
          i,

        price:
          candle.l,

        t:
          candle.t
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

  const previousHigh =
    swings.highs.at(-1);

  const previousLow =
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
    previousHigh &&
    close >
      previousHigh.price
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
    previousLow &&
    close <
      previousLow.price
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
   LIQUIDITY SWEEP
========================================================= */

function detectLiquiditySweep(
  candles,
  lookback = 20
) {
  if (
    candles.length <
    lookback +
      2
  ) {
    return {
      type: "NONE",
      level: null
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

  const priorHigh =
    Math.max(
      ...prior.map(
        candle =>
          candle.h
      )
    );

  const priorLow =
    Math.min(
      ...prior.map(
        candle =>
          candle.l
      )
    );

  if (
    last.h >
      priorHigh &&
    last.c <
      priorHigh
  ) {
    return {
      type:
        "BEARISH_BUYSIDE_SWEEP",

      level:
        priorHigh
    };
  }

  if (
    last.l <
      priorLow &&
    last.c >
      priorLow
  ) {
    return {
      type:
        "BULLISH_SELLSIDE_SWEEP",

      level:
        priorLow
    };
  }

  return {
    type: "NONE",
    level: null
  };
}

/* =========================================================
   EQUAL HIGHS / LOWS
========================================================= */

function detectEqualLevels(
  candles,
  atrValue,
  lookback = 50
) {
  const subset =
    candles.slice(
      -lookback
    );

  const swings =
    findSwings(
      subset,
      2,
      2
    );

  const latestPrice =
    candles.at(-1)?.c ||
    0;

  const tolerance =
    Math.max(
      (
        atrValue ||
        0
      ) *
        0.18,

      Math.abs(
        latestPrice
      ) *
        0.00008
    );

  let equalHigh =
    null;

  let equalLow =
    null;

  for (
    let i =
      swings.highs.length -
      1;

    i > 0;

    i--
  ) {
    const first =
      swings.highs[
        i
      ];

    const second =
      swings.highs[
        i -
        1
      ];

    if (
      Math.abs(
        first.price -
        second.price
      ) <=
      tolerance
    ) {
      equalHigh =
        (
          first.price +
          second.price
        ) /
        2;

      break;
    }
  }

  for (
    let i =
      swings.lows.length -
      1;

    i > 0;

    i--
  ) {
    const first =
      swings.lows[
        i
      ];

    const second =
      swings.lows[
        i -
        1
      ];

    if (
      Math.abs(
        first.price -
        second.price
      ) <=
      tolerance
    ) {
      equalLow =
        (
          first.price +
          second.price
        ) /
        2;

      break;
    }
  }

  return {
    equalHigh,
    equalLow
  };
}

/* =========================================================
   FVG LIFECYCLE
========================================================= */

function detectFVG(
  candles,
  lookback = 50
) {
  const start =
    Math.max(
      2,
      candles.length -
      lookback
    );

  const bullishCandidates =
    [];

  const bearishCandidates =
    [];

  for (
    let i = start;
    i <
      candles.length;
    i++
  ) {
    const first =
      candles[
        i -
        2
      ];

    const third =
      candles[i];

    if (
      third.l >
      first.h
    ) {
      bullishCandidates.push({
        index: i,

        low:
          first.h,

        high:
          third.l,

        t:
          third.t
      });
    }

    if (
      third.h <
      first.l
    ) {
      bearishCandidates.push({
        index: i,

        low:
          third.h,

        high:
          first.l,

        t:
          third.t
      });
    }
  }

  function validateBullish(
    gap
  ) {
    const size =
      gap.high -
      gap.low;

    if (
      size <= 0
    ) {
      return null;
    }

    let lowest =
      Infinity;

    for (
      let i =
        gap.index +
        1;

      i <
        candles.length;

      i++
    ) {
      lowest =
        Math.min(
          lowest,
          candles[i].l
        );
    }

    if (
      lowest <=
      gap.low
    ) {
      return null;
    }

    let fillPct = 0;

    if (
      lowest <
      gap.high
    ) {
      fillPct =
        clamp(
          (
            gap.high -
            lowest
          ) /
            size,
          0,
          1
        );
    }

    return {
      ...gap,

      fillPct,

      status:
        fillPct > 0
          ? "PARTIALLY_MITIGATED"
          : "OPEN"
    };
  }

  function validateBearish(
    gap
  ) {
    const size =
      gap.high -
      gap.low;

    if (
      size <= 0
    ) {
      return null;
    }

    let highest =
      -Infinity;

    for (
      let i =
        gap.index +
        1;

      i <
        candles.length;

      i++
    ) {
      highest =
        Math.max(
          highest,
          candles[i].h
        );
    }

    if (
      highest >=
      gap.high
    ) {
      return null;
    }

    let fillPct = 0;

    if (
      highest >
      gap.low
    ) {
      fillPct =
        clamp(
          (
            highest -
            gap.low
          ) /
            size,
          0,
          1
        );
    }

    return {
      ...gap,

      fillPct,

      status:
        fillPct > 0
          ? "PARTIALLY_MITIGATED"
          : "OPEN"
    };
  }

  let bullish =
    null;

  for (
    let i =
      bullishCandidates.length -
      1;

    i >= 0;

    i--
  ) {
    bullish =
      validateBullish(
        bullishCandidates[i]
      );

    if (bullish) {
      break;
    }
  }

  let bearish =
    null;

  for (
    let i =
      bearishCandidates.length -
      1;

    i >= 0;

    i--
  ) {
    bearish =
      validateBearish(
        bearishCandidates[i]
      );

    if (bearish) {
      break;
    }
  }

  return {
    bullish,
    bearish
  };
}

/* =========================================================
   ORDER BLOCK
========================================================= */

function detectOrderBlock(
  candles,
  bos
) {
  if (
    bos === "NONE"
  ) {
    return null;
  }

  const bullishBos =
    bos ===
    "BULLISH_BOS";

  const bearishBos =
    bos ===
    "BEARISH_BOS";

  for (
    let i =
      candles.length -
      2;

    i >=
      Math.max(
        0,
        candles.length -
          18
      );

    i--
  ) {
    const candle =
      candles[i];

    if (
      bullishBos &&
      candle.c <
      candle.o
    ) {
      let invalidated =
        false;

      for (
        let j =
          i +
          1;

        j <
          candles.length;

        j++
      ) {
        if (
          candles[j].c <
          candle.l
        ) {
          invalidated =
            true;

          break;
        }
      }

      if (
        !invalidated
      ) {
        return {
          type:
            "BULLISH_OB",

          low:
            candle.l,

          high:
            candle.h,

          t:
            candle.t,

          ageBars:
            candles.length -
            1 -
            i
        };
      }
    }

    if (
      bearishBos &&
      candle.c >
      candle.o
    ) {
      let invalidated =
        false;

      for (
        let j =
          i +
          1;

        j <
          candles.length;

        j++
      ) {
        if (
          candles[j].c >
          candle.h
        ) {
          invalidated =
            true;

          break;
        }
      }

      if (
        !invalidated
      ) {
        return {
          type:
            "BEARISH_OB",

          low:
            candle.l,

          high:
            candle.h,

          t:
            candle.t,

          ageBars:
            candles.length -
            1 -
            i
        };
      }
    }
  }

  return null;
}

/* =========================================================
   PREMIUM / DISCOUNT
========================================================= */

function premiumDiscount(
  candles,
  bars = 40
) {
  const range =
    recentRange(
      candles,
      bars
    );

  const price =
    candles.at(-1).c;

  if (
    range.high == null ||
    range.low == null
  ) {
    return {
      zone:
        "UNKNOWN",

      midpoint:
        null
    };
  }

  const midpoint =
    (
      range.high +
      range.low
    ) /
    2;

  return {
    zone:
      price >
      midpoint
        ? "PREMIUM"
        : price <
          midpoint
          ? "DISCOUNT"
          : "EQUILIBRIUM",

    midpoint
  };
}

/* =========================================================
   TREND BIAS
========================================================= */

function trendBias(
  closes
) {
  const price =
    closes.at(-1);

  if (
    !Number.isFinite(
      price
    ) ||
    closes.length <
      20
  ) {
    return "NEUTRAL";
  }

  const fastPeriod =
    closes.length >=
      50
      ? 20
      : 8;

  const slowPeriod =
    closes.length >=
      50
      ? 50
      : 20;

  const fast =
    ema(
      closes,
      fastPeriod
    );

  const slow =
    ema(
      closes,
      slowPeriod
    );

  const ema200 =
    closes.length >=
      200
      ? ema(
          closes,
          200
        )
      : null;

  if (
    fast == null ||
    slow == null
  ) {
    return "NEUTRAL";
  }

  if (
    price >
      fast &&
    fast >
      slow &&
    (
      ema200 == null ||
      slow >
        ema200
    )
  ) {
    return "BULLISH";
  }

  if (
    price <
      fast &&
    fast <
      slow &&
    (
      ema200 == null ||
      slow <
        ema200
    )
  ) {
    return "BEARISH";
  }

  return "NEUTRAL";
}

/* =========================================================
   SNAPSHOT
========================================================= */

function snapshot(
  symbol,
  candles
) {
  const closes =
    candles.map(
      candle =>
        candle.c
    );

  const atr14 =
    atr(
      candles,
      14
    );

  const swings =
    findSwings(
      candles,
      2,
      2
    );

  const event =
    detectBosChoch(
      candles,
      swings
    );

  const fvg =
    detectFVG(
      candles
    );

  const sweep =
    detectLiquiditySweep(
      candles
    );

  const equalLevels =
    detectEqualLevels(
      candles,
      atr14
    );

  const pd =
    premiumDiscount(
      candles
    );

  const range =
    recentRange(
      candles,
      30
    );

  const macdData =
    macd(
      closes
    );

  const bollinger =
    bollingerMetrics(
      closes,
      20,
      2
    );

  const atrHistory =
    atrSeries(
      candles,
      14,
      160
    );

  const atrPercentile =
    percentileRank(
      atrHistory,
      atr14
    );

  const slope20 =
    normalizedEmaSlope(
      closes,
      candles,
      20,
      5
    );

  const efficiency =
    candleEfficiency(
      candles,
      10
    );

  const roc10 =
    roc(
      closes,
      10
    );

  const ob =
    detectOrderBlock(
      candles,
      event.bos
    );

  const latestHigh =
    swings.highs.at(-1);

  const latestLow =
    swings.lows.at(-1);

  return {
    price:
      priceRound(
        symbol,
        closes.at(-1)
      ),

    bias:
      trendBias(
        closes
      ),

    structure:
      event.structure,

    momentum:
      candleMomentum(
        candles
      ),

    indicators: {
      ema20:
        priceRound(
          symbol,
          ema(
            closes,
            20
          )
        ),

      ema50:
        priceRound(
          symbol,
          ema(
            closes,
            50
          )
        ),

      ema200:
        priceRound(
          symbol,
          ema(
            closes,
            200
          )
        ),

      rsi14:
        round(
          rsi(
            closes,
            14
          ),
          1
        ),

      atr14:
        priceRound(
          symbol,
          atr14
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
        ),

      bollingerMiddle:
        priceRound(
          symbol,
          bollinger.middle
        ),

      bollingerUpper:
        priceRound(
          symbol,
          bollinger.upper
        ),

      bollingerLower:
        priceRound(
          symbol,
          bollinger.lower
        ),

      bollingerWidthPct:
        round(
          bollinger.widthPct,
          4
        ),

      bollingerPosition:
        round(
          bollinger.position,
          3
        ),

      atrPercentile:
        round(
          atrPercentile,
          1
        ),

      ema20SlopeAtr:
        round(
          slope20,
          3
        ),

      roc10:
        round(
          roc10,
          4
        ),

      candleEfficiency:
        round(
          efficiency,
          3
        )
    },

    ict: {
      bos:
        event.bos,

      choch:
        event.choch,

      sweep: {
        type:
          sweep.type,

        level:
          priceRound(
            symbol,
            sweep.level
          )
      },

      equalHigh:
        priceRound(
          symbol,
          equalLevels.equalHigh
        ),

      equalLow:
        priceRound(
          symbol,
          equalLevels.equalLow
        ),

      bullishFVG:
        fvg.bullish
          ? {
              low:
                priceRound(
                  symbol,
                  fvg.bullish.low
                ),

              high:
                priceRound(
                  symbol,
                  fvg.bullish.high
                ),

              status:
                fvg.bullish.status,

              fillPct:
                round(
                  fvg.bullish.fillPct *
                    100,
                  1
                )
            }
          : null,

      bearishFVG:
        fvg.bearish
          ? {
              low:
                priceRound(
                  symbol,
                  fvg.bearish.low
                ),

              high:
                priceRound(
                  symbol,
                  fvg.bearish.high
                ),

              status:
                fvg.bearish.status,

              fillPct:
                round(
                  fvg.bearish.fillPct *
                    100,
                  1
                )
            }
          : null,

      orderBlock:
        ob
          ? {
              type:
                ob.type,

              low:
                priceRound(
                  symbol,
                  ob.low
                ),

              high:
                priceRound(
                  symbol,
                  ob.high
                ),

              ageBars:
                ob.ageBars
            }
          : null,

      premiumDiscount:
        pd.zone,

      midpoint:
        priceRound(
          symbol,
          pd.midpoint
        ),

      lastSwingHigh:
        priceRound(
          symbol,
          latestHigh?.price
        ),

      lastSwingHighAge:
        latestHigh
          ?.ageBars ??
        null,

      lastSwingLow:
        priceRound(
          symbol,
          latestLow?.price
        ),

      lastSwingLowAge:
        latestLow
          ?.ageBars ??
        null
    },

    range: {
      high:
        priceRound(
          symbol,
          range.high
        ),

      low:
        priceRound(
          symbol,
          range.low
        )
    },

    candles:
      candles
        .slice(-16)
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
        )
  };
}

/* =========================================================
   SESSION ENGINE
========================================================= */

function sessionNameAtUtcHour(
  hour
) {
  if (
    hour < 7
  ) {
    return "ASIA";
  }

  if (
    hour < 12
  ) {
    return "LONDON";
  }

  if (
    hour < 16
  ) {
    return "LONDON_NEW_YORK_OVERLAP";
  }

  if (
    hour < 21
  ) {
    return "NEW_YORK";
  }

  return "TRANSITION";
}

function sessionFromCandles(
  candles
) {
  const timestamp =
    parseUTC(
      candles.at(-1)?.t
    );

  if (
    !Number.isFinite(
      timestamp
    )
  ) {
    return "UNKNOWN";
  }

  return sessionNameAtUtcHour(
    new Date(
      timestamp
    ).getUTCHours()
  );
}

/* =========================================================
   DAY LEVELS
========================================================= */

function utcDateKey(
  datetime
) {
  const ms =
    parseUTC(
      datetime
    );

  if (
    !Number.isFinite(
      ms
    )
  ) {
    return null;
  }

  return new Date(
    ms
  )
    .toISOString()
    .slice(
      0,
      10
    );
}

function buildDayLevels(
  candles
) {
  const groups =
    new Map();

  for (
    const candle of
    candles.slice(-700)
  ) {
    const key =
      utcDateKey(
        candle.t
      );

    if (!key) {
      continue;
    }

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

  if (
    !keys.length
  ) {
    return {
      currentDay:
        null,

      previousDay:
        null
    };
  }

  const make =
    key => {
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

      group.sort(
        (a, b) =>
          parseUTC(a.t) -
          parseUTC(b.t)
      );

      return {
        date: key,

        open:
          group[0].o,

        high:
          Math.max(
            ...group.map(
              candle =>
                candle.h
            )
          ),

        low:
          Math.min(
            ...group.map(
              candle =>
                candle.l
            )
          ),

        close:
          group.at(-1).c
      };
    };

  const currentKey =
    keys.at(-1);

  const previousKey =
    keys.length >=
      2
      ? keys.at(-2)
      : null;

  return {
    currentDay:
      make(
        currentKey
      ),

    previousDay:
      previousKey
        ? make(
            previousKey
          )
        : null
  };
}

/* =========================================================
   SESSION LEVELS
========================================================= */

function buildCurrentSessionLevels(
  candles
) {
  if (
    !candles.length
  ) {
    return null;
  }

  const latest =
    candles.at(-1);

  const latestMs =
    parseUTC(
      latest.t
    );

  if (
    !Number.isFinite(
      latestMs
    )
  ) {
    return null;
  }

  const session =
    sessionNameAtUtcHour(
      new Date(
        latestMs
      ).getUTCHours()
    );

  const group =
    [];

  for (
    let i =
      candles.length -
      1;

    i >= 0;

    i--
  ) {
    const ms =
      parseUTC(
        candles[i].t
      );

    if (
      !Number.isFinite(
        ms
      )
    ) {
      continue;
    }

    const name =
      sessionNameAtUtcHour(
        new Date(
          ms
        ).getUTCHours()
      );

    if (
      name !==
      session
    ) {
      break;
    }

    group.push(
      candles[i]
    );
  }

  if (
    !group.length
  ) {
    return null;
  }

  group.reverse();

  return {
    session,

    open:
      group[0].o,

    high:
      Math.max(
        ...group.map(
          candle =>
            candle.h
        )
      ),

    low:
      Math.min(
        ...group.map(
          candle =>
            candle.l
        )
      ),

    close:
      group.at(-1).c,

    bars:
      group.length
  };
}

/* =========================================================
   LIQUIDITY MAP
========================================================= */

function buildLiquidityMap(
  symbol,
  packet,
  m5Candles
) {
  const price =
    Number(
      packet.currentPrice
    );

  const atr5 =
    Math.max(
      Number(
        packet.M5
          .indicators
          .atr14 ||
        0
      ),

      Math.abs(
        price
      ) *
        0.0001
    );

  const tolerance =
    Math.max(
      atr5 *
        0.10,

      Math.abs(
        price
      ) *
        0.00004
    );

  const day =
    buildDayLevels(
      m5Candles
    );

  const session =
    buildCurrentSessionLevels(
      m5Candles
    );

  const rawPools =
    [];

  const addPool =
    (
      value,
      label,
      source,
      kind
    ) => {
      const n =
        Number(
          value
        );

      if (
        !Number.isFinite(
          n
        ) ||
        !Number.isFinite(
          price
        ) ||
        n === price
      ) {
        return;
      }

      rawPools.push({
        price: n,
        label,
        source,
        kind,

        side:
          n >
          price
            ? "BUY_SIDE"
            : "SELL_SIDE",

        distance:
          Math.abs(
            n -
            price
          ),

        distanceAtr:
          atr5 > 0
            ? Math.abs(
                n -
                price
              ) /
              atr5
            : null
      });
    };

  addPool(
    packet.M5.ict
      .equalHigh,
    "M5 equal high",
    "M5",
    "EQUAL_HIGH"
  );

  addPool(
    packet.M5.ict
      .equalLow,
    "M5 equal low",
    "M5",
    "EQUAL_LOW"
  );

  addPool(
    packet.M15.ict
      .equalHigh,
    "M15 equal high",
    "M15",
    "EQUAL_HIGH"
  );

  addPool(
    packet.M15.ict
      .equalLow,
    "M15 equal low",
    "M15",
    "EQUAL_LOW"
  );

  addPool(
    packet.M5.ict
      .lastSwingHigh,
    "M5 swing high",
    "M5",
    "SWING_HIGH"
  );

  addPool(
    packet.M5.ict
      .lastSwingLow,
    "M5 swing low",
    "M5",
    "SWING_LOW"
  );

  addPool(
    packet.M15.ict
      .lastSwingHigh,
    "M15 swing high",
    "M15",
    "SWING_HIGH"
  );

  addPool(
    packet.M15.ict
      .lastSwingLow,
    "M15 swing low",
    "M15",
    "SWING_LOW"
  );

  addPool(
    packet.H1.ict
      .lastSwingHigh,
    "H1 swing high",
    "H1",
    "SWING_HIGH"
  );

  addPool(
    packet.H1.ict
      .lastSwingLow,
    "H1 swing low",
    "H1",
    "SWING_LOW"
  );

  addPool(
    packet.M15.range
      .high,
    "M15 range high",
    "M15",
    "RANGE_HIGH"
  );

  addPool(
    packet.M15.range
      .low,
    "M15 range low",
    "M15",
    "RANGE_LOW"
  );

  addPool(
    packet.H1.range
      .high,
    "H1 range high",
    "H1",
    "RANGE_HIGH"
  );

  addPool(
    packet.H1.range
      .low,
    "H1 range low",
    "H1",
    "RANGE_LOW"
  );

  if (
    day.previousDay
  ) {
    addPool(
      day.previousDay
        .high,
      "Previous day high",
      "DAILY",
      "PDH"
    );

    addPool(
      day.previousDay
        .low,
      "Previous day low",
      "DAILY",
      "PDL"
    );
  }

  if (
    day.currentDay
  ) {
    addPool(
      day.currentDay
        .high,
      "Current day high",
      "DAILY",
      "CDH"
    );

    addPool(
      day.currentDay
        .low,
      "Current day low",
      "DAILY",
      "CDL"
    );
  }

  if (session) {
    addPool(
      session.high,
      `${session.session} high`,
      "SESSION",
      "SESSION_HIGH"
    );

    addPool(
      session.low,
      `${session.session} low`,
      "SESSION",
      "SESSION_LOW"
    );
  }

  rawPools.sort(
    (a, b) =>
      a.distance -
      b.distance
  );

  const pools =
    [];

  for (
    const pool of
    rawPools
  ) {
    const duplicate =
      pools.some(
        existing =>
          existing.side ===
            pool.side &&
          Math.abs(
            existing.price -
            pool.price
          ) <=
            tolerance
      );

    if (
      duplicate
    ) {
      continue;
    }

    pools.push({
      ...pool,

      price:
        priceRound(
          symbol,
          pool.price
        ),

      distance:
        priceRound(
          symbol,
          pool.distance
        ),

      distanceAtr:
        round(
          pool.distanceAtr,
          2
        )
    });
  }

  const buySide =
    pools
      .filter(
        pool =>
          pool.side ===
          "BUY_SIDE"
      )
      .sort(
        (a, b) =>
          a.distance -
          b.distance
      );

  const sellSide =
    pools
      .filter(
        pool =>
          pool.side ===
          "SELL_SIDE"
      )
      .sort(
        (a, b) =>
          a.distance -
          b.distance
      );

  return {
    currentPrice:
      priceRound(
        symbol,
        price
      ),

    atr5:
      priceRound(
        symbol,
        atr5
      ),

    nearestBuySide:
      buySide[0] ||
      null,

    nearestSellSide:
      sellSide[0] ||
      null,

    buySidePools:
      buySide.slice(
        0,
        6
      ),

    sellSidePools:
      sellSide.slice(
        0,
        6
      ),

    pools:
      pools.slice(
        0,
        14
      ),

    previousDay:
      day.previousDay
        ? {
            high:
              priceRound(
                symbol,
                day.previousDay
                  .high
              ),

            low:
              priceRound(
                symbol,
                day.previousDay
                  .low
              ),

            close:
              priceRound(
                symbol,
                day.previousDay
                  .close
              )
          }
        : null,

    currentDay:
      day.currentDay
        ? {
            open:
              priceRound(
                symbol,
                day.currentDay
                  .open
              ),

            high:
              priceRound(
                symbol,
                day.currentDay
                  .high
              ),

            low:
              priceRound(
                symbol,
                day.currentDay
                  .low
              )
          }
        : null,

    currentSession:
      session
        ? {
            name:
              session.session,

            open:
              priceRound(
                symbol,
                session.open
              ),

            high:
              priceRound(
                symbol,
                session.high
              ),

            low:
              priceRound(
                symbol,
                session.low
              ),

            bars:
              session.bars
          }
        : null,

    sweep: {
      M5:
        packet.M5.ict
          .sweep,

      M15:
        packet.M15.ict
          .sweep
    },

    zones: {
      M5BullishFVG:
        packet.M5.ict
          .bullishFVG,

      M5BearishFVG:
        packet.M5.ict
          .bearishFVG,

      M15BullishFVG:
        packet.M15.ict
          .bullishFVG,

      M15BearishFVG:
        packet.M15.ict
          .bearishFVG,

      M5OrderBlock:
        packet.M5.ict
          .orderBlock,

      M15OrderBlock:
        packet.M15.ict
          .orderBlock
    }
  };
}

/* =========================================================
   REGIME ENGINE
========================================================= */

function detectRegimeDetails(
  packet
) {
  const adxValue =
    Number(
      packet.M15
        .indicators
        .adx14 ||
      0
    );

  const atrValue =
    Number(
      packet.M15
        .indicators
        .atr14 ||
      0
    );

  const atrPercentile =
    Number(
      packet.M15
        .indicators
        .atrPercentile ??
      50
    );

  const bbWidth =
    Number(
      packet.M15
        .indicators
        .bollingerWidthPct ||
      0
    );

  const range =
    Number(
      packet.M15
        .range
        .high
    ) -
    Number(
      packet.M15
        .range
        .low
    );

  const rangeAtr =
    atrValue > 0
      ? range /
        atrValue
      : null;

  const h1 =
    packet.H1.bias;

  const m15 =
    packet.M15.bias;

  const m5 =
    packet.M5.bias;

  const alignedBull =
    h1 ===
      "BULLISH" &&
    m15 ===
      "BULLISH";

  const alignedBear =
    h1 ===
      "BEARISH" &&
    m15 ===
      "BEARISH";

  const hardConflict =
    (
      h1 ===
        "BULLISH" &&
      m15 ===
        "BEARISH"
    ) ||
    (
      h1 ===
        "BEARISH" &&
      m15 ===
        "BULLISH"
    );

  const bos =
    packet.M15.ict
      .bos;

  let name =
    "MIXED";

  let quality =
    55;

  let trend =
    "NEUTRAL";

  let volatility =
    "NORMAL";

  const notes =
    [];

  if (
    atrPercentile >=
    85
  ) {
    volatility =
      "EXTREME";
  } else if (
    atrPercentile >=
    65
  ) {
    volatility =
      "HIGH";
  } else if (
    atrPercentile <=
    25
  ) {
    volatility =
      "LOW";
  }

  if (
    alignedBull &&
    adxValue >=
      24
  ) {
    name =
      "TRENDING_BULLISH";

    trend =
      "BULLISH";

    quality =
      clamp(
        Math.round(
          68 +
          (
            adxValue -
            24
          ) *
            1.1
        ),
        68,
        92
      );

    notes.push(
      "H1 and M15 bullish with ADX confirmation."
    );
  }

  if (
    alignedBear &&
    adxValue >=
      24
  ) {
    name =
      "TRENDING_BEARISH";

    trend =
      "BEARISH";

    quality =
      clamp(
        Math.round(
          68 +
          (
            adxValue -
            24
          ) *
            1.1
        ),
        68,
        92
      );

    notes.push(
      "H1 and M15 bearish with ADX confirmation."
    );
  }

  if (
    bos ===
      "BULLISH_BOS" &&
    h1 !==
      "BEARISH" &&
    adxValue >=
      19 &&
    atrPercentile >=
      45
  ) {
    name =
      "BREAKOUT_BULLISH";

    trend =
      "BULLISH";

    quality =
      clamp(
        Math.round(
          72 +
          (
            adxValue -
            19
          ) *
            0.8
        ),
        72,
        92
      );

    notes.push(
      "M15 bullish BOS with volatility expansion."
    );
  } else if (
    bos ===
      "BEARISH_BOS" &&
    h1 !==
      "BULLISH" &&
    adxValue >=
      19 &&
    atrPercentile >=
      45
  ) {
    name =
      "BREAKOUT_BEARISH";

    trend =
      "BEARISH";

    quality =
      clamp(
        Math.round(
          72 +
          (
            adxValue -
            19
          ) *
            0.8
        ),
        72,
        92
      );

    notes.push(
      "M15 bearish BOS with volatility expansion."
    );
  } else if (
    adxValue <
      17 &&
    Number.isFinite(
      rangeAtr
    ) &&
    rangeAtr <=
      5.2
  ) {
    name =
      "COMPRESSION";

    trend =
      "NEUTRAL";

    quality =
      38;

    notes.push(
      "Low ADX and compressed M15 range."
    );
  } else if (
    adxValue <
      19 &&
    name ===
      "MIXED"
  ) {
    name =
      "RANGE";

    trend =
      "NEUTRAL";

    quality =
      44;

    notes.push(
      "Weak directional strength."
    );
  }

  if (
    atrPercentile >=
      90 &&
    hardConflict
  ) {
    name =
      "HIGH_VOLATILITY_CHOP";

    trend =
      "NEUTRAL";

    quality =
      25;

    notes.push(
      "Extreme volatility and H1/M15 conflict."
    );
  }

  if (
    hardConflict &&
    name ===
      "MIXED"
  ) {
    name =
      "REVERSAL_RISK";

    quality =
      40;

    notes.push(
      "H1 and M15 direction conflict."
    );
  }

  if (
    m5 !==
      "NEUTRAL" &&
    m15 !==
      "NEUTRAL" &&
    m5 !==
      m15
  ) {
    quality =
      Math.max(
        20,
        quality -
          6
      );

    notes.push(
      "M5 is counter to M15."
    );
  }

  return {
    name,
    trend,

    quality:
      clamp(
        Math.round(
          quality
        ),
        0,
        100
      ),

    volatility,

    volatilityPercentile:
      round(
        atrPercentile,
        1
      ),

    adx:
      round(
        adxValue,
        1
      ),

    rangeAtr:
      round(
        rangeAtr,
        2
      ),

    bollingerWidthPct:
      round(
        bbWidth,
        4
      ),

    hardConflict,
    notes
  };
}

/* =========================================================
   ENSEMBLE MODULE HELPERS
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

function moduleResult(
  name,
  signal,
  reliability,
  reasons = []
) {
  const normalizedSignal =
    clamp(
      Math.round(
        signal
      ),
      -100,
      100
    );

  const normalizedReliability =
    clamp(
      Math.round(
        reliability
      ),
      0,
      100
    );

  return {
    name,

    signal:
      normalizedSignal,

    reliability:
      normalizedReliability,

    bias:
      normalizedSignal >=
        12
        ? "BULLISH"
        : normalizedSignal <=
            -12
          ? "BEARISH"
          : "NEUTRAL",

    strength:
      clamp(
        Math.round(
          50 +
          Math.abs(
            normalizedSignal
          ) *
            0.5
        ),
        50,
        100
      ),

    /* Compatibility field.
       This is not a win probability. */
    confidence:
      clamp(
        Math.round(
          50 +
          Math.abs(
            normalizedSignal
          ) *
            0.5
        ),
        50,
        100
      ),

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
      packet.H4.bias
    ) *
      27 +

    biasSign(
      packet.H1.bias
    ) *
      32 +

    biasSign(
      packet.M15.bias
    ) *
      26 +

    biasSign(
      packet.M5.bias
    ) *
      15;

  const slopeH1 =
    Number(
      packet.H1
        .indicators
        .ema20SlopeAtr ||
      0
    );

  const slopeM15 =
    Number(
      packet.M15
        .indicators
        .ema20SlopeAtr ||
      0
    );

  signal +=
    clamp(
      slopeH1 *
        9,
      -9,
      9
    );

  signal +=
    clamp(
      slopeM15 *
        7,
      -7,
      7
    );

  return moduleResult(
    "trend",
    clamp(
      signal,
      -100,
      100
    ),

    54 +
      Math.abs(
        signal
      ) *
        0.38,

    [
      `H4 ${packet.H4.bias}`,
      `H1 ${packet.H1.bias}`,
      `M15 ${packet.M15.bias}`,
      `M5 ${packet.M5.bias}`
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
      packet.H1
        .structure
    ) *
      28;

  signal +=
    biasSign(
      packet.M15
        .structure
    ) *
      24;

  signal +=
    biasSign(
      packet.M15
        .ict
        .bos
    ) *
      20;

  signal +=
    biasSign(
      packet.M15
        .ict
        .choch
    ) *
      14;

  signal +=
    biasSign(
      packet.M5
        .ict
        .bos
    ) *
      9;

  signal +=
    biasSign(
      packet.M5
        .ict
        .choch
    ) *
      5;

  return moduleResult(
    "structure",
    signal,

    46 +
      Math.abs(
        signal
      ) *
        0.47,

    [
      `H1 ${packet.H1.structure}`,
      `M15 ${packet.M15.structure}`,
      `M15 ${packet.M15.ict.bos}`,
      `M15 ${packet.M15.ict.choch}`
    ]
  );
}

/* =========================================================
   LIQUIDITY MODULE
========================================================= */

function liquidityModule(
  packet
) {
  let signal = 0;

  const reasons =
    [];

  if (
    packet.M5.ict
      .sweep.type ===
    "BULLISH_SELLSIDE_SWEEP"
  ) {
    signal += 35;

    reasons.push(
      "M5 sell-side sweep reclaimed."
    );
  }

  if (
    packet.M5.ict
      .sweep.type ===
    "BEARISH_BUYSIDE_SWEEP"
  ) {
    signal -= 35;

    reasons.push(
      "M5 buy-side sweep rejected."
    );
  }

  if (
    packet.M15.ict
      .sweep.type ===
    "BULLISH_SELLSIDE_SWEEP"
  ) {
    signal += 24;

    reasons.push(
      "M15 sell-side sweep reclaimed."
    );
  }

  if (
    packet.M15.ict
      .sweep.type ===
    "BEARISH_BUYSIDE_SWEEP"
  ) {
    signal -= 24;

    reasons.push(
      "M15 buy-side sweep rejected."
    );
  }

  if (
    packet.M15.ict
      .premiumDiscount ===
    "DISCOUNT"
  ) {
    signal += 13;

    reasons.push(
      "M15 in discount."
    );
  }

  if (
    packet.M15.ict
      .premiumDiscount ===
    "PREMIUM"
  ) {
    signal -= 13;

    reasons.push(
      "M15 in premium."
    );
  }

  if (
    packet.M15.ict
      .bullishFVG
  ) {
    const fill =
      Number(
        packet.M15
          .ict
          .bullishFVG
          .fillPct ||
        0
      );

    signal +=
      fill < 70
        ? 8
        : 3;
  }

  if (
    packet.M15.ict
      .bearishFVG
  ) {
    const fill =
      Number(
        packet.M15
          .ict
          .bearishFVG
          .fillPct ||
        0
      );

    signal -=
      fill < 70
        ? 8
        : 3;
  }

  if (
    packet.M15.ict
      .orderBlock
      ?.type ===
    "BULLISH_OB"
  ) {
    signal += 9;
  }

  if (
    packet.M15.ict
      .orderBlock
      ?.type ===
    "BEARISH_OB"
  ) {
    signal -= 9;
  }

  const map =
    packet.liquidityMap;

  if (
    map?.nearestBuySide &&
    map?.nearestSellSide
  ) {
    const upside =
      Number(
        map
          .nearestBuySide
          .distanceAtr
      );

    const downside =
      Number(
        map
          .nearestSellSide
          .distanceAtr
      );

    if (
      Number.isFinite(
        upside
      ) &&
      Number.isFinite(
        downside
      )
    ) {
      if (
        upside >=
          1.4 &&
        downside <=
          0.8
      ) {
        signal += 5;

        reasons.push(
          "More clean liquidity room above."
        );
      }

      if (
        downside >=
          1.4 &&
        upside <=
          0.8
      ) {
        signal -= 5;

        reasons.push(
          "More clean liquidity room below."
        );
      }
    }
  }

  return moduleResult(
    "liquidity",
    signal,

    44 +
      Math.abs(
        signal
      ) *
        0.5,

    reasons
  );
}

/* =========================================================
   MOMENTUM MODULE
========================================================= */

function momentumModule(
  packet
) {
  let signal = 0;

  const reasons =
    [];

  signal +=
    biasSign(
      packet.M5.momentum
    ) *
      26;

  signal +=
    biasSign(
      packet.M15.momentum
    ) *
      20;

  const histogram5 =
    Number(
      packet.M5
        .indicators
        .macdHistogram ||
      0
    );

  const histogram15 =
    Number(
      packet.M15
        .indicators
        .macdHistogram ||
      0
    );

  signal +=
    histogram5 > 0
      ? 14
      : histogram5 < 0
        ? -14
        : 0;

  signal +=
    histogram15 > 0
      ? 10
      : histogram15 < 0
        ? -10
        : 0;

  const rsi5 =
    Number(
      packet.M5
        .indicators
        .rsi14 ||
      50
    );

  signal +=
    clamp(
      (
        rsi5 -
        50
      ) *
        0.9,
      -18,
      18
    );

  const roc5 =
    Number(
      packet.M5
        .indicators
        .roc10 ||
      0
    );

  signal +=
    clamp(
      roc5 *
        4,
      -12,
      12
    );

  reasons.push(
    `M5 momentum ${packet.M5.momentum}`
  );

  reasons.push(
    `M15 momentum ${packet.M15.momentum}`
  );

  reasons.push(
    `M5 RSI ${round(rsi5, 1)}`
  );

  reasons.push(
    `M5 MACD histogram ${
      histogram5 >=
      0
        ? "positive"
        : "negative"
    }`
  );

  return moduleResult(
    "momentum",
    signal,

    48 +
      Math.abs(
        signal
      ) *
        0.42,

    reasons
  );
}

/* =========================================================
   REGIME MODULE
========================================================= */

function regimeModule(
  packet
) {
  const regime =
    packet.regimeDetails;

  let signal = 0;

  if (
    regime.name ===
    "TRENDING_BULLISH"
  ) {
    signal = 78;
  } else if (
    regime.name ===
    "TRENDING_BEARISH"
  ) {
    signal = -78;
  } else if (
    regime.name ===
    "BREAKOUT_BULLISH"
  ) {
    signal = 88;
  } else if (
    regime.name ===
    "BREAKOUT_BEARISH"
  ) {
    signal = -88;
  } else if (
    regime.name ===
    "REVERSAL_RISK"
  ) {
    signal =
      biasSign(
        packet.M15
          .ict
          .choch
      ) *
      42;
  } else if (
    regime.name ===
    "MIXED"
  ) {
    signal =
      biasSign(
        packet.H1.bias
      ) *
        20 +
      biasSign(
        packet.M15.bias
      ) *
        15;
  }

  return moduleResult(
    "regime",
    signal,
    regime.quality,
    [
      regime.name,
      ...(
        regime.notes ||
        []
      ).slice(
        0,
        2
      )
    ]
  );
}

/* =========================================================
   SESSION MODULE
========================================================= */

function sessionModule(
  packet
) {
  const liquid =
    [
      "LONDON",
      "LONDON_NEW_YORK_OVERLAP",
      "NEW_YORK"
    ].includes(
      packet.session
    );

  let signal = 0;

  const reliability =
    liquid
      ? 58
      : 30;

  if (
    packet.H1.bias ===
      packet.M15.bias &&
    packet.M15.bias !==
      "NEUTRAL"
  ) {
    signal =
      biasSign(
        packet.M15.bias
      ) *
      (
        liquid
          ? 65
          : 36
      );
  } else if (
    packet.M15.bias !==
    "NEUTRAL"
  ) {
    signal =
      biasSign(
        packet.M15.bias
      ) *
      (
        liquid
          ? 32
          : 18
      );
  }

  return moduleResult(
    "session",
    signal,
    reliability,
    [
      `${packet.session} session`,

      liquid
        ? "Active liquidity window."
        : "Lower-liquidity window."
    ]
  );
}

/* =========================================================
   TECHNICAL ENSEMBLE
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

      sessionModule(
        packet
      )
    ];

  let weightedSignal = 0;

  let weightedReliability = 0;

  let denominator = 0;

  for (
    const module of
    modules
  ) {
    const weight =
      Number(
        ENSEMBLE_WEIGHTS[
          module.name
        ] ||
        0
      );

    const reliabilityFactor =
      Math.max(
        0.25,
        module.reliability /
          100
      );

    weightedSignal +=
      module.signal *
      weight *
      reliabilityFactor;

    weightedReliability +=
      module.reliability *
      weight;

    denominator +=
      weight *
      reliabilityFactor;
  }

  const signal =
    denominator
      ? weightedSignal /
        denominator
      : 0;

  const totalWeight =
    Object.values(
      ENSEMBLE_WEIGHTS
    ).reduce(
      (
        sum,
        value
      ) =>
        sum + value,
      0
    );

  let quality =
    weightedReliability /
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

  const directionalModules =
    modules.filter(
      module =>
        Math.abs(
          module.signal
        ) >=
        12
    );

  const agreeing =
    directionalModules.filter(
      module => {
        if (
          provisional ===
          "BUY"
        ) {
          return (
            module.signal >
            0
          );
        }

        if (
          provisional ===
          "SELL"
        ) {
          return (
            module.signal <
            0
          );
        }

        return false;
      }
    ).length;

  const agreementPct =
    directionalModules.length
      ? (
          agreeing /
          directionalModules.length
        ) *
        100
      : 0;

  const penalties =
    [];

  const price =
    Number(
      packet.currentPrice
    );

  const atr5 =
    Math.max(
      Number(
        packet.M5
          .indicators
          .atr14 ||
        0
      ),

      Math.abs(
        price
      ) *
        0.0001
    );

  const ema20 =
    Number(
      packet.M5
        .indicators
        .ema20
    );

  const stretch =
    Number.isFinite(
      ema20
    )
      ? Math.abs(
          price -
          ema20
        ) /
        atr5
      : 0;

  const rsiValue =
    Number(
      packet.M5
        .indicators
        .rsi14 ||
      50
    );

  if (
    stretch >
    MAX_ENTRY_STRETCH_ATR
  ) {
    quality -= 15;

    penalties.push(
      `Price is ${round(
        stretch,
        2
      )} ATR from M5 EMA20.`
    );
  } else if (
    stretch >
    1.5
  ) {
    quality -= 8;

    penalties.push(
      `Entry is extended ${round(
        stretch,
        2
      )} ATR from M5 EMA20.`
    );
  }

  if (
    packet.regimeDetails
      .name ===
    "HIGH_VOLATILITY_CHOP"
  ) {
    quality -= 22;

    penalties.push(
      "High-volatility chop."
    );
  }

  if (
    [
      "RANGE",
      "COMPRESSION"
    ].includes(
      packet.regimeDetails
        .name
    )
  ) {
    quality -= 8;

    penalties.push(
      `${packet.regimeDetails.name} reduces continuation quality.`
    );
  }

  if (
    (
      packet.H4.bias ===
        "BULLISH" &&
      packet.H1.bias ===
        "BEARISH"
    ) ||
    (
      packet.H4.bias ===
        "BEARISH" &&
      packet.H1.bias ===
        "BULLISH"
    )
  ) {
    quality -= 8;

    penalties.push(
      "H4/H1 conflict."
    );
  }

  if (
    provisional ===
      "BUY" &&
    rsiValue >
      76
  ) {
    quality -= 8;

    penalties.push(
      "M5 RSI overbought for fresh BUY."
    );
  }

  if (
    provisional ===
      "SELL" &&
    rsiValue <
      24
  ) {
    quality -= 8;

    penalties.push(
      "M5 RSI oversold for fresh SELL."
    );
  }

  if (
    agreementPct <
      MIN_MODULE_AGREEMENT &&
    directionalModules.length >=
      3
  ) {
    quality -= 10;

    penalties.push(
      `Only ${round(
        agreementPct,
        0
      )}% module agreement.`
    );
  }

  if (
    !packet.dataQuality
      .valid
  ) {
    quality -= 25;

    penalties.push(
      ...packet.dataQuality
        .issues
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
    packet.dataQuality
      .valid
  ) {
    direction =
      provisional;
  }

  const impact =
    module =>
      Math.abs(
        module.signal
      ) *
      (
        ENSEMBLE_WEIGHTS[
          module.name
        ] ||
        0
      ) *
      (
        module.reliability /
        100
      );

  const ranked =
    [
      ...modules
    ].sort(
      (a, b) =>
        impact(b) -
        impact(a)
    );

  const reasons =
    [];

  for (
    const module of
    ranked
  ) {
    const aligned =
      direction ===
        "BUY"
        ? module.signal >
          0
        : direction ===
            "SELL"
          ? module.signal <
            0
          : Math.abs(
              module.signal
            ) >=
            12;

    if (
      !aligned
    ) {
      continue;
    }

    reasons.push(
      `${module.name.toUpperCase()}: ${module.bias} (${module.strength}/100 strength)`
    );

    if (
      module.reasons?.[0]
    ) {
      reasons.push(
        module.reasons[0]
      );
    }

    if (
      reasons.length >=
      8
    ) {
      break;
    }
  }

  if (
    direction ===
      "WAIT" &&
    !reasons.length
  ) {
    reasons.push(
      "No sufficient directional separation."
    );
  }

  return {
    direction,

    buyScore,
    sellScore,
    margin,

    score:
      best,

    signal:
      round(
        signal,
        1
      ),

    quality,

    agreementPct:
      round(
        agreementPct,
        1
      ),

    stretchAtr:
      round(
        stretch,
        2
      ),

    reasons:
      reasons.slice(
        0,
        8
      ),

    penalties,

    modules
  };
}

/* =========================================================
   LIQUIDITY TARGETS
========================================================= */

function candidateLiquidityTargets(
  direction,
  packet,
  entry
) {
  const levels =
    [];

  const add =
    (
      value,
      name,
      kind = "LEVEL"
    ) => {
      const numeric =
        Number(
          value
        );

      if (
        !Number.isFinite(
          numeric
        )
      ) {
        return;
      }

      if (
        direction ===
          "BUY" &&
        numeric >
          entry
      ) {
        levels.push({
          price:
            numeric,

          name,
          kind
        });
      }

      if (
        direction ===
          "SELL" &&
        numeric <
          entry
      ) {
        levels.push({
          price:
            numeric,

          name,
          kind
        });
      }
    };

  for (
    const pool of
    packet.liquidityMap
      ?.pools ||
    []
  ) {
    add(
      pool.price,
      pool.label,
      pool.kind
    );
  }

  add(
    packet.M15.ict
      .equalHigh,
    "M15 equal high",
    "EQUAL_HIGH"
  );

  add(
    packet.M15.ict
      .equalLow,
    "M15 equal low",
    "EQUAL_LOW"
  );

  add(
    packet.H1.ict
      .lastSwingHigh,
    "H1 swing high",
    "SWING_HIGH"
  );

  add(
    packet.H1.ict
      .lastSwingLow,
    "H1 swing low",
    "SWING_LOW"
  );

  add(
    packet.H1.range
      .high,
    "H1 range high",
    "RANGE_HIGH"
  );

  add(
    packet.H1.range
      .low,
    "H1 range low",
    "RANGE_LOW"
  );

  const tolerance =
    Math.abs(
      entry
    ) *
    0.00003;

  const unique =
    [];

  const sorted =
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
    );

  for (
    const level of
    sorted
  ) {
    const duplicate =
      unique.some(
        existing =>
          Math.abs(
            existing.price -
            level.price
          ) <=
          tolerance
      );

    if (
      duplicate
    ) {
      continue;
    }

    unique.push(
      level
    );
  }

  return unique;
}

/* =========================================================
   RISK PLAN
========================================================= */

function buildRiskPlan(
  direction,
  symbol,
  packet
) {
  if (
    direction ===
    "WAIT"
  ) {
    return {
      valid: false,

      reason:
        "No ensemble-qualified technical candidate.",

      entryType:
        "NONE"
    };
  }

  if (
    !packet.dataQuality
      .valid
  ) {
    return {
      valid: false,

      reason:
        packet.dataQuality
          .issues
          .join(
            " "
          ),

      entryType:
        "NONE"
    };
  }

  const entry =
    Number(
      packet.currentPrice
    );

  const atr5 =
    Math.max(
      Number(
        packet.M5
          .indicators
          .atr14 ||
        0
      ),

      Math.abs(
        entry
      ) *
        0.0001
    );

  const ema20 =
    Number(
      packet.M5
        .indicators
        .ema20
    );

  const stretchAtr =
    Number.isFinite(
      ema20
    )
      ? Math.abs(
          entry -
          ema20
        ) /
        atr5
      : 0;

  if (
    stretchAtr >
    MAX_ENTRY_STRETCH_ATR
  ) {
    return {
      valid: false,

      reason:
        `Price is stretched ${round(
          stretchAtr,
          2
        )} ATR from M5 EMA20.`,

      entryType:
        "WAIT_RETEST",

      suggestedEntry:
        Number.isFinite(
          ema20
        )
          ? priceRound(
              symbol,
              ema20
            )
          : null,

      stretchAtr:
        round(
          stretchAtr,
          2
        )
    };
  }

  const swingLow =
    Number(
      packet.M5.ict
        .lastSwingLow
    );

  const swingHigh =
    Number(
      packet.M5.ict
        .lastSwingHigh
    );

  const swingLowAge =
    Number(
      packet.M5.ict
        .lastSwingLowAge
    );

  const swingHighAge =
    Number(
      packet.M5.ict
        .lastSwingHighAge
    );

  const validSwingLow =
    Number.isFinite(
      swingLow
    ) &&
    Number.isFinite(
      swingLowAge
    ) &&
    swingLowAge <=
      MAX_SWING_AGE_M5 &&
    swingLow <
      entry;

  const validSwingHigh =
    Number.isFinite(
      swingHigh
    ) &&
    Number.isFinite(
      swingHighAge
    ) &&
    swingHighAge <=
      MAX_SWING_AGE_M5 &&
    swingHigh >
      entry;

  const regime =
    packet.regimeDetails
      ?.name ||
    "MIXED";

  let stopAtrFactor =
    1.08;

  if (
    regime.startsWith(
      "TRENDING_"
    )
  ) {
    stopAtrFactor =
      1.0;
  }

  if (
    regime.startsWith(
      "BREAKOUT_"
    )
  ) {
    stopAtrFactor =
      1.12;
  }

  if (
    regime ===
    "RANGE"
  ) {
    stopAtrFactor =
      0.95;
  }

  if (
    regime ===
    "COMPRESSION"
  ) {
    stopAtrFactor =
      1.0;
  }

  if (
    regime ===
    "HIGH_VOLATILITY_CHOP"
  ) {
    stopAtrFactor =
      1.35;
  }

  const buffer =
    atr5 *
    0.20;

  let stop;

  if (
    direction ===
    "BUY"
  ) {
    const atrStop =
      entry -
      atr5 *
        stopAtrFactor;

    const structureStop =
      validSwingLow
        ? swingLow -
          buffer
        : entry -
          atr5 *
            1.25;

    stop =
      Math.min(
        atrStop,
        structureStop
      );
  } else {
    const atrStop =
      entry +
      atr5 *
        stopAtrFactor;

    const structureStop =
      validSwingHigh
        ? swingHigh +
          buffer
        : entry +
          atr5 *
            1.25;

    stop =
      Math.max(
        atrStop,
        structureStop
      );
  }

  const risk =
    Math.abs(
      entry -
      stop
    );

  if (
    !Number.isFinite(
      risk
    ) ||
    risk <= 0
  ) {
    return {
      valid: false,

      reason:
        "Invalid stop distance.",

      entryType:
        "NONE"
    };
  }

  const stopAtr =
    risk /
    atr5;

  if (
    stopAtr >
    MAX_STOP_ATR
  ) {
    return {
      valid: false,

      reason:
        `Stop requires ${round(
          stopAtr,
          2
        )} ATR; maximum is ${MAX_STOP_ATR}.`,

      entryType:
        "NONE"
    };
  }

  const targets =
    candidateLiquidityTargets(
      direction,
      packet,
      entry
    );

  const nearest =
    targets[0] ||
    null;

  const roomR =
    nearest
      ? Math.abs(
          nearest.price -
          entry
        ) /
        risk
      : null;

  if (
    roomR !== null &&
    roomR <
      MIN_LIQUIDITY_ROOM_R
  ) {
    return {
      valid: false,

      reason:
        `Nearest target liquidity (${nearest.name}) is only ${round(
          roomR,
          2
        )}R away.`,

      entryType:
        "NONE",

      nearestLiquidity:
        {
          name:
            nearest.name,

          price:
            priceRound(
              symbol,
              nearest.price
            ),

          roomR:
            round(
              roomR,
              2
            )
        }
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
    roomR !== null &&
    roomR >=
      MIN_LIQUIDITY_ROOM_R &&
    roomR <
      TP1_R
  ) {
    tp1 =
      nearest.price;
  }

  const rr1Before =
    Math.abs(
      tp1 -
      entry
    ) /
    risk;

  const secondTarget =
    targets.find(
      target => {
        const r =
          Math.abs(
            target.price -
            entry
          ) /
          risk;

        return (
          r >=
          Math.max(
            1.45,
            rr1Before +
              0.20
          ) &&
          r <=
            TP2_R *
            1.35
        );
      }
    );

  if (
    secondTarget
  ) {
    tp2 =
      secondTarget.price;
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
      1.0 ||
    rr2 <
      1.4 ||
    rr2 <=
      rr1
  ) {
    return {
      valid: false,

      reason:
        `Risk/reward rejected: TP1 ${round(
          rr1,
          2
        )}R, TP2 ${round(
          rr2,
          2
        )}R.`,

      entryType:
        "NONE"
    };
  }

  let entryType =
    "MARKET";

  if (
    regime.startsWith(
      "BREAKOUT_"
    )
  ) {
    entryType =
      "BREAKOUT_CONTINUATION";
  } else if (
    stretchAtr >=
    1.25
  ) {
    entryType =
      "CAUTION_EXTENDED";
  } else if (
    regime.startsWith(
      "TRENDING_"
    )
  ) {
    entryType =
      "TREND_CONTINUATION";
  }

  return {
    valid: true,

    entryType,

    entry:
      priceRound(
        symbol,
        entry
      ),

    stopLoss:
      priceRound(
        symbol,
        stop
      ),

    takeProfit1:
      priceRound(
        symbol,
        tp1
      ),

    takeProfit2:
      priceRound(
        symbol,
        tp2
      ),

    riskReward:
      `1:${round(
        rr2,
        2
      )}`,

    riskRewardTP1:
      `1:${round(
        rr1,
        2
      )}`,

    riskDistance:
      priceRound(
        symbol,
        risk
      ),

    stopAtr:
      round(
        stopAtr,
        2
      ),

    stretchAtr:
      round(
        stretchAtr,
        2
      ),

    structuralStopUsed:
      direction ===
        "BUY"
        ? validSwingLow
        : validSwingHigh,

    nearestLiquidity:
      nearest
        ? {
            name:
              nearest.name,

            kind:
              nearest.kind,

            price:
              priceRound(
                symbol,
                nearest.price
              ),

            roomR:
              round(
                roomR,
                2
              )
          }
        : null,

    targetLiquidity:
      secondTarget
        ? {
            name:
              secondTarget.name,

            kind:
              secondTarget.kind,

            price:
              priceRound(
                symbol,
                secondTarget.price
              )
          }
        : null
  };
}

/* =========================================================
   TRADE PERMISSION
========================================================= */

function buildPreTradePermission(
  packet,
  technical,
  riskPlan
) {
  const checks =
    [];

  const warnings =
    [];

  const blockers =
    [];

  const addCheck =
    (
      name,
      pass,
      detail,
      hard = true
    ) => {
      const ok =
        Boolean(
          pass
        );

      checks.push({
        name,
        pass: ok,
        detail
      });

      if (
        !ok &&
        hard
      ) {
        blockers.push(
          detail ||
          name
        );
      }

      if (
        !ok &&
        !hard
      ) {
        warnings.push(
          detail ||
          name
        );
      }
    };

  addCheck(
    "DATA_FRESHNESS",

    packet.dataQuality
      .valid,

    packet.dataQuality
      .valid
      ? `Feed fresh; latest completed M5 candle age ${packet.dataQuality.ageMinutes} minutes.`
      : packet.dataQuality
          .issues
          .join(
            " "
          )
  );

  addCheck(
    "ENSEMBLE_DIRECTION",

    technical.direction !==
      "WAIT",

    technical.direction !==
      "WAIT"
      ? `${technical.direction} candidate selected.`
      : "Ensemble has not selected BUY or SELL."
  );

  addCheck(
    "ENSEMBLE_SCORE",

    technical.score >=
      MIN_ENSEMBLE_SCORE,

    `Score ${technical.score}/100; minimum ${MIN_ENSEMBLE_SCORE}.`
  );

  addCheck(
    "DIRECTIONAL_MARGIN",

    technical.margin >=
      MIN_ENSEMBLE_MARGIN,

    `Directional margin ${technical.margin}; minimum ${MIN_ENSEMBLE_MARGIN}.`
  );

  addCheck(
    "ENSEMBLE_QUALITY",

    technical.quality >=
      MIN_ENSEMBLE_QUALITY,

    `Quality ${technical.quality}/100; minimum ${MIN_ENSEMBLE_QUALITY}.`
  );

  addCheck(
    "MODULE_AGREEMENT",

    technical.agreementPct >=
      MIN_MODULE_AGREEMENT,

    `Module agreement ${technical.agreementPct}%; minimum ${MIN_MODULE_AGREEMENT}%.`
  );

  addCheck(
    "RISK_PLAN",

    Boolean(
      riskPlan.valid
    ),

    riskPlan.valid
      ? "Risk plan valid."
      : riskPlan.reason ||
        "Risk plan rejected."
  );

  const hostileRegime =
    packet.regimeDetails
      ?.name ===
    "HIGH_VOLATILITY_CHOP";

  addCheck(
    "REGIME_SAFETY",

    !hostileRegime,

    hostileRegime
      ? "High-volatility chop blocks new trades."
      : `${packet.regimeDetails.name} regime accepted.`
  );

  const unresolvedCompression =
    packet.regimeDetails
      ?.name ===
      "COMPRESSION" &&
    packet.M15.ict
      .bos ===
      "NONE";

  addCheck(
    "COMPRESSION_BREAK",

    !unresolvedCompression,

    unresolvedCompression
      ? "Compression has no M15 BOS."
      : "No unresolved compression block."
  );

  addCheck(
    "SESSION_QUALITY",

    packet.session !==
      "TRANSITION" &&
    packet.session !==
      "UNKNOWN",

    packet.session ===
      "TRANSITION"
      ? "Transition session; liquidity may be thin."
      : packet.session ===
          "UNKNOWN"
        ? "Session could not be resolved."
        : `${packet.session} session active.`,

    false
  );

  return {
    allowed:
      blockers.length ===
      0,

    state:
      blockers.length ===
      0
        ? "PRE_TRADE_APPROVED"
        : "BLOCKED",

    checks,
    warnings,
    blockers
  };
}

/* =========================================================
   FINAL SETUP SCORE
========================================================= */

function gradeFromStrength(
  action,
  strength
) {
  if (
    action ===
    "WAIT"
  ) {
    return "WAIT";
  }

  if (
    strength >=
    90
  ) {
    return "A+";
  }

  if (
    strength >=
    84
  ) {
    return "A";
  }

  if (
    strength >=
    78
  ) {
    return "B+";
  }

  if (
    strength >=
    70
  ) {
    return "B";
  }

  return "C";
}

function timeframeStrength(
  snapshotData
) {
  const adxValue =
    Number(
      snapshotData
        .indicators
        ?.adx14 ||
      0
    );

  const slope =
    Math.abs(
      Number(
        snapshotData
          .indicators
          ?.ema20SlopeAtr ||
        0
      )
    );

  const efficiency =
    Number(
      snapshotData
        .indicators
        ?.candleEfficiency ||
      0
    );

  let strength =
    35 +
    Math.min(
      adxValue,
      40
    ) *
      1.15 +
    Math.min(
      slope,
      2.5
    ) *
      6 +
    efficiency *
      12;

  if (
    snapshotData.bias ===
    "NEUTRAL"
  ) {
    strength -= 16;
  }

  return clamp(
    Math.round(
      strength
    ),
    20,
    98
  );
}

/* =========================================================
   FINAL ANALYSIS
========================================================= */

function buildFinalAnalysis(
  packet,
  technical,
  riskPlan,
  permission
) {
  let action =
    technical.direction;

  const rejectionReasons =
    [];

  if (
    !permission.allowed
  ) {
    rejectionReasons.push(
      ...(
        permission.blockers ||
        []
      )
    );
  }

  if (
    action !==
      "WAIT" &&
    !permission.allowed
  ) {
    action =
      "WAIT";
  }

  if (
    action !==
      "WAIT" &&
    !riskPlan.valid
  ) {
    if (
      riskPlan.reason
    ) {
      rejectionReasons.push(
        riskPlan.reason
      );
    }

    action =
      "WAIT";
  }

  let setupStrength =
    Math.round(
      technical.score *
        0.58 +

      technical.quality *
        0.24 +

      technical.agreementPct *
        0.18
    );

  if (
    permission.warnings
      ?.length
  ) {
    setupStrength -=
      Math.min(
        5,
        permission.warnings
          .length *
          2
      );
  }

  if (
    packet.dataQuality
      .stale
  ) {
    setupStrength -=
      20;
  }

  setupStrength =
    clamp(
      setupStrength,
      0,
      96
    );

  /*
    Never allow WAIT to look like an
    80%-90% trade recommendation.
  */
  if (
    action ===
    "WAIT"
  ) {
    setupStrength =
      Math.min(
        setupStrength,
        69
      );
  }

  if (
    rejectionReasons.length &&
    action ===
      "WAIT"
  ) {
    setupStrength =
      Math.min(
        setupStrength,
        64
      );
  }

  const directionText =
    technical.direction ===
      "WAIT"
      ? `No trade passed the ${MIN_ENSEMBLE_SCORE} score / ${MIN_ENSEMBLE_MARGIN} margin / ${MIN_ENSEMBLE_QUALITY} quality / ${MIN_MODULE_AGREEMENT}% agreement gates.`
      : `${technical.direction} candidate scored ${technical.score}/100 with ${technical.quality}/100 quality, ${technical.agreementPct}% module agreement and ${technical.margin}-point directional separation.`;

  const summary =
    action ===
      "WAIT"
      ? `${directionText}${
          rejectionReasons.length
            ? ` Blockers: ${[
                ...new Set(
                  rejectionReasons
                )
              ].join(
                " "
              )}`
            : ""
        }`
      : `${technical.direction} passed ensemble, data-quality, regime, liquidity, risk and permission checks.`;

  const liquidityMap =
    packet.liquidityMap ||
    {};

  const buySideText =
    liquidityMap
      .nearestBuySide
      ? `${liquidityMap.nearestBuySide.label} ${liquidityMap.nearestBuySide.price}`
      : "none mapped";

  const sellSideText =
    liquidityMap
      .nearestSellSide
      ? `${liquidityMap.nearestSellSide.label} ${liquidityMap.nearestSellSide.price}`
      : "none mapped";

  const finalAllowed =
    action !==
    "WAIT";

  return {
    action,

    /*
      Compatibility field:
      this is SETUP STRENGTH,
      NOT estimated win probability.
    */
    confidence:
      setupStrength,

    confidenceType:
      "SETUP_STRENGTH_NOT_WIN_PROBABILITY",

    setupStrength,

    setupGrade:
      gradeFromStrength(
        action,
        setupStrength
      ),

    summary,

    timeframeBias: {
      M5:
        packet.M5.bias,

      M15:
        packet.M15.bias,

      H1:
        packet.H1.bias,

      H4:
        packet.H4.bias
    },

    timeframes: {
      m5: {
        bias:
          packet.M5.bias,

        strength:
          timeframeStrength(
            packet.M5
          )
      },

      m15: {
        bias:
          packet.M15.bias,

        strength:
          timeframeStrength(
            packet.M15
          )
      },

      h1: {
        bias:
          packet.H1.bias,

        strength:
          timeframeStrength(
            packet.H1
          )
      },

      h4: {
        bias:
          packet.H4.bias,

        strength:
          timeframeStrength(
            packet.H4
          )
      }
    },

    regime:
      packet.regime,

    regimeDetails:
      packet.regimeDetails,

    dataQuality:
      packet.dataQuality,

    structure:
      `H4 ${packet.H4.structure}; ` +
      `H1 ${packet.H1.structure}; ` +
      `M15 ${packet.M15.structure}; ` +
      `M5 ${packet.M5.structure}.`,

    momentum:
      packet.M5.momentum,

    liquiditySummary:
      `Nearest buy-side: ${buySideText}. ` +
      `Nearest sell-side: ${sellSideText}. ` +
      `M5 sweep ${packet.M5.ict.sweep.type}; ` +
      `M15 zone ${packet.M15.ict.premiumDiscount}.`,

    liquidityMap,

    macroBias:
      "NOT_CONNECTED",

    newsRisk:
      "NOT_CONNECTED",

    newsSummary:
      "No news or macro filter is connected. Engine is deterministic technical mode only.",

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

    riskReward:
      action ===
        "WAIT"
        ? "—"
        : riskPlan.riskReward,

    entryType:
      action ===
        "WAIT"
        ? riskPlan.entryType ||
          "WAIT"
        : riskPlan.entryType,

    invalidation:
      action ===
        "BUY"
        ? `Bullish setup invalid below ${riskPlan.stopLoss}.`
        : action ===
            "SELL"
          ? `Bearish setup invalid above ${riskPlan.stopLoss}.`
          : "No active setup.",

    nextTrigger:
      riskPlan.entryType ===
        "WAIT_RETEST"
        ? `Wait for price to retrace toward ${riskPlan.suggestedEntry || "M5 EMA20"}, then rescan.`
        : action ===
            "WAIT"
          ? "Wait for fresh completed candles and a new ensemble-qualified setup."
          : `Maintain ${action} bias only while M5/M15 structure remains supportive.`,

    reasons:
      [
        ...technical.reasons
      ].slice(
        0,
        10
      ),

    risks:
      [
        ...technical.penalties,

        ...(
          permission.warnings ||
          []
        ),

        ...rejectionReasons
      ]
        .filter(
          (
            value,
            index,
            array
          ) =>
            array.indexOf(
              value
            ) ===
            index
        )
        .slice(
          0,
          10
        ),

    technicalScore: {
      buy:
        technical.buyScore,

      sell:
        technical.sellScore,

      selected:
        technical.direction,

      selectedScore:
        technical.score,

      margin:
        technical.margin,

      quality:
        technical.quality,

      agreementPct:
        technical.agreementPct,

      signedSignal:
        technical.signal
    },

    ensemble: {
      direction:
        technical.direction,

      buyScore:
        technical.buyScore,

      sellScore:
        technical.sellScore,

      selectedScore:
        technical.score,

      signedSignal:
        technical.signal,

      quality:
        technical.quality,

      agreementPct:
        technical.agreementPct,

      modules:
        technical.modules
    },

    tradePermission: {
      deterministic:
        permission,

      mode:
        "DETERMINISTIC",

      finalAllowed,

      state:
        finalAllowed
          ? "APPROVED"
          : "BLOCKED",

      blockers:
        [
          ...new Set(
            rejectionReasons
          )
        ]
    },

    riskPlan:
      riskPlan.valid
        ? riskPlan
        : {
            valid: false,

            reason:
              riskPlan.reason,

            entryType:
              riskPlan.entryType ||
              "NONE",

            suggestedEntry:
              riskPlan.suggestedEntry ||
              null
          }
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
        success: false,

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

    if (
      !ALLOWED_SYMBOLS.has(
        symbol
      )
    ) {
      return send(
        res,
        400,
        {
          success: false,

          error:
            `Unsupported symbol: ${symbol}`
        }
      );
    }

    const {
      candles:
        rawM5,
      cacheHit
    } =
      await getM5Cached(
        symbol
      );

    /*
      Latest Twelve Data price.
      May belong to the current
      still-forming M5 bar.
    */
    const currentPrice =
      rawM5.at(-1)?.c;

    if (
      !Number.isFinite(
        currentPrice
      )
    ) {
      throw new Error(
        "Current market price unavailable."
      );
    }

    /*
      Technical analysis uses
      COMPLETED M5 candles only.
    */
    const m5 =
      getCompletedM5(
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

    const h4 =
      resample(
        m5,
        240
      );

    if (
      m5.length <
        180 ||
      m15.length <
        50 ||
      h1.length <
        24 ||
      h4.length <
        6
    ) {
      throw new Error(
        "Not enough completed quality candles for M5/M15/H1/H4 analysis."
      );
    }

    const dataQuality =
      buildDataQuality(
        rawM5,
        m5,
        m15,
        h1,
        h4
      );

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

      marketTimestamp:
        rawM5.at(-1)
          ?.t ||
        null,

      lastCompletedM5:
        m5.at(-1)
          ?.t ||
        null,

      session:
        sessionFromCandles(
          m5
        ),

      dataQuality,

      M5:
        snapshot(
          symbol,
          m5
        ),

      M15:
        snapshot(
          symbol,
          m15
        ),

      H1:
        snapshot(
          symbol,
          h1
        ),

      H4:
        snapshot(
          symbol,
          h4
        )
    };

    packet.liquidityMap =
      buildLiquidityMap(
        symbol,
        packet,
        m5
      );

    packet.regimeDetails =
      detectRegimeDetails(
        packet
      );

    packet.regime =
      packet.regimeDetails
        .name;

    const technical =
      scoreTechnical(
        packet
      );

    const riskPlan =
      buildRiskPlan(
        technical.direction,
        symbol,
        packet
      );

    const permission =
      buildPreTradePermission(
        packet,
        technical,
        riskPlan
      );

    packet.preTradePermission =
      permission;

    const analysis =
      buildFinalAnalysis(
        packet,
        technical,
        riskPlan,
        permission
      );

    const referenceIndex =
      Math.max(
        0,
        rawM5.length -
          13
      );

    const oldPrice =
      rawM5[
        referenceIndex
      ]?.c;

    const changePct =
      Number.isFinite(
        oldPrice
      ) &&
      oldPrice !== 0
        ? (
            (
              currentPrice /
              oldPrice
            ) -
            1
          ) *
          100
        : 0;

    return send(
      res,
      200,
      {
        success: true,

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

        model:
          "MKAYFX Extreme Quant V5 Hardened",

        engine:
          "DETERMINISTIC",

        ai_provider:
          "Disabled",

        ai_online:
          false,

        ai_error:
          null,

        analysis,

        chart:
          rawM5
            .slice(-60)
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
          "Twelve Data M5 + completed-candle M15/H1/H4 + Wilder indicators + deterministic ensemble/regime/liquidity/risk engine",

        data_quality:
          packet.dataQuality,

        cache_hit:
          cacheHit,

        guardrail_note:
          cacheHit
            ? "Cached market data used within configured cache window."
            : "Fresh M5 data loaded; completed higher timeframes generated locally.",

        session:
          packet.session,

        regime:
          packet.regime,

        regime_details:
          packet.regimeDetails,

        liquidity_map:
          packet.liquidityMap,

        ensemble:
          analysis.ensemble,

        trade_permission:
          analysis.tradePermission,

        news_sources:
          [],

        ai_usage:
          null,

        timestamp:
          new Date()
            .toISOString()
      }
    );
  } catch (
    error
  ) {
    console.error(
      "MKAYFX V5 ERROR:",
      error
    );

    return send(
      res,
      500,
      {
        success: false,

        error:
          error?.message ||
          "Unknown server error."
      }
    );
  }
}