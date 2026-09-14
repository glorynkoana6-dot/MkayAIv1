/* MKAYFX EXTREME QUANT V4 — ENSEMBLE / REGIME / LIQUIDITY — NO GEMINI FILTER */

const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY;
/* External AI approval filter removed. MKAYFX uses its deterministic ensemble + risk/permission engines only. */

const TWELVE_URL = "https://api.twelvedata.com/time_series";
const CACHE_MS = 55_000;
const OUTPUT_SIZE = 1000;
const TP1_R = Number(process.env.TP1_R || 1.25);
const TP2_R = Number(process.env.TP2_R || 1.8);

const MIN_ENSEMBLE_SCORE = Number(process.env.MIN_ENSEMBLE_SCORE || 63);
const MIN_ENSEMBLE_MARGIN = Number(process.env.MIN_ENSEMBLE_MARGIN || 24);
const MIN_ENSEMBLE_QUALITY = Number(process.env.MIN_ENSEMBLE_QUALITY || 52);

const ENSEMBLE_WEIGHTS = Object.freeze({
  trend: 27,
  structure: 23,
  liquidity: 22,
  momentum: 16,
  regime: 8,
  session: 4
});

const ALLOWED_SYMBOLS = new Set([
  "XAU/USD",
  "EUR/USD",
  "GBP/USD",
  "USD/JPY",
  "BTC/USD",
  "XBR/USD"
]);

const marketCache = new Map();
const inFlight = new Map();

function send(res, status, data) {
  return res.status(status).json(data);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function round(v, digits = 2) {
  const n = Number(v);
  return Number.isFinite(n)
    ? Number(n.toFixed(digits))
    : null;
}

function priceDigits(symbol) {
  if (
    symbol === "EUR/USD" ||
    symbol === "GBP/USD"
  ) {
    return 5;
  }

  if (symbol === "USD/JPY") {
    return 3;
  }

  return 2;
}

function priceRound(symbol, v) {
  return round(
    v,
    priceDigits(symbol)
  );
}

function parseUTC(datetime) {
  const clean = String(datetime || "")
    .trim()
    .replace(" ", "T");

  const zoned =
    /Z$|[+-]\d\d:\d\d$/.test(clean)
      ? clean
      : `${clean}Z`;

  return new Date(zoned).getTime();
}

function getRequestBody(req) {
  if (!req.body) return {};

  if (typeof req.body === "object") {
    return req.body;
  }

  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

async function fetchJson(
  url,
  options = {},
  timeoutMs = 25000
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
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

async function requestM5(symbol) {
  if (!TWELVE_DATA_API_KEY) {
    throw new Error(
      "TWELVE_DATA_API_KEY is missing in Vercel."
    );
  }

  const params =
    new URLSearchParams({
      symbol,
      interval: "5min",
      outputsize: String(OUTPUT_SIZE),
      timezone: "UTC",
      format: "JSON",
      apikey: TWELVE_DATA_API_KEY
    });

  const {
    response,
    data
  } =
    await fetchJson(
      `${TWELVE_URL}?${params.toString()}`,
      {},
      15000
    );

  if (
    !response.ok ||
    data.status === "error" ||
    !Array.isArray(data.values)
  ) {
    throw new Error(
      data.message ||
      "Twelve Data request failed."
    );
  }

  const candles =
    data.values

      .map(
        x => ({
          t: x.datetime,
          o: Number(x.open),
          h: Number(x.high),
          l: Number(x.low),
          c: Number(x.close),
          v: Number(
            x.volume || 0
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
          ]
          .every(
            Number.isFinite
          )
      )

      .reverse();

  if (
    candles.length <
    240
  ) {
    throw new Error(
      "Not enough market candles returned for analysis."
    );
  }

  return candles;
}

async function getM5Cached(symbol) {
  const key =
    symbol.toUpperCase();

  const now =
    Date.now();

  const cached =
    marketCache.get(key);

  if (
    cached &&
    now - cached.time <
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
    inFlight.has(key)
  ) {
    return {
      candles:
        await inFlight.get(key),

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
          inFlight.delete(key)
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

function completedCandles(candles) {
  return candles.length > 2
    ? candles.slice(0, -1)
    : candles;
}

function resample(
  candles,
  minutes
) {
  const bucketMs =
    minutes * 60_000;

  const baseMs =
    5 * 60_000;

  const buckets =
    new Map();

  for (
    const c of candles
  ) {
    const ms =
      parseUTC(c.t);

    if (
      !Number.isFinite(ms)
    ) {
      continue;
    }

    const bucket =
      Math.floor(
        ms / bucketMs
      ) * bucketMs;

    if (
      !buckets.has(bucket)
    ) {
      buckets.set(
        bucket,
        []
      );
    }

    buckets
      .get(bucket)
      .push(c);
  }

  const lastM5Start =
    parseUTC(
      candles.at(-1)?.t
    );

  const completedThrough =
    Number.isFinite(
      lastM5Start
    )
      ? lastM5Start +
        baseMs
      : null;

  const result =
    [];

  for (
    const [
      timestamp,
      group
    ]
    of buckets
  ) {
    if (
      Number.isFinite(
        completedThrough
      ) &&
      timestamp +
      bucketMs >
      completedThrough
    ) {
      continue;
    }

    group.sort(
      (a, b) =>
        parseUTC(a.t) -
        parseUTC(b.t)
    );

    const first =
      group[0];

    const last =
      group[
        group.length - 1
      ];

    result.push({
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
          (s, x) =>
            s +
            (x.v || 0),
          0
        )
    });
  }

  return result.sort(
    (a, b) =>
      parseUTC(a.t) -
      parseUTC(b.t)
  );
}

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

  const a =
    values.slice(-period);

  return a.reduce(
    (s, x) =>
      s + x,
    0
  ) / period;
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

  const k =
    2 /
    (period + 1);

  const seed =
    values
      .slice(
        0,
        period
      )
      .reduce(
        (s, x) =>
          s + x,
        0
      ) /
    period;

  const out =
    Array(
      period - 1
    )
    .fill(null);

  let current =
    seed;

  out.push(current);

  for (
    let i = period;
    i < values.length;
    i++
  ) {
    current =
      (
        values[i] -
        current
      ) *
      k +
      current;

    out.push(current);
  }

  return out;
}

function ema(
  values,
  period
) {
  const s =
    emaSeries(
      values,
      period
    );

  return s.length
    ? s[
        s.length - 1
      ]
    : null;
}

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
    let i =
      closes.length -
      period;

    i <
      closes.length;

    i++
  ) {
    const d =
      closes[i] -
      closes[
        i - 1
      ];

    if (d > 0) {
      gains += d;
    } else {
      losses +=
        Math.abs(d);
    }
  }

  const avgGain =
    gains / period;

  const avgLoss =
    losses / period;

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
    (1 + rs)
  );
}

function atr(
  candles,
  period = 14
) {
  if (
    candles.length <=
    period
  ) {
    return null;
  }

  const tr =
    [];

  for (
    let i = 1;
    i <
      candles.length;
    i++
  ) {
    const c =
      candles[i];

    const p =
      candles[
        i - 1
      ];

    tr.push(
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

  return sma(
    tr,
    period
  );
}

function macd(closes) {
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
    values.length < 9
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
      line - signal
  };
}

function adx(
  candles,
  period = 14
) {
  if (
    candles.length <
    period * 2 + 2
  ) {
    return null;
  }

  const trs = [];
  const plusDM = [];
  const minusDM = [];

  for (
    let i = 1;
    i <
      candles.length;
    i++
  ) {
    const c =
      candles[i];

    const p =
      candles[
        i - 1
      ];

    const up =
      c.h - p.h;

    const down =
      p.l - c.l;

    plusDM.push(
      up > down &&
      up > 0
        ? up
        : 0
    );

    minusDM.push(
      down > up &&
      down > 0
        ? down
        : 0
    );

    trs.push(
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

  const dx =
    [];

  for (
    let i =
      period - 1;

    i <
      trs.length;

    i++
  ) {
    const trN =
      trs
        .slice(
          i -
          period +
          1,
          i + 1
        )
        .reduce(
          (s, x) =>
            s + x,
          0
        );

    if (!trN) {
      continue;
    }

    const pDM =
      plusDM
        .slice(
          i -
          period +
          1,
          i + 1
        )
        .reduce(
          (s, x) =>
            s + x,
          0
        );

    const mDM =
      minusDM
        .slice(
          i -
          period +
          1,
          i + 1
        )
        .reduce(
          (s, x) =>
            s + x,
          0
        );

    const pDI =
      100 *
      pDM /
      trN;

    const mDI =
      100 *
      mDM /
      trN;

    const denom =
      pDI + mDI;

    if (denom) {
      dx.push(
        100 *
        Math.abs(
          pDI - mDI
        ) /
        denom
      );
    }
  }

  return dx.length >=
    period
      ? sma(
          dx,
          period
        )
      : dx.length
        ? sma(
            dx,
            dx.length
          )
        : null;
}

function stdDev(values) {
  if (!values.length) {
    return null;
  }

  const mean =
    values.reduce(
      (s, x) =>
        s + x,
      0
    ) /
    values.length;

  const variance =
    values.reduce(
      (s, x) =>
        s +
        (x - mean) ** 2,
      0
    ) /
    values.length;

  return Math.sqrt(
    variance
  );
}

function bollingerMetrics(
  closes,
  period = 20,
  mult = 2
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
    closes.slice(-period);

  const middle =
    window.reduce(
      (s, x) =>
        s + x,
      0
    ) /
    period;

  const sd =
    stdDev(window);

  const upper =
    middle +
    mult * sd;

  const lower =
    middle -
    mult * sd;

  const width =
    upper - lower;

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
          ) * 100
        : null,

    position:
      width
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
      -(period + 1)
    );

  const now =
    closes.at(-1);

  if (
    !Number.isFinite(old) ||
    old === 0 ||
    !Number.isFinite(now)
  ) {
    return null;
  }

  return (
    (
      now / old
    ) -
    1
  ) * 100;
}

function atrSeries(
  candles,
  period = 14,
  lookback = 140
) {
  if (
    candles.length <=
    period
  ) {
    return [];
  }

  const start =
    Math.max(
      1,
      candles.length -
      lookback -
      period
    );

  const trs =
    [];

  for (
    let i = start;
    i <
      candles.length;
    i++
  ) {
    const c =
      candles[i];

    const p =
      candles[
        i - 1
      ];

    trs.push(
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

  const out =
    [];

  for (
    let i =
      period - 1;

    i <
      trs.length;

    i++
  ) {
    const w =
      trs.slice(
        i -
        period +
        1,
        i + 1
      );

    out.push(
      w.reduce(
        (s, x) =>
          s + x,
        0
      ) /
      period
    );
  }

  return out;
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

  const lessOrEqual =
    clean.filter(
      x =>
        x <= current
    ).length;

  return (
    lessOrEqual /
    clean.length
  ) * 100;
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
      -(bars + 1)
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
  const w =
    candles.slice(-bars);

  if (
    w.length < 2
  ) {
    return null;
  }

  const net =
    Math.abs(
      w.at(-1).c -
      w[0].o
    );

  const path =
    w.reduce(
      (s, c) =>
        s +
        Math.abs(
          c.c -
          c.o
        ),
      0
    );

  if (!path) {
    return 0;
  }

  return clamp(
    net / path,
    0,
    1
  );
}

function recentRange(
  candles,
  bars = 20
) {
  const r =
    candles.slice(-bars);

  return {
    high:
      r.length
        ? Math.max(
            ...r.map(
              x => x.h
            )
          )
        : null,

    low:
      r.length
        ? Math.min(
            ...r.map(
              x => x.l
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
    const c =
      candles[i];

    let isHigh =
      true;

    let isLow =
      true;

    for (
      let j =
        i - left;

      j <=
        i + right;

      j++
    ) {
      if (j === i) {
        continue;
      }

      if (
        candles[j].h >=
        c.h
      ) {
        isHigh =
          false;
      }

      if (
        candles[j].l <=
        c.l
      ) {
        isLow =
          false;
      }
    }

    if (isHigh) {
      highs.push({
        index: i,
        price: c.h,
        t: c.t
      });
    }

    if (isLow) {
      lows.push({
        index: i,
        price: c.l,
        t: c.t
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
  const hs =
    swings.highs.slice(-2);

  const ls =
    swings.lows.slice(-2);

  if (
    hs.length < 2 ||
    ls.length < 2
  ) {
    return "MIXED";
  }

  if (
    hs[1].price >
      hs[0].price &&
    ls[1].price >
      ls[0].price
  ) {
    return "HH/HL";
  }

  if (
    hs[1].price <
      hs[0].price &&
    ls[1].price <
      ls[0].price
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

  const priorHigh =
    swings.highs.at(-1);

  const priorLow =
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
    priorHigh &&
    close >
      priorHigh.price
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
    priorLow &&
    close <
      priorLow.price
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

function detectLiquiditySweep(
  candles,
  lookback = 20
) {
  if (
    candles.length <
    lookback + 2
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
    last.h > high &&
    last.c < high
  ) {
    return {
      type:
        "BEARISH_BUYSIDE_SWEEP",

      level:
        high
    };
  }

  if (
    last.l < low &&
    last.c > low
  ) {
    return {
      type:
        "BULLISH_SELLSIDE_SWEEP",

      level:
        low
    };
  }

  return {
    type: "NONE",
    level: null
  };
}

function detectEqualLevels(
  candles,
  atrValue,
  lookback = 40
) {
  const swings =
    findSwings(
      candles.slice(
        -lookback
      ),
      2,
      2
    );

  const tolerance =
    Math.max(
      (atrValue || 0) *
      0.18,

      Math.abs(
        candles.at(-1).c
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
    if (
      Math.abs(
        swings.highs[i].price -
        swings.highs[
          i - 1
        ].price
      ) <=
      tolerance
    ) {
      equalHigh =
        (
          swings.highs[i].price +
          swings.highs[
            i - 1
          ].price
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
    if (
      Math.abs(
        swings.lows[i].price -
        swings.lows[
          i - 1
        ].price
      ) <=
      tolerance
    ) {
      equalLow =
        (
          swings.lows[i].price +
          swings.lows[
            i - 1
          ].price
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

function detectFVG(
  candles,
  lookback = 30
) {
  const start =
    Math.max(
      2,
      candles.length -
      lookback
    );

  let bullish =
    null;

  let bearish =
    null;

  for (
    let i = start;
    i <
      candles.length;
    i++
  ) {
    const a =
      candles[
        i - 2
      ];

    const c =
      candles[i];

    if (
      c.l > a.h
    ) {
      bullish = {
        low: a.h,
        high: c.l,
        t: c.t
      };
    }

    if (
      c.h < a.l
    ) {
      bearish = {
        low: c.h,
        high: a.l,
        t: c.t
      };
    }
  }

  return {
    bullish,
    bearish
  };
}

function detectOrderBlock(
  candles,
  bos
) {
  if (
    bos === "NONE"
  ) {
    return null;
  }

  const wantBearish =
    bos ===
    "BULLISH_BOS";

  const wantBullish =
    bos ===
    "BEARISH_BOS";

  for (
    let i =
      candles.length - 2;

    i >=
      Math.max(
        0,
        candles.length -
        15
      );

    i--
  ) {
    const c =
      candles[i];

    if (
      wantBearish &&
      c.c < c.o
    ) {
      return {
        type:
          "BULLISH_OB",

        low:
          c.l,

        high:
          c.h,

        t:
          c.t
      };
    }

    if (
      wantBullish &&
      c.c > c.o
    ) {
      return {
        type:
          "BEARISH_OB",

        low:
          c.l,

        high:
          c.h,

        t:
          c.t
      };
    }
  }

  return null;
}

function premiumDiscount(
  candles,
  bars = 40
) {
  const r =
    recentRange(
      candles,
      bars
    );

  const price =
    candles.at(-1).c;

  if (
    r.high == null ||
    r.low == null
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
      r.high +
      r.low
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

function trendBias(closes) {
  const p =
    closes.at(-1);

  if (
    !Number.isFinite(p) ||
    closes.length < 20
  ) {
    return "NEUTRAL";
  }

  const fastPeriod =
    closes.length >= 50
      ? 20
      : 8;

  const slowPeriod =
    closes.length >= 50
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

  const e200 =
    closes.length >= 200
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
    p > fast &&
    fast > slow &&
    (
      e200 == null ||
      slow > e200
    )
  ) {
    return "BULLISH";
  }

  if (
    p < fast &&
    fast < slow &&
    (
      e200 == null ||
      slow < e200
    )
  ) {
    return "BEARISH";
  }

  return "NEUTRAL";
}

function candleMomentum(candles) {
  const recent =
    candles.slice(-6);

  let bull =
    0;

  let bear =
    0;

  for (
    const c of recent
  ) {
    const range =
      Math.max(
        c.h - c.l,
        1e-9
      );

    const body =
      Math.abs(
        c.c - c.o
      ) /
      range;

    if (
      c.c > c.o
    ) {
      bull += body;
    }

    if (
      c.c < c.o
    ) {
      bear += body;
    }
  }

  if (
    bull >
    bear * 1.25
  ) {
    return "BULLISH";
  }

  if (
    bear >
    bull * 1.25
  ) {
    return "BEARISH";
  }

  return "MIXED";
}

function snapshot(
  symbol,
  candles
) {
  const closes =
    candles.map(
      x => x.c
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

  const eq =
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

  const m =
    macd(
      closes
    );

  const bb =
    bollingerMetrics(
      closes,
      20,
      2
    );

  const atrHistory =
    atrSeries(
      candles,
      14,
      140
    );

  const atrPct =
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

  return {
    price:
      priceRound(
        symbol,
        closes.at(-1)
      ),

    bias:
      trendBias(closes),

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
          m.line,
          6
        ),

      macdSignal:
        round(
          m.signal,
          6
        ),

      macdHistogram:
        round(
          m.histogram,
          6
        ),

      bollingerMiddle:
        priceRound(
          symbol,
          bb.middle
        ),

      bollingerUpper:
        priceRound(
          symbol,
          bb.upper
        ),

      bollingerLower:
        priceRound(
          symbol,
          bb.lower
        ),

      bollingerWidthPct:
        round(
          bb.widthPct,
          4
        ),

      bollingerPosition:
        round(
          bb.position,
          3
        ),

      atrPercentile:
        round(
          atrPct,
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
          eq.equalHigh
        ),

      equalLow:
        priceRound(
          symbol,
          eq.equalLow
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
                )
            }
          : null,

      orderBlock:
        (() => {
          const ob =
            detectOrderBlock(
              candles,
              event.bos
            );

          return ob
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
                  )
              }
            : null;
        })(),

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
          swings.highs.at(-1)?.price
        ),

      lastSwingLow:
        priceRound(
          symbol,
          swings.lows.at(-1)?.price
        )
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
          c => ({
            t: c.t,

            o:
              priceRound(
                symbol,
                c.o
              ),

            h:
              priceRound(
                symbol,
                c.h
              ),

            l:
              priceRound(
                symbol,
                c.l
              ),

            c:
              priceRound(
                symbol,
                c.c
              )
          })
        )
  };
}

function sessionNameAtUtcHour(h) {
  if (h < 7) {
    return "ASIA";
  }

  if (h < 12) {
    return "LONDON";
  }

  if (h < 16) {
    return "LONDON_NEW_YORK_OVERLAP";
  }

  if (h < 21) {
    return "NEW_YORK";
  }

  return "TRANSITION";
}

function currentSession() {
  return sessionNameAtUtcHour(
    new Date()
      .getUTCHours()
  );
}

function utcDateKey(datetime) {
  const ms =
    parseUTC(datetime);

  if (
    !Number.isFinite(ms)
  ) {
    return null;
  }

  return new Date(ms)
    .toISOString()
    .slice(0, 10);
}

function buildDayLevels(candles) {
  const groups =
    new Map();

  for (
    const c of
    candles.slice(-700)
  ) {
    const key =
      utcDateKey(c.t);

    if (!key) {
      continue;
    }

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
      .push(c);
  }

  const keys =
    [...groups.keys()]
      .sort();

  if (!keys.length) {
    return {
      currentDay: null,
      previousDay: null
    };
  }

  const make =
    key => {
      const group =
        groups.get(key) ||
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
              x => x.h
            )
          ),

        low:
          Math.min(
            ...group.map(
              x => x.l
            )
          ),

        close:
          group.at(-1).c
      };
    };

  const currentKey =
    keys.at(-1);

  const previousKey =
    keys.length >= 2
      ? keys.at(-2)
      : null;

  return {
    currentDay:
      make(currentKey),

    previousDay:
      previousKey
        ? make(
            previousKey
          )
        : null
  };
}

function buildCurrentSessionLevels(candles) {
  if (!candles.length) {
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
      )
      .getUTCHours()
    );

  const group =
    [];

  for (
    let i =
      candles.length - 1;

    i >= 0;

    i--
  ) {
    const ms =
      parseUTC(
        candles[i].t
      );

    if (
      !Number.isFinite(ms)
    ) {
      continue;
    }

    const name =
      sessionNameAtUtcHour(
        new Date(ms)
          .getUTCHours()
      );

    if (
      name !== session
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
          x => x.h
        )
      ),

    low:
      Math.min(
        ...group.map(
          x => x.l
        )
      ),

    close:
      group.at(-1).c,

    bars:
      group.length
  };
}

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
          .atr14 || 0
      ),

      Math.abs(price) *
      0.0001
    );

  const tolerance =
    Math.max(
      atr5 * 0.10,
      Math.abs(price) *
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
        Number(value);

      if (
        !Number.isFinite(n) ||
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
          n > price
            ? "BUY_SIDE"
            : "SELL_SIDE",

        distance:
          Math.abs(
            n - price
          ),

        distanceAtr:
          atr5 > 0
            ? Math.abs(
                n - price
              ) /
              atr5
            : null
      });
    };

  addPool(
    packet.M5.ict.equalHigh,
    "M5 equal high",
    "M5",
    "EQUAL_HIGH"
  );

  addPool(
    packet.M5.ict.equalLow,
    "M5 equal low",
    "M5",
    "EQUAL_LOW"
  );

  addPool(
    packet.M15.ict.equalHigh,
    "M15 equal high",
    "M15",
    "EQUAL_HIGH"
  );

  addPool(
    packet.M15.ict.equalLow,
    "M15 equal low",
    "M15",
    "EQUAL_LOW"
  );

  addPool(
    packet.M5.ict.lastSwingHigh,
    "M5 swing high",
    "M5",
    "SWING_HIGH"
  );

  addPool(
    packet.M5.ict.lastSwingLow,
    "M5 swing low",
    "M5",
    "SWING_LOW"
  );

  addPool(
    packet.M15.ict.lastSwingHigh,
    "M15 swing high",
    "M15",
    "SWING_HIGH"
  );

  addPool(
    packet.M15.ict.lastSwingLow,
    "M15 swing low",
    "M15",
    "SWING_LOW"
  );

  addPool(
    packet.H1.ict.lastSwingHigh,
    "H1 swing high",
    "H1",
    "SWING_HIGH"
  );

  addPool(
    packet.H1.ict.lastSwingLow,
    "H1 swing low",
    "H1",
    "SWING_LOW"
  );

  addPool(
    packet.M15.range.high,
    "M15 range high",
    "M15",
    "RANGE_HIGH"
  );

  addPool(
    packet.M15.range.low,
    "M15 range low",
    "M15",
    "RANGE_LOW"
  );

  addPool(
    packet.H1.range.high,
    "H1 range high",
    "H1",
    "RANGE_HIGH"
  );

  addPool(
    packet.H1.range.low,
    "H1 range low",
    "H1",
    "RANGE_LOW"
  );

  if (
    day.previousDay
  ) {
    addPool(
      day.previousDay.high,
      "Previous day high",
      "DAILY",
      "PDH"
    );

    addPool(
      day.previousDay.low,
      "Previous day low",
      "DAILY",
      "PDL"
    );
  }

  if (
    day.currentDay
  ) {
    addPool(
      day.currentDay.high,
      "Current day high",
      "DAILY",
      "CDH"
    );

    addPool(
      day.currentDay.low,
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
    const p of rawPools
  ) {
    if (
      pools.some(
        x =>
          Math.abs(
            x.price -
            p.price
          ) <=
          tolerance &&
          x.side ===
          p.side
      )
    ) {
      continue;
    }

    pools.push({
      ...p,

      price:
        priceRound(
          symbol,
          p.price
        ),

      distance:
        priceRound(
          symbol,
          p.distance
        ),

      distanceAtr:
        round(
          p.distanceAtr,
          2
        )
    });
  }

  const buySide =
    pools
      .filter(
        x =>
          x.side ===
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
        x =>
          x.side ===
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
        12
      ),

    previousDay:
      day.previousDay
        ? {
            high:
              priceRound(
                symbol,
                day.previousDay.high
              ),

            low:
              priceRound(
                symbol,
                day.previousDay.low
              ),

            close:
              priceRound(
                symbol,
                day.previousDay.close
              )
          }
        : null,

    currentDay:
      day.currentDay
        ? {
            open:
              priceRound(
                symbol,
                day.currentDay.open
              ),

            high:
              priceRound(
                symbol,
                day.currentDay.high
              ),

            low:
              priceRound(
                symbol,
                day.currentDay.low
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
        packet.M5.ict.sweep,

      M15:
        packet.M15.ict.sweep
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

function detectRegimeDetails(packet) {
  const adxVal =
    Number(
      packet.M15
        .indicators
        .adx14 || 0
    );

  const atrVal =
    Number(
      packet.M15
        .indicators
        .atr14 || 0
    );

  const atrPct =
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
      packet.M15.range.high
    ) -
    Number(
      packet.M15.range.low
    );

  const rangeAtr =
    atrVal > 0
      ? range / atrVal
      : null;

  const h1 =
    packet.H1.bias;

  const m15 =
    packet.M15.bias;

  const m5 =
    packet.M5.bias;

  const alignedBull =
    h1 === "BULLISH" &&
    m15 === "BULLISH";

  const alignedBear =
    h1 === "BEARISH" &&
    m15 === "BEARISH";

  const hardConflict =
    (
      h1 === "BULLISH" &&
      m15 === "BEARISH"
    ) ||
    (
      h1 === "BEARISH" &&
      m15 === "BULLISH"
    );

  const bos =
    packet.M15.ict.bos;

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
    atrPct >= 85
  ) {
    volatility =
      "EXTREME";
  } else if (
    atrPct >= 65
  ) {
    volatility =
      "HIGH";
  } else if (
    atrPct <= 25
  ) {
    volatility =
      "LOW";
  }

  if (
    alignedBull &&
    adxVal >= 24
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
            adxVal - 24
          ) *
          1.1
        ),
        68,
        92
      );

    notes.push(
      "H1 and M15 bullish with trend-strength confirmation."
    );
  } else if (
    alignedBear &&
    adxVal >= 24
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
            adxVal - 24
          ) *
          1.1
        ),
        68,
        92
      );

    notes.push(
      "H1 and M15 bearish with trend-strength confirmation."
    );
  }

  if (
    bos ===
      "BULLISH_BOS" &&
    h1 !==
      "BEARISH" &&
    adxVal >= 19 &&
    atrPct >= 45
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
            adxVal - 19
          ) *
          0.8
        ),
        72,
        92
      );

    notes.push(
      "M15 bullish BOS with acceptable expansion."
    );
  } else if (
    bos ===
      "BEARISH_BOS" &&
    h1 !==
      "BULLISH" &&
    adxVal >= 19 &&
    atrPct >= 45
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
            adxVal - 19
          ) *
          0.8
        ),
        72,
        92
      );

    notes.push(
      "M15 bearish BOS with acceptable expansion."
    );
  } else if (
    adxVal < 17 &&
    Number.isFinite(
      rangeAtr
    ) &&
    rangeAtr <= 5.2
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
    adxVal < 19 &&
    name === "MIXED"
  ) {
    name =
      "RANGE";

    trend =
      "NEUTRAL";

    quality =
      44;

    notes.push(
      "Weak directional strength; range conditions dominate."
    );
  }

  if (
    atrPct >= 90 &&
    hardConflict
  ) {
    name =
      "HIGH_VOLATILITY_CHOP";

    trend =
      "NEUTRAL";

    quality =
      28;

    notes.push(
      "Extreme volatility with H1/M15 directional conflict."
    );
  }

  if (
    hardConflict &&
    name === "MIXED"
  ) {
    name =
      "REVERSAL_RISK";

    quality =
      42;

    notes.push(
      "H1 and M15 disagree; reversal or transition risk is elevated."
    );
  }

  if (
    m5 !== "NEUTRAL" &&
    m15 !== "NEUTRAL" &&
    m5 !== m15
  ) {
    notes.push(
      "M5 is currently counter to M15."
    );

    quality =
      Math.max(
        25,
        quality - 6
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
        atrPct,
        1
      ),

    adx:
      round(
        adxVal,
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

function detectRegime(packet) {
  return detectRegimeDetails(
    packet
  ).name;
}

function biasSign(value) {
  if (
    value === "BULLISH" ||
    value === "HH/HL" ||
    value === "BULLISH_BOS" ||
    value === "BULLISH_CHOCH"
  ) {
    return 1;
  }

  if (
    value === "BEARISH" ||
    value === "LH/LL" ||
    value === "BEARISH_BOS" ||
    value === "BEARISH_CHOCH"
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
  const s =
    clamp(
      Math.round(
        signal
      ),
      -100,
      100
    );

  const r =
    clamp(
      Math.round(
        reliability
      ),
      0,
      100
    );

  return {
    name,
    signal: s,
    reliability: r,

    bias:
      s >= 12
        ? "BULLISH"
        : s <= -12
          ? "BEARISH"
          : "NEUTRAL",

    confidence:
      clamp(
        Math.round(
          50 +
          Math.abs(s) *
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

function trendModule(packet) {
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
      slopeH1 * 9,
      -9,
      9
    );

  signal +=
    clamp(
      slopeM15 * 7,
      -7,
      7
    );

  signal =
    clamp(
      signal,
      -100,
      100
    );

  const reasons = [
    `H4 ${packet.H4.bias}`,
    `H1 ${packet.H1.bias}`,
    `M15 ${packet.M15.bias}`,
    `M5 ${packet.M5.bias}`
  ];

  return moduleResult(
    "trend",
    signal,
    54 +
    Math.abs(signal) *
    0.38,
    reasons
  );
}

function structureModule(packet) {
  let signal =
    0;

  signal +=
    biasSign(
      packet.H1.structure
    ) *
    28;

  signal +=
    biasSign(
      packet.M15.structure
    ) *
    24;

  signal +=
    biasSign(
      packet.M15.ict.bos
    ) *
    20;

  signal +=
    biasSign(
      packet.M15.ict.choch
    ) *
    14;

  signal +=
    biasSign(
      packet.M5.ict.bos
    ) *
    9;

  signal +=
    biasSign(
      packet.M5.ict.choch
    ) *
    5;

  const reasons = [
    `H1 structure ${packet.H1.structure}`,
    `M15 structure ${packet.M15.structure}`,
    `M15 ${packet.M15.ict.bos}`,
    `M15 ${packet.M15.ict.choch}`
  ];

  return moduleResult(
    "structure",
    signal,
    46 +
    Math.abs(signal) *
    0.47,
    reasons
  );
}

function liquidityModule(packet) {
  let signal =
    0;

  const reasons =
    [];

  if (
    packet.M5.ict.sweep.type ===
    "BULLISH_SELLSIDE_SWEEP"
  ) {
    signal += 35;

    reasons.push(
      "M5 sell-side liquidity sweep reclaimed."
    );
  }

  if (
    packet.M5.ict.sweep.type ===
    "BEARISH_BUYSIDE_SWEEP"
  ) {
    signal -= 35;

    reasons.push(
      "M5 buy-side liquidity sweep rejected."
    );
  }

  if (
    packet.M15.ict.sweep.type ===
    "BULLISH_SELLSIDE_SWEEP"
  ) {
    signal += 24;

    reasons.push(
      "M15 sell-side liquidity sweep reclaimed."
    );
  }

  if (
    packet.M15.ict.sweep.type ===
    "BEARISH_BUYSIDE_SWEEP"
  ) {
    signal -= 24;

    reasons.push(
      "M15 buy-side liquidity sweep rejected."
    );
  }

  if (
    packet.M15.ict.premiumDiscount ===
    "DISCOUNT"
  ) {
    signal += 13;

    reasons.push(
      "M15 trades in discount."
    );
  } else if (
    packet.M15.ict.premiumDiscount ===
    "PREMIUM"
  ) {
    signal -= 13;

    reasons.push(
      "M15 trades in premium."
    );
  }

  if (
    packet.M15.ict
      .bullishFVG
  ) {
    signal += 8;
  }

  if (
    packet.M15.ict
      .bearishFVG
  ) {
    signal -= 8;
  }

  if (
    packet.M15.ict
      .orderBlock?.type ===
    "BULLISH_OB"
  ) {
    signal += 9;
  }

  if (
    packet.M15.ict
      .orderBlock?.type ===
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
    const above =
      Number(
        map
          .nearestBuySide
          .distanceAtr
      );

    const below =
      Number(
        map
          .nearestSellSide
          .distanceAtr
      );

    if (
      Number.isFinite(
        above
      ) &&
      Number.isFinite(
        below
      )
    ) {
      if (
        above >= 1.4 &&
        below <= 0.8
      ) {
        signal += 5;

        reasons.push(
          "Upside liquidity room exceeds nearby downside pool distance."
        );
      } else if (
        below >= 1.4 &&
        above <= 0.8
      ) {
        signal -= 5;

        reasons.push(
          "Downside liquidity room exceeds nearby upside pool distance."
        );
      }
    }
  }

  return moduleResult(
    "liquidity",
    signal,
    44 +
    Math.abs(signal) *
    0.5,
    reasons
  );
}

function momentumModule(packet) {
  let signal =
    0;

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

  const hist5 =
    Number(
      packet.M5
        .indicators
        .macdHistogram ||
      0
    );

  const hist15 =
    Number(
      packet.M15
        .indicators
        .macdHistogram ||
      0
    );

  signal +=
    hist5 > 0
      ? 14
      : hist5 < 0
        ? -14
        : 0;

  signal +=
    hist15 > 0
      ? 10
      : hist15 < 0
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
        rsi5 - 50
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
      roc5 * 4,
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
      hist5 >= 0
        ? "positive"
        : "negative"
    }`
  );

  return moduleResult(
    "momentum",
    signal,
    48 +
    Math.abs(signal) *
    0.42,
    reasons
  );
}

function regimeModule(packet) {
  const r =
    packet.regimeDetails ||
    detectRegimeDetails(
      packet
    );

  let signal =
    0;

  if (
    r.name ===
    "TRENDING_BULLISH"
  ) {
    signal = 78;
  } else if (
    r.name ===
    "TRENDING_BEARISH"
  ) {
    signal = -78;
  } else if (
    r.name ===
    "BREAKOUT_BULLISH"
  ) {
    signal = 88;
  } else if (
    r.name ===
    "BREAKOUT_BEARISH"
  ) {
    signal = -88;
  } else if (
    r.name ===
    "REVERSAL_RISK"
  ) {
    signal =
      biasSign(
        packet.M15.ict.choch
      ) *
      42;
  } else if (
    r.name ===
    "MIXED"
  ) {
    signal =
      (
        biasSign(
          packet.H1.bias
        ) *
        20
      ) +
      (
        biasSign(
          packet.M15.bias
        ) *
        15
      );
  }

  return moduleResult(
    "regime",
    signal,
    r.quality,
    [
      r.name,
      ...(
        r.notes ||
        []
      ).slice(
        0,
        2
      )
    ]
  );
}

function sessionModule(packet) {
  const liquid =
    [
      "LONDON",
      "LONDON_NEW_YORK_OVERLAP",
      "NEW_YORK"
    ]
    .includes(
      packet.session
    );

  let signal =
    0;

  let reliability =
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
        : "Lower-liquidity context."
    ]
  );
}

function scoreTechnical(packet) {
  const modules = [
    trendModule(packet),
    structureModule(packet),
    liquidityModule(packet),
    momentumModule(packet),
    regimeModule(packet),
    sessionModule(packet)
  ];

  let weightedSignal =
    0;

  let weightedReliability =
    0;

  let denominator =
    0;

  for (
    const m of modules
  ) {
    const weight =
      Number(
        ENSEMBLE_WEIGHTS[
          m.name
        ] || 0
      );

    const reliabilityFactor =
      Math.max(
        0.25,
        m.reliability /
        100
      );

    weightedSignal +=
      m.signal *
      weight *
      reliabilityFactor;

    weightedReliability +=
      m.reliability *
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

  let quality =
    weightedReliability /
    Object.values(
      ENSEMBLE_WEIGHTS
    )
    .reduce(
      (s, x) =>
        s + x,
      0
    );

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
      m =>
        Math.abs(
          m.signal
        ) >=
        12
    );

  const agreeing =
    directionalModules
      .filter(
        m =>
          provisional ===
          "BUY"
            ? m.signal > 0
            : provisional ===
              "SELL"
              ? m.signal < 0
              : false
      )
      .length;

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
          .atr14 || 0
      ),

      Math.abs(price) *
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

  const rsiVal =
    Number(
      packet.M5
        .indicators
        .rsi14 ||
      50
    );

  if (
    stretch > 2.0
  ) {
    quality -= 15;

    penalties.push(
      `Price is ${round(stretch, 2)} ATR from M5 EMA20.`
    );
  } else if (
    stretch > 1.5
  ) {
    quality -= 8;

    penalties.push(
      `Price is extended ${round(stretch, 2)} ATR from M5 EMA20.`
    );
  }

  if (
    packet
      .regimeDetails
      ?.name ===
    "HIGH_VOLATILITY_CHOP"
  ) {
    quality -= 20;

    penalties.push(
      "High-volatility chop regime."
    );
  }

  if (
    [
      "RANGE",
      "COMPRESSION"
    ]
    .includes(
      packet
        .regimeDetails
        ?.name
    )
  ) {
    quality -= 8;

    penalties.push(
      `${packet.regimeDetails.name.toLowerCase()} regime reduces continuation quality.`
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
      "H4/H1 directional conflict."
    );
  }

  if (
    provisional ===
      "BUY" &&
    rsiVal > 76
  ) {
    quality -= 8;

    penalties.push(
      "M5 RSI is overbought for a fresh BUY."
    );
  }

  if (
    provisional ===
      "SELL" &&
    rsiVal < 24
  ) {
    quality -= 8;

    penalties.push(
      "M5 RSI is oversold for a fresh SELL."
    );
  }

  if (
    agreementPct < 50 &&
    directionalModules.length >=
      3
  ) {
    quality -= 10;

    penalties.push(
      `Only ${Math.round(agreementPct)}% of directional modules agree.`
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
      50
  ) {
    direction =
      provisional;
  }

  const impact =
    m =>
      Math.abs(
        m.signal
      ) *
      (
        ENSEMBLE_WEIGHTS[
          m.name
        ] ||
        0
      ) *
      (
        m.reliability /
        100
      );

  const ranked =
    [...modules]
      .sort(
        (a, b) =>
          impact(b) -
          impact(a)
      );

  const selectedReasons =
    [];

  for (
    const m of ranked
  ) {
    const aligned =
      direction ===
      "BUY"
        ? m.signal > 0
        : direction ===
          "SELL"
          ? m.signal < 0
          : Math.abs(
              m.signal
            ) >= 12;

    if (!aligned) {
      continue;
    }

    selectedReasons.push(
      `${m.name.toUpperCase()}: ${m.bias} (${m.confidence}% module confidence)`
    );

    if (
      m.reasons?.[0]
    ) {
      selectedReasons.push(
        m.reasons[0]
      );
    }

    if (
      selectedReasons.length >=
      8
    ) {
      break;
    }
  }

  if (
    direction ===
      "WAIT" &&
    !selectedReasons.length
  ) {
    selectedReasons.push(
      "Ensemble did not produce enough directional separation."
    );
  }

  return {
    direction,
    buyScore,
    sellScore,
    margin,
    score: best,

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

    reasons:
      selectedReasons.slice(
        0,
        8
      ),

    penalties,

    stretchAtr:
      round(
        stretch,
        2
      ),

    modules
  };
}

function candidateLiquidityTargets(
  direction,
  packet,
  entry
) {
  const levels =
    [];

  const add =
    (
      v,
      name,
      kind = "LEVEL"
    ) => {
      const n =
        Number(v);

      if (
        !Number.isFinite(n)
      ) {
        return;
      }

      if (
        direction ===
          "BUY" &&
        n > entry
      ) {
        levels.push({
          price: n,
          name,
          kind
        });
      }

      if (
        direction ===
          "SELL" &&
        n < entry
      ) {
        levels.push({
          price: n,
          name,
          kind
        });
      }
    };

  for (
    const p of
    packet
      .liquidityMap
      ?.pools ||
    []
  ) {
    add(
      p.price,
      p.label,
      p.kind
    );
  }

  add(
    packet.M15.ict.equalHigh,
    "M15 equal high",
    "EQUAL_HIGH"
  );

  add(
    packet.M15.ict.equalLow,
    "M15 equal low",
    "EQUAL_LOW"
  );

  add(
    packet.H1.ict.lastSwingHigh,
    "H1 swing high",
    "SWING_HIGH"
  );

  add(
    packet.H1.ict.lastSwingLow,
    "H1 swing low",
    "SWING_LOW"
  );

  add(
    packet.H1.range.high,
    "H1 range high",
    "RANGE_HIGH"
  );

  add(
    packet.H1.range.low,
    "H1 range low",
    "RANGE_LOW"
  );

  const tolerance =
    Math.abs(entry) *
    0.00003;

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
          tolerance
      )
    ) {
      continue;
    }

    unique.push(item);
  }

  return unique;
}

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

  const entry =
    Number(
      packet.currentPrice
    );

  const atr5 =
    Math.max(
      Number(
        packet.M5
          .indicators
          .atr14 || 0
      ),

      Math.abs(entry) *
      0.0001
    );

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
    stretchAtr > 2.05
  ) {
    return {
      valid: false,

      reason:
        `Price is stretched ${round(stretchAtr, 2)} ATR from M5 EMA20; wait for a retest instead of chasing.`,

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

  const regime =
    packet
      .regimeDetails
      ?.name ||
    packet.regime ||
    "MIXED";

  let stopAtrFactor =
    1.08;

  if (
    String(regime)
      .startsWith(
        "TRENDING_"
      )
  ) {
    stopAtrFactor =
      1.0;
  }

  if (
    String(regime)
      .startsWith(
        "BREAKOUT_"
      )
  ) {
    stopAtrFactor =
      1.12;
  }

  if (
    regime === "RANGE"
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
    atr5 * 0.20;

  let stop;

  if (
    direction ===
    "BUY"
  ) {
    const structureStop =
      Number.isFinite(
        swingLow
      ) &&
      swingLow <
        entry
        ? swingLow -
          buffer
        : entry -
          atr5 *
          1.25;

    stop =
      Math.min(
        entry -
        atr5 *
        stopAtrFactor,
        structureStop
      );
  } else {
    const structureStop =
      Number.isFinite(
        swingHigh
      ) &&
      swingHigh >
        entry
        ? swingHigh +
          buffer
        : entry +
          atr5 *
          1.25;

    stop =
      Math.max(
        entry +
        atr5 *
        stopAtrFactor,
        structureStop
      );
  }

  const risk =
    Math.abs(
      entry -
      stop
    );

  if (
    !Number.isFinite(risk) ||
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

  if (
    risk >
    atr5 * 2.8
  ) {
    return {
      valid: false,

      reason:
        `Logical stop is ${round(risk / atr5, 2)} ATR wide, above the 2.8 ATR safety limit.`,

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
    roomR < 0.80
  ) {
    return {
      valid: false,

      reason:
        `Nearest target liquidity (${nearest.name}) is only ${roomR.toFixed(2)}R away.`,

      entryType:
        "NONE"
    };
  }

  const sign =
    direction ===
    "BUY"
      ? 1
      : -1;

  const tp1Base =
    entry +
    sign *
    risk *
    TP1_R;

  const tp2Base =
    entry +
    sign *
    risk *
    TP2_R;

  let tp1 =
    tp1Base;

  let tp2 =
    tp2Base;

  if (
    nearest &&
    roomR >= 1.05 &&
    roomR < TP1_R
  ) {
    tp1 =
      nearest.price;
  }

  const secondTarget =
    targets.find(
      x =>
        Math.abs(
          x.price -
          entry
        ) /
        risk >=
        1.45
    );

  if (
    secondTarget
  ) {
    const secondR =
      Math.abs(
        secondTarget.price -
        entry
      ) /
      risk;

    if (
      secondR >= 1.45 &&
      secondR <=
        TP2_R * 1.35
    ) {
      tp2 =
        secondTarget.price;
    }
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
    rr1 < 1.0 ||
    rr2 < 1.4
  ) {
    return {
      valid: false,

      reason:
        `Risk/reward is too weak (TP1 ${round(rr1, 2)}R, TP2 ${round(rr2, 2)}R).`,

      entryType:
        "NONE"
    };
  }

  let entryType =
    "MARKET";

  if (
    String(regime)
      .startsWith(
        "BREAKOUT_"
      )
  ) {
    entryType =
      "BREAKOUT_CONTINUATION";
  } else if (
    stretchAtr >= 1.25
  ) {
    entryType =
      "CAUTION_EXTENDED";
  } else if (
    String(regime)
      .startsWith(
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
      `1:${round(rr2, 2)}`,

    riskDistance:
      priceRound(
        symbol,
        risk
      ),

    stopAtr:
      round(
        risk / atr5,
        2
      ),

    stretchAtr:
      round(
        stretchAtr,
        2
      ),

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
      checks.push({
        name,
        pass:
          Boolean(pass),
        detail
      });

      if (
        !pass &&
        hard
      ) {
        blockers.push(
          detail || name
        );
      }

      if (
        !pass &&
        !hard
      ) {
        warnings.push(
          detail || name
        );
      }
    };

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

    `Selected score ${technical.score}/100; minimum ${MIN_ENSEMBLE_SCORE}.`
  );

  addCheck(
    "DIRECTIONAL_MARGIN",

    technical.margin >=
      MIN_ENSEMBLE_MARGIN,

    `Directional separation ${technical.margin}; minimum ${MIN_ENSEMBLE_MARGIN}.`
  );

  addCheck(
    "ENSEMBLE_QUALITY",

    technical.quality >=
      MIN_ENSEMBLE_QUALITY,

    `Ensemble quality ${technical.quality}/100; minimum ${MIN_ENSEMBLE_QUALITY}.`
  );

  addCheck(
    "RISK_PLAN",

    Boolean(
      riskPlan.valid
    ),

    riskPlan.valid
      ? "Server risk plan is valid."
      : (
          riskPlan.reason ||
          "Risk plan invalid."
        )
  );

  const hostileRegime =
    packet
      .regimeDetails
      ?.name ===
    "HIGH_VOLATILITY_CHOP";

  addCheck(
    "REGIME_SAFETY",

    !hostileRegime,

    hostileRegime
      ? "High-volatility chop blocks new trades."
      : `${packet.regimeDetails?.name || packet.regime} regime accepted.`
  );

  const compressionWithoutBos =
    packet
      .regimeDetails
      ?.name ===
      "COMPRESSION" &&
    packet.M15.ict.bos ===
      "NONE";

  addCheck(
    "COMPRESSION_BREAK",

    !compressionWithoutBos,

    compressionWithoutBos
      ? "Compression has no M15 BOS yet; wait for expansion."
      : "No unresolved compression block."
  );

  addCheck(
    "SESSION_QUALITY",

    packet.session !==
      "TRANSITION",

    packet.session ===
      "TRANSITION"
      ? "Transition session: liquidity can be thinner; confidence should be reduced."
      : `${packet.session} session is active.`,

    false
  );

  addCheck(
    "DETERMINISTIC_MODE",

    true,

    "External AI approval filter disabled; MKAYFX deterministic ensemble is authoritative.",

    false
  );

  return {
    allowed:
      blockers.length ===
      0,

    state:
      blockers.length ===
      0
        ? "PRE_AI_APPROVED"
        : "BLOCKED",

    checks,
    warnings,
    blockers
  };
}

/* ======================================================
   EXTERNAL AI FILTER REMOVED
====================================================== */

function gradeFromConfidence(
  action,
  confidence
) {
  if (
    action === "WAIT"
  ) {
    return "WAIT";
  }

  if (
    confidence >= 90
  ) {
    return "A+";
  }

  if (
    confidence >= 84
  ) {
    return "A";
  }

  if (
    confidence >= 78
  ) {
    return "B+";
  }

  if (
    confidence >= 70
  ) {
    return "B";
  }

  return "C";
}

function timeframeStrength(
  snapshot
) {
  const adxVal =
    Number(
      snapshot
        .indicators
        ?.adx14 || 0
    );

  const slope =
    Math.abs(
      Number(
        snapshot
          .indicators
          ?.ema20SlopeAtr ||
        0
      )
    );

  const efficiency =
    Number(
      snapshot
        .indicators
        ?.candleEfficiency ||
      0
    );

  let strength =
    35 +
    Math.min(
      adxVal,
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
    snapshot.bias ===
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
    action !== "WAIT" &&
    !permission.allowed
  ) {
    rejectionReasons.push(
      ...permission.blockers
    );

    action =
      "WAIT";
  }

  if (
    action !== "WAIT" &&
    !riskPlan.valid
  ) {
    rejectionReasons.push(
      riskPlan.reason ||
      "Server risk plan rejected the setup."
    );

    action =
      "WAIT";
  }

  const techConfidence =
    technical.score;

  const qualityBoost =
    (
      technical.quality -
      50
    ) *
    0.12;

  const agreementBoost =
    (
      technical.agreementPct -
      50
    ) *
    0.08;

  let confidence =
    Math.round(
      technical.score *
      0.62 +

      technical.quality *
      0.23 +

      technical.agreementPct *
      0.15 +

      qualityBoost +

      agreementBoost
    );

  if (
    permission
      .warnings
      ?.length
  ) {
    confidence -=
      Math.min(
        4,
        permission
          .warnings
          .length
      );
  }

  if (
    action === "WAIT" &&
    rejectionReasons.length
  ) {
    confidence =
      Math.min(
        confidence,
        69
      );
  }

  confidence =
    clamp(
      confidence,

      action ===
      "WAIT"
        ? 30
        : 60,

      96
    );

  const directionText =
    technical.direction ===
    "WAIT"
      ? `No ensemble trade passed the ${MIN_ENSEMBLE_SCORE} score / ${MIN_ENSEMBLE_MARGIN} margin / ${MIN_ENSEMBLE_QUALITY} quality gates.`
      : `${technical.direction} ensemble candidate scored ${technical.score}/100, quality ${technical.quality}/100, agreement ${technical.agreementPct}%, with ${technical.margin}-point directional separation.`;

  const summary =
    action ===
    "WAIT"
      ? `${directionText}${rejectionReasons.length ? ` Final permission layer: ${rejectionReasons.join(" ")}` : ""}`
      : `${technical.direction} passed the ensemble, market-regime, liquidity, risk-plan and trade-permission engines.`;

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
    action !== "WAIT";

  return {
    action,
    confidence,

    setupGrade:
      gradeFromConfidence(
        action,
        confidence
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

    structure:
      `H4 ${packet.H4.structure}; H1 ${packet.H1.structure}; ` +
      `M15 ${packet.M15.structure}; M5 ${packet.M5.structure}.`,

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
      "External AI/news filter is disabled. MKAYFX is running deterministic ensemble mode.",

    entry:
      action === "WAIT"
        ? null
        : riskPlan.entry,

    stopLoss:
      action === "WAIT"
        ? null
        : riskPlan.stopLoss,

    takeProfit1:
      action === "WAIT"
        ? null
        : riskPlan.takeProfit1,

    takeProfit2:
      action === "WAIT"
        ? null
        : riskPlan.takeProfit2,

    riskReward:
      action === "WAIT"
        ? "—"
        : riskPlan.riskReward,

    entryType:
      action === "WAIT"
        ? (
            riskPlan.entryType ||
            "WAIT"
          )
        : riskPlan.entryType,

    invalidation:
      action === "BUY"
        ? `Bullish setup invalid below ${riskPlan.stopLoss}.`
        : action === "SELL"
          ? `Bearish setup invalid above ${riskPlan.stopLoss}.`
          : "No active setup.",

    nextTrigger:
      riskPlan.entryType ===
      "WAIT_RETEST"
        ? `Wait for price to retrace toward ${riskPlan.suggestedEntry || "the M5 EMA20 area"}, then rescan.`
        : action ===
          "WAIT"
          ? "Wait for a fresh ensemble-qualified setup with acceptable regime, liquidity room and risk permission."
          : `Maintain ${action} only while M5/M15 structure remains supportive; rescan after a material structure or news change.`,

    reasons: [
      ...technical.reasons
    ].slice(
      0,
      10
    ),

    risks: [
      ...technical.penalties,

      ...(
        permission.warnings ||
        []
      ),

      ...rejectionReasons
    ].slice(
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
      preAi:
        permission,

      mode:
        "DETERMINISTIC",

      aiReviewer:
        null,

      critic:
        null,

      finalAllowed,

      state:
        finalAllowed
          ? "APPROVED"
          : "BLOCKED",

      blockers:
        rejectionReasons
    },

    aiReview:
      null,

    aiCritic:
      null,

    riskPlan:
      riskPlan.valid
        ? riskPlan
        : {
            valid:
              false,

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
      getRequestBody(req);

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

    const currentPrice =
      rawM5.at(-1).c;

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

    const h4 =
      resample(
        m5,
        240
      );

    if (
      m5.length < 180 ||
      m15.length < 50 ||
      h1.length < 24 ||
      h4.length < 6
    ) {
      throw new Error(
        "Not enough completed candles for M5/M15/H1/H4 analysis."
      );
    }

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
      packet
        .regimeDetails
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

    /* GEMINI REVIEWER / CRITIC REMOVED */

    const analysis =
      buildFinalAnalysis(
        packet,
        technical,
        riskPlan,
        permission
      );

    const old =
      rawM5[
        Math.max(
          0,
          rawM5.length -
          13
        )
      ]?.c;

    const changePct =
      old
        ? (
            (
              currentPrice /
              old
            ) -
            1
          ) *
          100
        : 0;

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

        model:
          "MKAYFX Extreme Quant V4",

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
              c => ({
                t:
                  c.t,

                o:
                  priceRound(
                    symbol,
                    c.o
                  ),

                h:
                  priceRound(
                    symbol,
                    c.h
                  ),

                l:
                  priceRound(
                    symbol,
                    c.l
                  ),

                c:
                  priceRound(
                    symbol,
                    c.c
                  )
              })
            ),

        data_mode:
          "Twelve Data M5 + local M15/H1/H4 + deterministic ensemble/regime/liquidity/risk engine",

        cache_hit:
          cacheHit,

        guardrail_note:
          cacheHit
            ? "55-second candle cache used; no new Twelve Data request was needed."
            : "Fresh M5 data loaded; higher timeframes were generated locally.",

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
  } catch (error) {
    console.error(
      "MKAYFX V4 ERROR:",
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