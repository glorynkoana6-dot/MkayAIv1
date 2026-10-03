export const SYMBOL = "XAU/USD";
export const BASE_URL = "https://api.twelvedata.com";

export const ENGINE_VERSION = "15.0";

/* =========================================================
   MKAYFX MULTI-AGENT ENGINE V15

   AGENTS
   ------
   1. TREND
   2. MOMENTUM
   3. STRUCTURE
   4. LIQUIDITY
   5. REVERSAL
   6. BREAKOUT

   FINAL DECISION
   --------------
   Agents vote BUY / SELL / NEUTRAL.

   Risk gate then decides:
   BUY / SELL / WAIT.

   IMPORTANT
   ---------
   This exact strategy is used by:
   - live analysis
   - memory
   - research/backtest
========================================================= */


/* =========================================================
   UTILITIES
========================================================= */

export function envNumber(
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
    Math.min(max, n)
  );
}


export function finite(value) {
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


export function round(
  value,
  digits = 2
) {
  const n = finite(value);

  return n === null
    ? null
    : Number(n.toFixed(digits));
}


export function clamp(
  value,
  min,
  max
) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}


export function mean(values) {
  const clean =
    values.filter(Number.isFinite);

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


export function median(values) {
  const clean =
    values
      .filter(Number.isFinite)
      .sort((a, b) => a - b);

  if (!clean.length) {
    return null;
  }

  const middle =
    Math.floor(
      clean.length / 2
    );

  return clean.length % 2
    ? clean[middle]
    : (
        clean[middle - 1] +
        clean[middle]
      ) / 2;
}


export function parseUTC(value) {
  if (!value) {
    return NaN;
  }

  const clean =
    String(value)
      .trim()
      .replace(" ", "T");

  return new Date(
    /Z$|[+-]\d\d:\d\d$/.test(clean)
      ? clean
      : `${clean}Z`
  ).getTime();
}


/* =========================================================
   TIME / SESSION
========================================================= */

const FORMATTERS = new Map();


function formatter(timeZone) {
  if (!FORMATTERS.has(timeZone)) {
    FORMATTERS.set(
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

  return FORMATTERS.get(timeZone);
}


export function zoneParts(
  ms,
  timeZone
) {
  const map = {};

  for (
    const part of
    formatter(timeZone)
      .formatToParts(
        new Date(ms)
      )
  ) {
    if (part.type !== "literal") {
      map[part.type] =
        part.value;
    }
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    dateKey:
      `${map.year}-${map.month}-${map.day}`
  };
}


export function sessionFor(ms) {
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

export async function fetchJSON(
  url,
  timeout = 20000
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      timeout
    );

  try {
    const response =
      await fetch(
        url,
        {
          signal:
            controller.signal,
          cache:
            "no-store"
        }
      );

    const data =
      await response
        .json()
        .catch(() => ({}));

    if (
      !response.ok ||
      data.status === "error"
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


export async function fetchSeries(
  symbol,
  interval,
  outputsize
) {
  const key =
    process.env
      .TWELVE_DATA_API_KEY;

  if (!key) {
    throw new Error(
      "TWELVE_DATA_API_KEY is missing."
    );
  }

  const query =
    new URLSearchParams({
      symbol,
      interval,
      outputsize:
        String(outputsize),
      timezone: "UTC",
      format: "JSON",
      apikey: key
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
      `${symbol} ${interval} unavailable.`
    );
  }

  return data.values
    .map(x => ({
      t: x.datetime,
      o: Number(x.open),
      h: Number(x.high),
      l: Number(x.low),
      c: Number(x.close),
      v: Number(x.volume || 0)
    }))
    .filter(
      candle =>
        [
          candle.o,
          candle.h,
          candle.l,
          candle.c
        ].every(Number.isFinite)
    )
    .reverse();
}


export async function fetchSeriesSafe(
  symbol,
  interval,
  outputsize
) {
  try {
    return await fetchSeries(
      symbol,
      interval,
      outputsize
    );
  }
  catch {
    return [];
  }
}


export async function fetchPrice(
  symbol = SYMBOL
) {
  const key =
    process.env
      .TWELVE_DATA_API_KEY;

  if (!key) {
    throw new Error(
      "TWELVE_DATA_API_KEY is missing."
    );
  }

  const query =
    new URLSearchParams({
      symbol,
      dp: "5",
      apikey: key
    });

  const data =
    await fetchJSON(
      `${BASE_URL}/price?${query}`,
      10000
    );

  const price =
    finite(data.price);

  if (price === null) {
    throw new Error(
      `${symbol} price unavailable.`
    );
  }

  return price;
}


/* =========================================================
   CANDLES
========================================================= */

export function completed(
  candles,
  minutes,
  now = Date.now()
) {
  return candles.filter(
    candle => {
      const start =
        parseUTC(candle.t);

      return (
        Number.isFinite(start) &&
        start +
          minutes *
          60000 <=
          now
      );
    }
  );
}


export function resample(
  candles,
  minutes
) {
  const size =
    minutes * 60000;

  const required =
    Math.max(
      1,
      minutes / 5
    );

  const map =
    new Map();

  for (
    const candle of candles
  ) {
    const ms =
      parseUTC(candle.t);

    if (!Number.isFinite(ms)) {
      continue;
    }

    const bucket =
      Math.floor(
        ms / size
      ) * size;

    if (!map.has(bucket)) {
      map.set(bucket, []);
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
      const candle of raw
    ) {
      unique.set(
        parseUTC(candle.t),
        candle
      );
    }

    const group =
      [...unique.values()]
        .sort(
          (a, b) =>
            parseUTC(a.t) -
            parseUTC(b.t)
        );

    if (
      required > 1 &&
      group.length !== required
    ) {
      continue;
    }

    output.push({
      t:
        new Date(
          timestamp
        ).toISOString(),

      o: group[0].o,

      h:
        Math.max(
          ...group.map(x => x.h)
        ),

      l:
        Math.min(
          ...group.map(x => x.l)
        ),

      c:
        group.at(-1).c,

      v:
        group.reduce(
          (sum, x) =>
            sum + (x.v || 0),
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
   INDICATORS
========================================================= */

export function emaSeries(
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
    2 / (period + 1);

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
    let i = period;
    i < values.length;
    i++
  ) {
    current =
      (
        values[i] -
        current
      ) *
        multiplier +
      current;

    output.push(current);
  }

  return output;
}


export function ema(
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


export function rsi(
  closes,
  period = 14
) {
  if (
    closes.length <= period
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
    const move =
      closes[i] -
      closes[i - 1];

    gains +=
      Math.max(move, 0);

    losses +=
      Math.max(-move, 0);
  }

  let avgGain =
    gains / period;

  let avgLoss =
    losses / period;

  for (
    let i = period + 1;
    i < closes.length;
    i++
  ) {
    const move =
      closes[i] -
      closes[i - 1];

    avgGain =
      (
        avgGain *
          (period - 1) +
        Math.max(move, 0)
      ) /
      period;

    avgLoss =
      (
        avgLoss *
          (period - 1) +
        Math.max(-move, 0)
      ) /
      period;
  }

  if (avgLoss === 0) {
    return 100;
  }

  return (
    100 -
    100 /
      (
        1 +
        avgGain /
          avgLoss
      )
  );
}


export function trueRanges(
  candles
) {
  const output = [];

  for (
    let i = 1;
    i < candles.length;
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


export function atr(
  candles,
  period = 14
) {
  const values =
    trueRanges(candles);

  if (
    values.length < period
  ) {
    return null;
  }

  let current =
    mean(
      values.slice(
        0,
        period
      )
    );

  for (
    let i = period;
    i < values.length;
    i++
  ) {
    current =
      (
        current *
          (period - 1) +
        values[i]
      ) /
      period;
  }

  return current;
}


export function macdHistogram(
  closes
) {
  const fast =
    emaSeries(closes, 12);

  const slow =
    emaSeries(closes, 26);

  const line = [];

  for (
    let i = 0;
    i < closes.length;
    i++
  ) {
    if (
      fast[i] == null ||
      slow[i] == null
    ) {
      continue;
    }

    line.push(
      fast[i] -
      slow[i]
    );
  }

  if (line.length < 9) {
    return null;
  }

  const signal =
    ema(line, 9);

  return signal == null
    ? null
    : line.at(-1) -
      signal;
}


/* =========================================================
   MARKET STRUCTURE
========================================================= */

export function findSwings(
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
      if (j === i) {
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


export function structureLabel(
  swings
) {
  const highs =
    swings.highs.slice(-2);

  const lows =
    swings.lows.slice(-2);

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


export function genericSweep(
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
    last.h > high &&
    last.c < high
  ) {
    return {
      type:
        "BEARISH_BUYSIDE_SWEEP",
      level: high
    };
  }

  if (
    last.l < low &&
    last.c > low
  ) {
    return {
      type:
        "BULLISH_SELLSIDE_SWEEP",
      level: low
    };
  }

  return {
    type: "NONE",
    level: null
  };
}


export function displacement(
  candles
) {
  const candle =
    candles.at(-1);

  const a =
    atr(candles, 14);

  if (
    !candle ||
    !Number.isFinite(a) ||
    a <= 0
  ) {
    return {
      direction: "NONE",
      quality: 0
    };
  }

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
    );

  const bodyRatio =
    body / range;

  const rangeAtr =
    range / a;

  const closePosition =
    (
      candle.c -
        candle.l
    ) /
    range;

  let direction =
    "NONE";

  if (
    candle.c > candle.o &&
    bodyRatio >= 0.55 &&
    rangeAtr >= 0.70 &&
    closePosition >= 0.65
  ) {
    direction =
      "BULLISH";
  }

  if (
    candle.c < candle.o &&
    bodyRatio >= 0.55 &&
    rangeAtr >= 0.70 &&
    closePosition <= 0.35
  ) {
    direction =
      "BEARISH";
  }

  return {
    direction,

    quality:
      clamp(
        Math.round(
          bodyRatio * 55 +
          Math.min(
            rangeAtr,
            2
          ) * 22
        ),
        0,
        100
      )
  };
}


/* =========================================================
   SNAPSHOT
========================================================= */

export function snapshot(
  candles
) {
  if (
    !Array.isArray(candles) ||
    !candles.length
  ) {
    return {
      price: null,
      bias: "NEUTRAL",
      structure: "MIXED",
      momentum: "MIXED",

      indicators: {
        ema20: null,
        ema50: null,
        ema200: null,
        atr14: null,
        rsi14: null,
        macdHistogram: null
      },

      ict: {
        bos: "NONE",
        choch: "NONE",
        sweep: {
          type: "NONE",
          level: null
        },
        lastSwingHigh: null,
        lastSwingLow: null
      }
    };
  }

  const closes =
    candles.map(
      candle => candle.c
    );

  const price =
    closes.at(-1);

  const e20 =
    ema(closes, 20);

  const e50 =
    ema(closes, 50);

  const e200 =
    ema(closes, 200);

  const swings =
    findSwings(
      candles.slice(-80)
    );

  const structure =
    structureLabel(swings);

  const sweep =
    genericSweep(candles);

  const last =
    candles.at(-1);

  const previous =
    candles.at(-2);

  let bos =
    "NONE";

  let choch =
    "NONE";

  const swingHigh =
    swings.highs.at(-1);

  const swingLow =
    swings.lows.at(-1);

  if (
    swingHigh &&
    previous &&
    previous.c <=
      swingHigh.price &&
    last.c >
      swingHigh.price
  ) {
    bos =
      "BULLISH_BOS";

    if (
      structure === "LH/LL"
    ) {
      choch =
        "BULLISH_CHOCH";
    }
  }

  if (
    swingLow &&
    previous &&
    previous.c >=
      swingLow.price &&
    last.c <
      swingLow.price
  ) {
    bos =
      "BEARISH_BOS";

    if (
      structure === "HH/HL"
    ) {
      choch =
        "BEARISH_CHOCH";
    }
  }

  let bias =
    "NEUTRAL";

  if (
    Number.isFinite(e20) &&
    Number.isFinite(e50) &&
    price > e20 &&
    e20 > e50 &&
    (
      !Number.isFinite(e200) ||
      e50 > e200
    )
  ) {
    bias =
      "BULLISH";
  }

  if (
    Number.isFinite(e20) &&
    Number.isFinite(e50) &&
    price < e20 &&
    e20 < e50 &&
    (
      !Number.isFinite(e200) ||
      e50 < e200
    )
  ) {
    bias =
      "BEARISH";
  }

  const momentumMove =
    closes.length > 6
      ? closes.at(-1) -
        closes.at(-7)
      : 0;

  return {
    price:
      round(price, 2),

    bias,

    structure,

    momentum:
      momentumMove > 0
        ? "BULLISH"
        : momentumMove < 0
          ? "BEARISH"
          : "MIXED",

    displacement:
      displacement(candles),

    indicators: {
      ema20:
        round(e20, 2),

      ema50:
        round(e50, 2),

      ema200:
        round(e200, 2),

      atr14:
        round(
          atr(candles, 14),
          5
        ),

      rsi14:
        round(
          rsi(closes, 14),
          1
        ),

      macdHistogram:
        round(
          macdHistogram(closes),
          6
        )
    },

    ict: {
      bos,
      choch,

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
          swingHigh?.price,
          2
        ),

      lastSwingLow:
        round(
          swingLow?.price,
          2
        )
    }
  };
}


/* =========================================================
   REGIME
========================================================= */

export function detectRegime(
  candles
) {
  if (
    !Array.isArray(candles) ||
    candles.length < 60
  ) {
    return {
      type: "UNKNOWN",
      confidence: 0
    };
  }

  const closes =
    candles.map(
      candle => candle.c
    );

  const e20 =
    ema(closes, 20);

  const e50 =
    ema(closes, 50);

  const a =
    atr(candles, 14);

  if (
    !Number.isFinite(e20) ||
    !Number.isFinite(e50) ||
    !Number.isFinite(a) ||
    a <= 0
  ) {
    return {
      type: "UNKNOWN",
      confidence: 0
    };
  }

  const spread =
    Math.abs(
      e20 - e50
    ) / a;

  const recentMove =
    closes.length >= 7
      ? (
          closes.at(-1) -
          closes.at(-7)
        ) / a
      : 0;

  const ranges =
    candles
      .slice(-20)
      .map(
        candle =>
          candle.h -
          candle.l
      );

  const recentRange =
    mean(
      candles
        .slice(-5)
        .map(
          candle =>
            candle.h -
            candle.l
        )
    ) || a;

  const normalRange =
    mean(ranges) || a;

  const expansion =
    recentRange /
    Math.max(
      normalRange,
      1e-9
    );

  if (
    expansion >= 1.25 &&
    Math.abs(recentMove) >= 1
  ) {
    return {
      type:
        recentMove > 0
          ? "BULLISH_EXPANSION"
          : "BEARISH_EXPANSION",

      confidence:
        round(
          clamp(
            60 +
            Math.abs(
              recentMove
            ) * 8,
            55,
            95
          ),
          1
        )
    };
  }

  if (spread >= 0.65) {
    return {
      type:
        e20 > e50
          ? "BULLISH_TREND"
          : "BEARISH_TREND",

      confidence:
        round(
          clamp(
            55 +
            spread * 12,
            55,
            94
          ),
          1
        )
    };
  }

  if (
    spread < 0.25 &&
    Math.abs(recentMove) <
      0.55
  ) {
    return {
      type: "QUIET_CHOP",

      confidence:
        round(
          clamp(
            78 -
            spread * 30,
            55,
            90
          ),
          1
        )
    };
  }

  return {
    type: "RANGE",

    confidence:
      round(
        clamp(
          72 -
          spread * 15,
          50,
          88
        ),
        1
      )
  };
}


/* =========================================================
   AGENT HELPERS
========================================================= */

function vote(
  name,
  score,
  reasons = []
) {
  const clean =
    clamp(
      Number(score) || 0,
      -100,
      100
    );

  return {
    name,

    score:
      round(clean, 1),

    direction:
      clean >= 20
        ? "BUY"
        : clean <= -20
          ? "SELL"
          : "NEUTRAL",

    confidence:
      round(
        Math.abs(clean),
        1
      ),

    reasons
  };
}


function signOf(value) {
  if (
    [
      "BUY",
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
      "SELL",
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
   AGENT 1 — TREND
========================================================= */

function trendAgent(
  m5,
  m15,
  h1
) {
  const s5 =
    snapshot(m5);

  const s15 =
    snapshot(m15);

  const s1h =
    snapshot(h1);

  let score = 0;
  const reasons = [];

  score +=
    signOf(s1h.bias) * 40;

  score +=
    signOf(s15.bias) * 35;

  score +=
    signOf(s5.bias) * 25;

  if (
    s1h.bias ===
      s15.bias &&
    s15.bias ===
      s5.bias &&
    s5.bias !==
      "NEUTRAL"
  ) {
    reasons.push(
      "H1, M15 and M5 trend aligned."
    );
  }

  return vote(
    "TREND",
    score,
    reasons
  );
}


/* =========================================================
   AGENT 2 — MOMENTUM
========================================================= */

function momentumAgent(m5) {
  const closes =
    m5.map(x => x.c);

  const valueRsi =
    rsi(closes, 14);

  const macd =
    macdHistogram(closes);

  const a =
    atr(m5, 14);

  let score = 0;
  const reasons = [];

  if (
    Number.isFinite(valueRsi)
  ) {
    score +=
      clamp(
        (
          valueRsi - 50
        ) * 2.2,
        -45,
        45
      );
  }

  if (
    Number.isFinite(macd) &&
    Number.isFinite(a) &&
    a > 0
  ) {
    score +=
      clamp(
        macd /
          a *
          500,
        -35,
        35
      );
  }

  if (
    closes.length >= 7 &&
    Number.isFinite(a) &&
    a > 0
  ) {
    score +=
      clamp(
        (
          closes.at(-1) -
          closes.at(-7)
        ) /
          a *
          12,
        -20,
        20
      );
  }

  reasons.push(
    `RSI ${round(valueRsi, 1)}.`
  );

  return vote(
    "MOMENTUM",
    score,
    reasons
  );
}


/* =========================================================
   AGENT 3 — STRUCTURE
========================================================= */

function structureAgent(
  m5,
  m15
) {
  const s5 =
    snapshot(m5);

  const s15 =
    snapshot(m15);

  let score = 0;
  const reasons = [];

  score +=
    signOf(
      s15.structure
    ) * 35;

  score +=
    signOf(
      s5.structure
    ) * 30;

  score +=
    signOf(
      s5.ict.bos
    ) * 22;

  score +=
    signOf(
      s5.ict.choch
    ) * 13;

  reasons.push(
    `M15 ${s15.structure}; M5 ${s5.structure}.`
  );

  if (
    s5.ict.bos !==
    "NONE"
  ) {
    reasons.push(
      s5.ict.bos
    );
  }

  if (
    s5.ict.choch !==
    "NONE"
  ) {
    reasons.push(
      s5.ict.choch
    );
  }

  return vote(
    "STRUCTURE",
    score,
    reasons
  );
}


/* =========================================================
   AGENT 4 — LIQUIDITY
========================================================= */

function liquidityAgent(m5) {
  const sweep =
    genericSweep(
      m5,
      20
    );

  const disp =
    displacement(m5);

  let score = 0;
  const reasons = [];

  if (
    sweep.type ===
    "BULLISH_SELLSIDE_SWEEP"
  ) {
    score += 70;

    reasons.push(
      "Sell-side liquidity swept and reclaimed."
    );
  }

  if (
    sweep.type ===
    "BEARISH_BUYSIDE_SWEEP"
  ) {
    score -= 70;

    reasons.push(
      "Buy-side liquidity swept and rejected."
    );
  }

  if (
    disp.direction ===
    "BULLISH"
  ) {
    score +=
      disp.quality * 0.3;
  }

  if (
    disp.direction ===
    "BEARISH"
  ) {
    score -=
      disp.quality * 0.3;
  }

  return vote(
    "LIQUIDITY",
    score,
    reasons
  );
}


/* =========================================================
   AGENT 5 — REVERSAL
========================================================= */

function reversalAgent(m5) {
  const closes =
    m5.map(x => x.c);

  const valueRsi =
    rsi(closes, 14);

  const e20 =
    ema(closes, 20);

  const a =
    atr(m5, 14);

  const sweep =
    genericSweep(m5);

  let score = 0;
  const reasons = [];

  if (
    !Number.isFinite(a) ||
    a <= 0 ||
    !Number.isFinite(e20)
  ) {
    return vote(
      "REVERSAL",
      0,
      ["Reversal inputs unavailable."]
    );
  }

  const distance =
    (
      closes.at(-1) -
      e20
    ) / a;

  if (
    distance <= -1.15 &&
    valueRsi <= 38
  ) {
    score += 55;

    reasons.push(
      "Oversold ATR extension."
    );
  }

  if (
    distance >= 1.15 &&
    valueRsi >= 62
  ) {
    score -= 55;

    reasons.push(
      "Overbought ATR extension."
    );
  }

  if (
    sweep.type ===
    "BULLISH_SELLSIDE_SWEEP"
  ) {
    score += 30;
  }

  if (
    sweep.type ===
    "BEARISH_BUYSIDE_SWEEP"
  ) {
    score -= 30;
  }

  return vote(
    "REVERSAL",
    score,
    reasons
  );
}


/* =========================================================
   AGENT 6 — BREAKOUT
========================================================= */

function breakoutAgent(m5) {
  if (m5.length < 30) {
    return vote(
      "BREAKOUT",
      0,
      ["Insufficient breakout data."]
    );
  }

  const last =
    m5.at(-1);

  const previous =
    m5.slice(-21, -1);

  const high =
    Math.max(
      ...previous.map(x => x.h)
    );

  const low =
    Math.min(
      ...previous.map(x => x.l)
    );

  const a =
    atr(m5, 14);

  if (
    !Number.isFinite(a) ||
    a <= 0
  ) {
    return vote(
      "BREAKOUT",
      0
    );
  }

  if (last.c > high) {
    return vote(
      "BREAKOUT",
      clamp(
        60 +
        (
          last.c - high
        ) /
          a *
          30,
        0,
        100
      ),
      [
        "M5 closed above recent range."
      ]
    );
  }

  if (last.c < low) {
    return vote(
      "BREAKOUT",
      -clamp(
        60 +
        (
          low - last.c
        ) /
          a *
          30,
        0,
        100
      ),
      [
        "M5 closed below recent range."
      ]
    );
  }

  return vote(
    "BREAKOUT",
    0,
    ["No confirmed breakout."]
  );
}


/* =========================================================
   ASSET PROFILES
========================================================= */

function profileFor(
  symbol,
  regime
) {
  const btc =
    symbol === "BTC/USD";

  const trending =
    regime.type.includes(
      "TREND"
    ) ||
    regime.type.includes(
      "EXPANSION"
    );

  if (btc) {
    return {
      minScore:
        trending
          ? 50
          : 62,

      minAgreement:
        trending
          ? 3
          : 4,

      maxOpposition: 1,

      stopAtr:
        trending
          ? 1.15
          : 1,

      targetR:
        trending
          ? 2
          : 1.6,

      weights: {
        TREND: 1.30,
        MOMENTUM: 1.15,
        STRUCTURE: 1.15,
        LIQUIDITY: 0.85,
        REVERSAL: 0.65,
        BREAKOUT: 1.20
      }
    };
  }

  return {
    minScore:
      trending
        ? 48
        : 58,

    minAgreement:
      trending
        ? 3
        : 4,

    maxOpposition: 1,

    stopAtr:
      trending
        ? 1
        : 0.9,

    targetR:
      trending
        ? 2
        : 1.6,

    weights: {
      TREND: 1.20,
      MOMENTUM: 1,
      STRUCTURE: 1.20,
      LIQUIDITY: 1.20,
      REVERSAL: 0.85,
      BREAKOUT: 1
    }
  };
}


/* =========================================================
   MULTI-AGENT STRATEGY
========================================================= */

export function multiAgentStrategy({
  symbol = "XAU/USD",
  m5,
  m15,
  h1
}) {
  if (
    !Array.isArray(m5) ||
    !Array.isArray(m15) ||
    !Array.isArray(h1)
  ) {
    return {
      signal: "WAIT",
      direction: null,
      qualified: false,
      score: 0,
      setup:
        "MULTI_AGENT_V15",
      reasons: [
        "Missing timeframe data."
      ],
      agents: {}
    };
  }

  if (
    m5.length < 210 ||
    m15.length < 60 ||
    h1.length < 60
  ) {
    return {
      signal: "WAIT",
      direction: null,
      qualified: false,
      score: 0,
      setup:
        "MULTI_AGENT_V15",
      reasons: [
        "Not enough historical candles."
      ],
      agents: {}
    };
  }

  const regime =
    detectRegime(m5);

  const profile =
    profileFor(
      symbol,
      regime
    );

  const agentList = [
    trendAgent(
      m5,
      m15,
      h1
    ),

    momentumAgent(m5),

    structureAgent(
      m5,
      m15
    ),

    liquidityAgent(m5),

    reversalAgent(m5),

    breakoutAgent(m5)
  ];

  const agents =
    Object.fromEntries(
      agentList.map(
        agent => [
          agent.name,
          agent
        ]
      )
    );

  let weightedTotal = 0;
  let weightTotal = 0;

  for (
    const agent of agentList
  ) {
    const weight =
      profile.weights[
        agent.name
      ] ?? 1;

    weightedTotal +=
      agent.score * weight;

    weightTotal +=
      Math.abs(weight);
  }

  const consensus =
    weightTotal
      ? weightedTotal /
        weightTotal
      : 0;

  const candidateDirection =
    consensus > 0
      ? "BUY"
      : consensus < 0
        ? "SELL"
        : null;

  const agreeing =
    candidateDirection
      ? agentList.filter(
          agent =>
            agent.direction ===
            candidateDirection
        ).length
      : 0;

  const opposing =
    candidateDirection
      ? agentList.filter(
          agent =>
            agent.direction !==
              "NEUTRAL" &&
            agent.direction !==
              candidateDirection
        ).length
      : 0;

  const score =
    round(
      Math.abs(consensus),
      1
    );

  const hardChop =
    regime.type ===
      "QUIET_CHOP";

  const enoughScore =
    score >=
    profile.minScore;

  const enoughAgreement =
    agreeing >=
    profile.minAgreement;

  const oppositionOkay =
    opposing <=
    profile.maxOpposition;

  const regimeAllowed =
    !hardChop;

  const qualified =
    Boolean(
      candidateDirection &&
      enoughScore &&
      enoughAgreement &&
      oppositionOkay &&
      regimeAllowed
    );

  const signal =
    qualified
      ? candidateDirection
      : "WAIT";

  const reasons = [
    `Regime ${regime.type} (${regime.confidence}%).`,
    `Consensus ${round(consensus, 1)}.`,
    `${agreeing}/6 agents agree ${candidateDirection || "NEUTRAL"}.`,
    `${opposing}/6 agents oppose.`,
    `Required score ${profile.minScore}.`,
    `Required agreement ${profile.minAgreement}/6.`
  ];

  if (hardChop) {
    reasons.push(
      "Quiet chop blocked by risk gate."
    );
  }

  if (!enoughScore) {
    reasons.push(
      "Consensus strength below requirement."
    );
  }

  if (!enoughAgreement) {
    reasons.push(
      "Not enough agent agreement."
    );
  }

  if (!oppositionOkay) {
    reasons.push(
      "Too much opposing evidence."
    );
  }

  if (qualified) {
    reasons.push(
      `${signal} passed V15 consensus and risk gates.`
    );
  }

  const checks = {
    regimeAllowed,
    enoughScore,
    enoughAgreement,
    oppositionOkay
  };

  return {
    signal,

    direction:
      candidateDirection,

    qualified,

    setup:
      "MULTI_AGENT_V15",

    score,

    signedScore:
      round(
        consensus,
        1
      ),

    regime,

    profile,

    stopAtr:
      profile.stopAtr,

    targetR:
      profile.targetR,

    agreement: {
      agreeing,
      opposing,
      total:
        agentList.length
    },

    checks,

    agents,

    reasons,

    indicators: {
      m5Atr:
        round(
          atr(m5, 14),
          5
        ),

      m5Rsi:
        round(
          rsi(
            m5.map(x => x.c),
            14
          ),
          1
        )
    }
  };
}


/* =========================================================
   COMPATIBILITY ALIAS

   Existing files calling the old function won't crash.
========================================================= */

export function simpleTrendPullbackStrategy(
  args
) {
  return multiAgentStrategy({
    symbol:
      args?.symbol ||
      "XAU/USD",

    m5:
      args?.m5,

    m15:
      args?.m15,

    h1:
      args?.h1
  });
}


/* =========================================================
   MEMORY FEATURE STATE
========================================================= */

export function buildFeatureState(
  candles,
  strategy,
  regime
) {
  if (
    !Array.isArray(candles) ||
    candles.length < 60
  ) {
    return null;
  }

  const closes =
    candles.map(x => x.c);

  const a =
    atr(candles, 14);

  const e20 =
    ema(closes, 20);

  const e50 =
    ema(closes, 50);

  if (
    !Number.isFinite(a) ||
    a <= 0 ||
    !Number.isFinite(e20) ||
    !Number.isFinite(e50)
  ) {
    return null;
  }

  const valueRsi =
    rsi(closes, 14);

  return {
    candleTime:
      candles.at(-1).t,

    session:
      sessionFor(
        parseUTC(
          candles.at(-1).t
        )
      ),

    regime:
      regime.type,

    vector: [
      clamp(
        (
          closes.at(-1) -
          e20
        ) / a,
        -4,
        4
      ),

      clamp(
        (
          e20 - e50
        ) / a,
        -4,
        4
      ),

      clamp(
        (
          (valueRsi ?? 50) -
          50
        ) / 20,
        -2.5,
        2.5
      ),

      clamp(
        (
          strategy?.signedScore ??
          0
        ) / 100,
        -1,
        1
      ),

      clamp(
        (
          strategy?.agreement
            ?.agreeing ??
          0
        ) / 6,
        0,
        1
      )
    ],

    features: {
      close:
        closes.at(-1),

      atr: a,

      rsi:
        valueRsi,

      strategySignal:
        strategy?.signal ||
        "WAIT",

      strategyDirection:
        strategy?.direction ||
        null,

      strategyQualified:
        Boolean(
          strategy?.qualified
        ),

      strategyScore:
        strategy?.score ??
        0,

      signedScore:
        strategy?.signedScore ??
        0,

      stopAtr:
        strategy?.stopAtr ??
        1,

      targetR:
        strategy?.targetR ??
        2,

      agreement:
        strategy?.agreement ??
        null,

      checks:
        strategy?.checks ??
        {},

      agents:
        strategy?.agents ??
        {},

      componentScores: {
        strategy:
          strategy?.signedScore ??
          0
      }
    }
  };
}


/* =========================================================
   OLD MEMORY COMPATIBILITY
========================================================= */

export function basicComponentScores(
  candles
) {
  const snap =
    snapshot(candles);

  return {
    trend:
      signOf(
        snap.bias
      ) * 100,

    structure:
      signOf(
        snap.structure
      ) * 100,

    liquidity:
      snap.ict.sweep.type ===
        "BULLISH_SELLSIDE_SWEEP"
        ? 100
        : snap.ict.sweep.type ===
          "BEARISH_BUYSIDE_SWEEP"
          ? -100
          : 0,

    momentum:
      signOf(
        snap.momentum
      ) * 100,

    displacement:
      snap.displacement
        ?.direction ===
        "BULLISH"
        ? snap.displacement
            .quality
        : snap.displacement
            ?.direction ===
          "BEARISH"
          ? -snap.displacement
              .quality
          : 0,

    breakout: 0,
    cross: 0,
    meanReversion: 0
  };
}


export function ensembleScore(
  components
) {
  if (
    Number.isFinite(
      finite(
        components?.strategy
      )
    )
  ) {
    return clamp(
      finite(
        components.strategy
      ),
      -100,
      100
    );
  }

  const values =
    Object.values(
      components || {}
    )
      .map(finite)
      .filter(
        value =>
          value !== null
      );

  return values.length
    ? clamp(
        mean(values),
        -100,
        100
      )
    : 0;
}


/* =========================================================
   FUTURE PATH
========================================================= */

export function buildFuturePath(
  candles,
  index,
  bars = 24
) {
  const context =
    candles.slice(
      Math.max(
        0,
        index - 60
      ),
      index + 1
    );

  const a =
    atr(context, 14);

  const entry =
    candles[index]?.c;

  if (
    !Number.isFinite(a) ||
    a <= 0 ||
    !Number.isFinite(entry)
  ) {
    return null;
  }

  const future =
    candles.slice(
      index + 1,
      index + 1 + bars
    );

  if (
    future.length < bars
  ) {
    return null;
  }

  return future.map(
    candle => ({
      h:
        round(
          (
            candle.h -
            entry
          ) / a,
          6
        ),

      l:
        round(
          (
            candle.l -
            entry
          ) / a,
          6
        ),

      c:
        round(
          (
            candle.c -
            entry
          ) / a,
          6
        )
    })
  );
}


/* =========================================================
   OUTCOME
========================================================= */

export function evaluatePath(
  path,
  direction,
  stopAtr = 1,
  targetR = 2,
  costAtr =
    envNumber(
      "ESTIMATED_COST_ATR",
      0.03,
      0,
      0.5
    )
) {
  if (
    !Array.isArray(path) ||
    !path.length
  ) {
    return null;
  }

  const sign =
    direction === "BUY"
      ? 1
      : -1;

  const targetAtr =
    stopAtr * targetR;

  let resultR = null;
  let outcome =
    "UNRESOLVED";

  let mfeR = 0;
  let maeR = 0;

  for (
    const point of path
  ) {
    const favorable =
      sign === 1
        ? point.h
        : -point.l;

    const adverse =
      sign === 1
        ? -point.l
        : point.h;

    mfeR =
      Math.max(
        mfeR,
        favorable / stopAtr
      );

    maeR =
      Math.max(
        maeR,
        adverse / stopAtr
      );

    const hitStop =
      sign === 1
        ? point.l <=
          -stopAtr
        : point.h >=
          stopAtr;

    const hitTarget =
      sign === 1
        ? point.h >=
          targetAtr
        : point.l <=
          -targetAtr;

    if (
      hitStop &&
      hitTarget
    ) {
      resultR = -1;
      outcome =
        "LOSS_AMBIGUOUS";
      break;
    }

    if (hitStop) {
      resultR = -1;
      outcome = "LOSS";
      break;
    }

    if (hitTarget) {
      resultR = targetR;
      outcome = "WIN";
      break;
    }
  }

  if (resultR === null) {
    const finalMove =
      path.at(-1)?.c ?? 0;

    resultR =
      clamp(
        sign *
          finalMove /
          stopAtr,
        -1,
        targetR
      );
  }

  const costR =
    costAtr /
    Math.max(
      stopAtr,
      0.01
    );

  resultR -= costR;

  return {
    resultR,
    outcome,
    mfeR,
    maeR,
    costR
  };
}