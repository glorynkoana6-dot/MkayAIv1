export const SYMBOL = "XAU/USD";
export const BASE_URL = "https://api.twelvedata.com";


/* =========================================================
   UTILITIES
========================================================= */

export function envNumber(
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


export function finite(value) {

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


export function round(
  value,
  digits = 2
) {

  const n =
    finite(value);

  return n === null
    ? null
    : Number(
        n.toFixed(digits)
      );
}


export function clamp(
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


export function mean(values) {

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
    (a, b) =>
      a + b,
    0
  ) /
  clean.length;
}


export function median(values) {

  const clean =
    values
      .filter(Number.isFinite)
      .sort(
        (a, b) =>
          a - b
      );

  if (
    !clean.length
  ) {
    return null;
  }

  const mid =
    Math.floor(
      clean.length /
      2
    );

  return clean.length % 2
    ? clean[mid]
    : (
        clean[mid - 1] +
        clean[mid]
      ) /
      2;
}


export function percentileRank(
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

  return (
    clean.filter(
      v =>
        v <= value
    ).length /
    clean.length
  ) *
  100;
}


export function parseUTC(value) {

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


/* =========================================================
   TIMEZONE
========================================================= */

const FORMATTERS =
  new Map();


function formatter(
  timeZone
) {

  if (
    !FORMATTERS.has(
      timeZone
    )
  ) {

    FORMATTERS.set(
      timeZone,
      new Intl.DateTimeFormat(
        "en-GB",
        {
          timeZone,
          year:
            "numeric",
          month:
            "2-digit",
          day:
            "2-digit",
          hour:
            "2-digit",
          minute:
            "2-digit",
          hourCycle:
            "h23"
        }
      )
    );

  }

  return FORMATTERS.get(
    timeZone
  );
}


export function zoneParts(
  ms,
  timeZone
) {

  const map = {};

  for (
    const part of
    formatter(
      timeZone
    )
    .formatToParts(
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
   API
========================================================= */

export async function fetchJSON(
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
            controller.signal,

          cache:
            "no-store"
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
        String(
          outputsize
        ),

      timezone:
        "UTC",

      format:
        "JSON",

      apikey:
        key
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
    .map(
      x => ({
        t:
          x.datetime,

        o:
          Number(
            x.open
          ),

        h:
          Number(
            x.high
          ),

        l:
          Number(
            x.low
          ),

        c:
          Number(
            x.close
          ),

        v:
          Number(
            x.volume ||
            0
          )
      })
    )
    .filter(
      c =>
        [
          c.o,
          c.h,
          c.l,
          c.c
        ]
        .every(
          Number.isFinite
        )
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

      dp:
        "5",

      apikey:
        key
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
        parseUTC(
          candle.t
        );

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
    minutes *
    60000;

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
        size
      ) *
      size;

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

  const out = [];

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
      ]
      .sort(
        (a, b) =>
          parseUTC(a.t) -
          parseUTC(b.t)
      );

    if (
      group.length !==
      minutes
    ) {
      continue;
    }

    out.push({
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
            (
              x.v ||
              0
            ),
          0
        )
    });

  }

  return out.sort(
    (a, b) =>
      parseUTC(a.t) -
      parseUTC(b.t)
  );
}


/* =========================================================
   EMA
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

  const out =
    Array(
      period -
      1
    ).fill(null);

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


/* =========================================================
   RSI
========================================================= */

export function rsi(
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

    const move =
      closes[i] -
      closes[i - 1];

    gains +=
      Math.max(
        move,
        0
      );

    losses +=
      Math.max(
        -move,
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

    const move =
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
          move,
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
          -move,
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


/* =========================================================
   ATR
========================================================= */

export function trueRanges(
  candles
) {

  const values = [];

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

    values.push(
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

  return values;
}


export function wilder(
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

  const out = [
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


export function atr(
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


export function atrHistory(
  candles,
  period = 14,
  lookback = 120
) {

  const out = [];

  const start =
    Math.max(
      period +
        1,
      candles.length -
        lookback
    );

  for (
    let i =
      start;

    i <
      candles.length;

    i++
  ) {

    const slice =
      candles.slice(
        Math.max(
          0,
          i -
            50
        ),
        i + 1
      );

    const value =
      atr(
        slice,
        period
      );

    if (
      Number.isFinite(value)
    ) {
      out.push(
        value
      );
    }

  }

  return out;
}


/* =========================================================
   MACD
========================================================= */

export function macdHistogram(
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

  const line = [];

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

    line.push(
      fast[i] -
      slow[i]
    );

  }

  if (
    line.length <
    9
  ) {
    return null;
  }

  const signal =
    ema(
      line,
      9
    );

  return signal == null
    ? null
    : line.at(-1) -
      signal;
}


/* =========================================================
   TREND / MOMENTUM
========================================================= */

export function trendBias(
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


export function efficiencyRatio(
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

  let movement = 0;

  for (
    let i =
      start + 1;

    i <
      closes.length;

    i++
  ) {

    movement +=
      Math.abs(
        closes[i] -
        closes[i - 1]
      );

  }

  return movement > 0
    ? net /
      movement
    : 0;
}


export function momentum(
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
      1.2
  ) {
    return "BULLISH";
  }

  if (
    bear >
    bull *
      1.2
  ) {
    return "BEARISH";
  }

  return "MIXED";
}


/* =========================================================
   STRUCTURE
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


export function structureLabel(
  swings
) {

  const highs =
    swings.highs.slice(-2);

  const lows =
    swings.lows.slice(-2);

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


export function detectStructure(
  candles,
  swings
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
    previous !== null &&
    current !== null &&
    previous <=
      high.price &&
    current >
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
    previous !== null &&
    current !== null &&
    previous >=
      low.price &&
    current <
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
   LIQUIDITY
========================================================= */

export function genericSweep(
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

export function displacement(
  candles
) {

  const candle =
    candles.at(-1);

  const a =
    atr(
      candles,
      14
    );

  if (
    !candle ||
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
    body /
    range;

  const rangeAtr =
    range /
    a;

  const closePosition =
    (
      candle.c -
      candle.l
    ) /
    range;

  let direction =
    "NONE";

  if (
    candle.c >
      candle.o &&
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
    candle.c <
      candle.o &&
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


export function biasSign(value) {

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
   SNAPSHOT
========================================================= */

export function snapshot(
  candles
) {

  const closes =
    candles.map(
      x => x.c
    );

  const swings =
    findSwings(
      candles
    );

  const structure =
    detectStructure(
      candles,
      swings
    );

  const sweep =
    genericSweep(
      candles
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
      structure.structure,

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
          5
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
          macdHistogram(
            closes
          ),
          6
        )
    },

    ict: {
      bos:
        structure.bos,

      choch:
        structure.choch,

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
          swings.highs
            .at(-1)
            ?.price,
          2
        ),

      lastSwingHighAge:
        swings.highs
          .at(-1)
          ?.age ??
        null,

      lastSwingLow:
        round(
          swings.lows
            .at(-1)
            ?.price,
          2
        ),

      lastSwingLowAge:
        swings.lows
          .at(-1)
          ?.age ??
        null
    }
  };
}


/* =========================================================
   GOLD DAY / ASIA LEVELS
========================================================= */

export function buildDayLevels(
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

  const create =
    key => {

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

    };

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


export function asianRange(
  candles
) {

  const latest =
    candles.at(-1);

  if (!latest) {
    return null;
  }

  const current =
    zoneParts(
      parseUTC(
        latest.t
      ),
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
            current.dateKey &&
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
      current.hour >= 8
  };
}


export function recentSweep(
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
      candles.length -
      1;

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


export function goldContext(
  packet,
  m1
) {

  const dayLevels =
    buildDayLevels(
      m1
    );

  const asia =
    asianRange(
      m1
    );

  const previous =
    dayLevels.previous;

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
        "Asian low liquidity swept."
      );

    }

    if (high) {

      bearish +=
        high.age <= 2
          ? 38
          : 28;

      signals.push(
        "Asian high liquidity swept."
      );

    }

  }

  if (previous) {

    if (
      recentSweep(
        m1,
        previous.low,
        "SELL_SIDE",
        12
      )
    ) {

      bullish +=
        30;

      signals.push(
        "Previous-day low swept."
      );

    }

    if (
      recentSweep(
        m1,
        previous.high,
        "BUY_SIDE",
        12
      )
    ) {

      bearish +=
        30;

      signals.push(
        "Previous-day high swept."
      );

    }

  }

  if (
    packet.M1
      .ict
      .sweep
      .type ===
    "BULLISH_SELLSIDE_SWEEP"
  ) {
    bullish += 20;
  }

  if (
    packet.M1
      .ict
      .sweep
      .type ===
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
   REGIME
========================================================= */

export function detectRegime(
  candles
) {

  const closes =
    candles.map(
      x => x.c
    );

  const currentAtr =
    atr(
      candles,
      14
    );

  const percentile =
    percentileRank(
      atrHistory(
        candles,
        14,
        120
      ),
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

  const efficiency =
    efficiencyRatio(
      closes,
      20
    );

  const spreadAtr =
    currentAtr > 0 &&
    Number.isFinite(e20) &&
    Number.isFinite(e50)
      ? Math.abs(
          e20 -
          e50
        ) /
        currentAtr
      : 0;

  const returnAtr =
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
    percentile >= 75 &&
    efficiency >=
      0.52 &&
    Math.abs(
      returnAtr
    ) >=
      0.7
  ) {

    type =
      returnAtr >= 0
        ? "BULLISH_EXPANSION"
        : "BEARISH_EXPANSION";

  }
  else if (
    efficiency >=
      0.42 &&
    spreadAtr >=
      0.45
  ) {

    type =
      e20 >=
      e50
        ? "BULLISH_TREND"
        : "BEARISH_TREND";

  }
  else if (
    percentile <= 30 &&
    efficiency <=
      0.25
  ) {

    type =
      "QUIET_CHOP";

  }
  else if (
    efficiency <=
    0.32
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
          percentile -
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
          percentile
        ) *
          0.6,
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
        percentile,
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

    recentReturnAtr:
      round(
        returnAtr,
        3
      )
  };
}


/* =========================================================
   TECHNICAL MODEL SCORES
========================================================= */

export function scoreTechnical(
  packet
) {

  const trend =
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

  const structure =
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
        packet.M5
          .ict
          .bos
      ) *
        24 +
      biasSign(
        packet.M1
          .ict
          .bos
      ) *
        20 +
      biasSign(
        packet.M1
          .ict
          .choch
      ) *
        14,
      -100,
      100
    );

  const liquidity =
    clamp(
      packet.gold
        .bullishLiquidityScore -
      packet.gold
        .bearishLiquidityScore,
      -100,
      100
    );

  const m1Macd =
    finite(
      packet.M1
        .indicators
        .macdHistogram
    ) ??
    0;

  const m5Macd =
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

  const momentumScore =
    clamp(
      biasSign(
        packet.M1.momentum
      ) *
        30 +
      biasSign(
        packet.M5.momentum
      ) *
        35 +
      (
        m1Macd > 0
          ? 15
          : m1Macd < 0
            ? -15
            : 0
      ) +
      (
        m5Macd > 0
          ? 12
          : m5Macd < 0
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
      ),
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
    displacementScore += 40;
  }

  if (
    packet.M1
      .displacement
      .direction ===
    "BEARISH"
  ) {
    displacementScore -= 40;
  }

  if (
    packet.M5
      .displacement
      .direction ===
    "BULLISH"
  ) {
    displacementScore += 40;
  }

  if (
    packet.M5
      .displacement
      .direction ===
    "BEARISH"
  ) {
    displacementScore -= 40;
  }

  return {
    trend,
    structure,
    liquidity,

    momentum:
      momentumScore,

    displacement:
      clamp(
        displacementScore,
        -100,
        100
      )
  };
}


/* =========================================================
   BREAKOUT MODEL
========================================================= */

export function breakoutScore(
  candles
) {

  if (
    candles.length <
    30
  ) {
    return 0;
  }

  const last =
    candles.at(-1);

  const previous =
    candles.slice(
      -21,
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

  const a =
    atr(
      candles,
      14
    );

  if (
    !Number.isFinite(a) ||
    a <= 0
  ) {
    return 0;
  }

  if (
    last.c >
    high
  ) {

    return clamp(
      55 +
      (
        last.c -
        high
      ) /
      a *
      45,
      0,
      100
    );

  }

  if (
    last.c <
    low
  ) {

    return -clamp(
      55 +
      (
        low -
        last.c
      ) /
      a *
      45,
      0,
      100
    );

  }

  return 0;
}


/* =========================================================
   MEAN REVERSION
========================================================= */

export function meanReversionScore(
  candles
) {

  const closes =
    candles.map(
      x => x.c
    );

  const a =
    atr(
      candles,
      14
    );

  const e20 =
    ema(
      closes,
      20
    );

  const valueRsi =
    rsi(
      closes,
      14
    );

  if (
    !Number.isFinite(a) ||
    !Number.isFinite(e20) ||
    !Number.isFinite(valueRsi) ||
    a <= 0
  ) {
    return 0;
  }

  const z =
    (
      closes.at(-1) -
      e20
    ) /
    a;

  if (
    z >
      1.1 &&
    valueRsi >
      62
  ) {

    return -clamp(
      (
        z -
        0.8
      ) *
        45 +
      (
        valueRsi -
        60
      ) *
        2,
      0,
      100
    );

  }

  if (
    z <
      -1.1 &&
    valueRsi <
      38
  ) {

    return clamp(
      (
        -z -
        0.8
      ) *
        45 +
      (
        40 -
        valueRsi
      ) *
        2,
      0,
      100
    );

  }

  return 0;
}


/* =========================================================
   GENERIC SERIES DIRECTION
========================================================= */

export function seriesDirection(
  candles
) {

  if (
    !candles ||
    candles.length <
      55
  ) {

    return {
      direction:
        "NEUTRAL",

      score:
        0
    };

  }

  const closes =
    candles.map(
      x => x.c
    );

  const a =
    atr(
      candles,
      14
    );

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

  if (
    !Number.isFinite(a) ||
    !Number.isFinite(e20) ||
    !Number.isFinite(e50) ||
    a <= 0
  ) {

    return {
      direction:
        "NEUTRAL",

      score:
        0
    };

  }

  const score =
    clamp(
      (
        (
          closes.at(-1) -
          e20
        ) /
        a
      ) *
        30 +
      (
        (
          e20 -
          e50
        ) /
        a
      ) *
        45 +
      (
        (
          closes.at(-1) -
          closes.at(-7)
        ) /
        a
      ) *
        20,
      -100,
      100
    );

  return {
    direction:
      score > 8
        ? "BULLISH"
        : score < -8
          ? "BEARISH"
          : "NEUTRAL",

    score:
      round(
        score,
        1
      )
  };
}


/* =========================================================
   CROSS MARKET
========================================================= */

export function crossMarketScore(
  markets
) {

  const values = [];

  function add(
    name,
    data,
    inversion,
    weight
  ) {

    if (
      !data ||
      data.direction ===
        "NEUTRAL"
    ) {
      return;
    }

    let sign =
      biasSign(
        data.direction
      );

    if (inversion) {
      sign *= -1;
    }

    values.push({
      name,
      direction:
        data.direction,

      rawScore:
        data.score,

      contribution:
        sign *
        Math.abs(
          data.score
        ) *
        weight
    });

  }

  add(
    "DXY",
    markets.dxy,
    true,
    1.25
  );

  add(
    "US10Y",
    markets.us10y,
    true,
    1
  );

  add(
    "US2Y",
    markets.us2y,
    true,
    0.8
  );

  add(
    "EUR/USD",
    markets.eurusd,
    false,
    0.8
  );

  add(
    "USD/JPY",
    markets.usdjpy,
    true,
    0.65
  );

  if (
    !values.length
  ) {

    return {
      available:
        false,

      direction:
        "NEUTRAL",

      score:
        0,

      items:
        []
    };

  }

  const score =
    clamp(
      values.reduce(
        (
          sum,
          x
        ) =>
          sum +
          x.contribution,
        0
      ) /
      values.length,
      -100,
      100
    );

  return {
    available:
      true,

    direction:
      score > 8
        ? "BUY"
        : score < -8
          ? "SELL"
          : "NEUTRAL",

    score:
      round(
        score,
        1
      ),

    items:
      values
  };
}


/* =========================================================
   REGIME WEIGHTS
========================================================= */

export function regimeWeights(
  regime
) {

  if (
    regime.includes(
      "EXPANSION"
    )
  ) {

    return {
      trend:
        0.21,

      structure:
        0.14,

      liquidity:
        0.09,

      momentum:
        0.16,

      displacement:
        0.13,

      breakout:
        0.14,

      cross:
        0.13,

      meanReversion:
        0
    };

  }

  if (
    regime.includes(
      "TREND"
    )
  ) {

    return {
      trend:
        0.25,

      structure:
        0.18,

      liquidity:
        0.10,

      momentum:
        0.16,

      displacement:
        0.10,

      breakout:
        0.08,

      cross:
        0.13,

      meanReversion:
        0
    };

  }

  if (
    regime ===
    "RANGE"
  ) {

    return {
      trend:
        0.05,

      structure:
        0.20,

      liquidity:
        0.24,

      momentum:
        0.08,

      displacement:
        0.08,

      breakout:
        0.04,

      cross:
        0.08,

      meanReversion:
        0.23
    };

  }

  return {
    trend:
      0.15,

    structure:
      0.18,

    liquidity:
      0.17,

    momentum:
      0.13,

    displacement:
      0.10,

    breakout:
      0.08,

    cross:
      0.11,

    meanReversion:
      0.08
  };
}


/* =========================================================
   BASIC HISTORICAL COMPONENTS
========================================================= */

export function basicComponentScores(
  candles
) {

  const snap =
    snapshot(
      candles
    );

  const sweep =
    genericSweep(
      candles
    );

  const disp =
    displacement(
      candles
    );

  return {
    trend:
      seriesDirection(
        candles
      ).score,

    structure:
      clamp(
        biasSign(
          snap.structure
        ) *
          55 +
        biasSign(
          snap.ict.bos
        ) *
          30 +
        biasSign(
          snap.ict.choch
        ) *
          15,
        -100,
        100
      ),

    liquidity:
      sweep.type ===
      "BULLISH_SELLSIDE_SWEEP"
        ? 65
        : sweep.type ===
          "BEARISH_BUYSIDE_SWEEP"
          ? -65
          : 0,

    momentum:
      biasSign(
        momentum(
          candles
        )
      ) *
      55,

    displacement:
      disp.direction ===
      "BULLISH"
        ? disp.quality
        : disp.direction ===
          "BEARISH"
          ? -disp.quality
          : 0,

    breakout:
      breakoutScore(
        candles
      ),

    cross:
      0,

    meanReversion:
      meanReversionScore(
        candles
      )
  };
}


/* =========================================================
   MARKET FINGERPRINT
========================================================= */

export function buildFeatureState(
  candles,
  components,
  regime
) {

  if (
    candles.length <
    60
  ) {
    return null;
  }

  const closes =
    candles.map(
      x => x.c
    );

  const a =
    atr(
      candles,
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

  const valueRsi =
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
      candles,
      20
    );

  const disp =
    displacement(
      candles
    );

  const swings =
    findSwings(
      candles.slice(-40)
    );

  const structure =
    structureLabel(
      swings
    );

  const avgRange =
    mean(
      candles
        .slice(-10)
        .map(
          c =>
            c.h -
            c.l
        )
    ) ||
    a;

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

    atr:
      a,

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
            valueRsi ??
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
        (
          closes.at(-1) -
          closes.at(-7)
        ) /
        a,
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
        avgRange /
          a -
          1,
        -2,
        2
      ),

      sweep.type ===
      "BULLISH_SELLSIDE_SWEEP"
        ? 1
        : sweep.type ===
          "BEARISH_BUYSIDE_SWEEP"
          ? -1
          : 0,

      disp.direction ===
      "BULLISH"
        ? disp.quality /
          100
        : disp.direction ===
          "BEARISH"
          ? -disp.quality /
            100
          : 0,

      biasSign(
        structure
      ),

      clamp(
        (
          regime.atrPercentile -
          50
        ) /
        50,
        -1,
        1
      )
    ],

    features: {
      close:
        closes.at(-1),

      atr:
        a,

      rsi:
        valueRsi,

      efficiency:
        eff,

      structure,

      sweep:
        sweep.type,

      displacement:
        disp.direction,

      atrPercentile:
        regime.atrPercentile,

      componentScores:
        components
    }
  };
}


/* =========================================================
   SIMILARITY
========================================================= */

const FEATURE_WEIGHTS = [
  1.2,
  1.2,
  0.7,
  0.7,
  1,
  0.8,
  0.5,
  0.9,
  0.8,
  0.8,
  0.65
];


export function similarityScore(
  a,
  b,
  sessionA,
  sessionB
) {

  if (
    !Array.isArray(a) ||
    !Array.isArray(b) ||
    a.length !==
      b.length
  ) {
    return 0;
  }

  let total = 0;
  let weights = 0;

  for (
    let i = 0;
    i <
      a.length;
    i++
  ) {

    const w =
      FEATURE_WEIGHTS[i] ??
      1;

    const difference =
      (
        a[i] ??
        0
      ) -
      (
        b[i] ??
        0
      );

    total +=
      w *
      difference *
      difference;

    weights += w;

  }

  let distance =
    Math.sqrt(
      total /
      Math.max(
        weights,
        1e-9
      )
    );

  if (
    sessionA !==
    sessionB
  ) {
    distance += 0.1;
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
   FUTURE PATH
========================================================= */

export function buildFuturePath(
  candles,
  index,
  bars = 12
) {

  const context =
    candles.slice(
      Math.max(
        0,
        index -
          60
      ),
      index + 1
    );

  const a =
    atr(
      context,
      14
    );

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
      index +
        1 +
        bars
    );

  if (
    future.length <
    bars
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
          ) /
          a,
          6
        ),

      l:
        round(
          (
            candle.l -
            entry
          ) /
          a,
          6
        ),

      c:
        round(
          (
            candle.c -
            entry
          ) /
          a,
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
  stopAtr,
  targetR,
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
    direction ===
    "BUY"
      ? 1
      : -1;

  const targetAtr =
    stopAtr *
    targetR;

  let mfeR = 0;
  let maeR = 0;

  let resultR =
    null;

  let outcome =
    "UNRESOLVED";

  for (
    let i = 0;
    i <
      path.length;
    i++
  ) {

    const p =
      path[i];

    const favorable =
      sign === 1
        ? p.h
        : -p.l;

    const adverse =
      sign === 1
        ? -p.l
        : p.h;

    mfeR =
      Math.max(
        mfeR,
        favorable /
        stopAtr
      );

    maeR =
      Math.max(
        maeR,
        adverse /
        stopAtr
      );

    const hitStop =
      sign === 1
        ? p.l <=
          -stopAtr
        : p.h >=
          stopAtr;

    const hitTarget =
      sign === 1
        ? p.h >=
          targetAtr
        : p.l <=
          -targetAtr;

    if (
      hitStop &&
      hitTarget
    ) {

      resultR =
        -1;

      outcome =
        "LOSS_AMBIGUOUS";

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
      path.at(-1)?.c ??
      0;

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
    stopAtr >
    0
      ? costAtr /
        stopAtr
      : 0;

  resultR -=
    costR;

  return {
    resultR,

    outcome,

    mfeR,

    maeR,

    costR
  };
}


/* =========================================================
   OPTIMIZE STOP / TP
========================================================= */

export function optimizeRiskReward(
  matches,
  direction
) {

  const stops = [
    0.65,
    0.8,
    0.95,
    1.1,
    1.3,
    1.5
  ];

  const targets = [
    0.75,
    1,
    1.2,
    1.5,
    1.8,
    2,
    2.5,
    3
  ];

  let best =
    null;

  for (
    const stopAtr of
    stops
  ) {

    for (
      const targetR of
      targets
    ) {

      const outcomes =
        matches
          .map(
            m =>
              evaluatePath(
                m.future_path ||
                m.futurePath,
                direction,
                stopAtr,
                targetR
              )
          )
          .filter(Boolean);

      if (
        outcomes.length <
        Math.min(
          15,
          matches.length
        )
      ) {
        continue;
      }

      const wins =
        outcomes.filter(
          x =>
            x.outcome ===
            "WIN"
        ).length;

      const expectancy =
        mean(
          outcomes.map(
            x =>
              x.resultR
          )
        ) ??
        -99;

      const winRate =
        wins /
        outcomes.length;

      const score =
        expectancy -
        Math.max(
          0,
          0.30 -
          winRate
        ) *
          0.5 -
        (
          stopAtr >
          1.3
            ? 0.03
            : 0
        );

      const candidate = {
        stopAtr,
        targetR,
        sample:
          outcomes.length,

        winRate,

        expectancy,

        score,

        medianMfeR:
          median(
            outcomes.map(
              x =>
                x.mfeR
            )
          ),

        medianMaeR:
          median(
            outcomes.map(
              x =>
                x.maeR
            )
          )
      };

      if (
        !best ||
        candidate.score >
          best.score
      ) {
        best =
          candidate;
      }

    }

  }

  if (!best) {
    return null;
  }

  return {
    stopAtr:
      best.stopAtr,

    targetR:
      best.targetR,

    sample:
      best.sample,

    winRate:
      round(
        best.winRate *
        100,
        1
      ),

    expectancy:
      round(
        best.expectancy,
        3
      ),

    medianMfeR:
      round(
        best.medianMfeR,
        2
      ),

    medianMaeR:
      round(
        best.medianMaeR,
        2
      )
  };
}


/* =========================================================
   HISTORICAL STATS
========================================================= */

export function historicalStats(
  matches,
  direction,
  stopAtr,
  targetR
) {

  const rows =
    matches
      .map(
        m =>
          evaluatePath(
            m.future_path ||
            m.futurePath,
            direction,
            stopAtr,
            targetR
          )
      )
      .filter(Boolean);

  if (
    !rows.length
  ) {

    return {
      matches:
        0
    };

  }

  const wins =
    rows.filter(
      x =>
        x.outcome ===
        "WIN"
    ).length;

  const losses =
    rows.filter(
      x =>
        x.outcome
          .startsWith(
            "LOSS"
          )
    ).length;

  const probability =
    (
      wins +
      2
    ) /
    (
      wins +
      losses +
      4
    );

  return {
    matches:
      rows.length,

    wins,

    losses,

    unresolved:
      rows.length -
      wins -
      losses,

    targetHitRate:
      round(
        wins /
        rows.length *
        100,
        1
      ),

    stopHitRate:
      round(
        losses /
        rows.length *
        100,
        1
      ),

    calibratedTpFirstRate:
      round(
        probability *
        100,
        1
      ),

    expectancyR:
      round(
        mean(
          rows.map(
            x =>
              x.resultR
          )
        ),
        3
      ),

    medianMfeR:
      round(
        median(
          rows.map(
            x =>
              x.mfeR
          )
        ),
        2
      ),

    medianMaeR:
      round(
        median(
          rows.map(
            x =>
              x.maeR
          )
        ),
        2
      )
  };
}


/* =========================================================
   ADAPTIVE MODEL RELIABILITY
========================================================= */

export function adaptiveReliability(
  matches
) {

  const keys = [
    "trend",
    "structure",
    "liquidity",
    "momentum",
    "displacement",
    "breakout",
    "meanReversion"
  ];

  const out = {};

  for (
    const key of
    keys
  ) {

    let correct = 0;
    let total = 0;

    for (
      const match of
      matches
    ) {

      const score =
        finite(
          match.features
            ?.componentScores
            ?.[key]
        );

      const path =
        match.future_path ||
        match.futurePath;

      if (
        score ===
          null ||
        !Array.isArray(path) ||
        !path.length ||
        Math.abs(score) <
          10
      ) {
        continue;
      }

      const realized =
        Math.sign(
          path.at(-1)?.c ??
          0
        );

      if (!realized) {
        continue;
      }

      total++;

      if (
        Math.sign(
          score
        ) ===
        realized
      ) {
        correct++;
      }

    }

    const accuracy =
      total
        ? correct /
          total
        : 0.5;

    out[key] = {
      sample:
        total,

      accuracy:
        round(
          accuracy *
          100,
          1
        ),

      factor:
        round(
          clamp(
            0.65 +
            (
              accuracy -
              0.5
            ) *
              1.7,
            0.55,
            1.45
          ),
          3
        )
    };

  }

  return out;
}


/* =========================================================
   ENSEMBLE
========================================================= */

export function ensembleScore(
  components,
  regime,
  reliability = {}
) {

  const weights =
    regimeWeights(
      regime
    );

  let total = 0;
  let denominator = 0;

  for (
    const [
      key,
      baseWeight
    ] of
    Object.entries(
      weights
    )
  ) {

    const score =
      finite(
        components[key]
      ) ??
      0;

    const factor =
      finite(
        reliability[key]
          ?.factor
      ) ??
      1;

    const weight =
      baseWeight *
      factor;

    total +=
      score *
      weight;

    denominator +=
      Math.abs(
        weight
      );

  }

  return denominator >
    0
    ? clamp(
        total /
        denominator,
        -100,
        100
      )
    : 0;
}


/* =========================================================
   SETUP TYPE
========================================================= */

export function inferSetup(
  packet,
  regime,
  components,
  direction
) {

  if (
    direction ===
      "BUY" &&
    packet.M1
      .ict
      .sweep
      .type ===
      "BULLISH_SELLSIDE_SWEEP"
  ) {
    return "LIQUIDITY_SWEEP_REVERSAL";
  }

  if (
    direction ===
      "SELL" &&
    packet.M1
      .ict
      .sweep
      .type ===
      "BEARISH_BUYSIDE_SWEEP"
  ) {
    return "LIQUIDITY_SWEEP_REVERSAL";
  }

  if (
    regime.type.includes(
      "EXPANSION"
    ) &&
    Math.abs(
      components.breakout ||
      0
    ) >=
      50
  ) {
    return "BREAKOUT_EXPANSION";
  }

  if (
    regime.type.includes(
      "TREND"
    )
  ) {
    return "TREND_CONTINUATION";
  }

  if (
    regime.type ===
    "RANGE"
  ) {
    return "RANGE_REVERSION";
  }

  return "MULTI_FACTOR";
}