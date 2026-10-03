export const SYMBOL = "XAU/USD";
export const BASE_URL = "https://api.twelvedata.com";


/* =========================================================
   MKAYFX SIMPLE TREND ENGINE V14

   STRATEGY
   --------
   H1   = major trend
   M15  = confirmation
   M5   = pullback + entry trigger

   BUY
   ---
   H1 above EMA200
   M15 above EMA200
   M5 above EMA200
   EMA20 above EMA200
   Pullback into EMA20
   Bullish reclaim / breakout
   RSI > 50

   SELL
   ----
   Exact opposite.

   EXIT
   ----
   Stop = 1 ATR
   Target = 2R

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

  if (!clean.length) {
    return null;
  }

  return clean.reduce(
    (a, b) =>
      a + b,
    0
  ) /
  clean.length;
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
   SESSION
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
          year:"numeric",
          month:"2-digit",
          day:"2-digit",
          hour:"2-digit",
          minute:"2-digit",
          hourCycle:"h23"
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
      candle =>
        [
          candle.o,
          candle.h,
          candle.l,
          candle.c
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
      .push(candle);

  }


  const out =
    [];


  for (
    const [
      timestamp,
      raw
    ] of
    map
  ) {

    const group =
      raw.sort(
        (a, b) =>
          parseUTC(a.t) -
          parseUTC(b.t)
      );


    const required =
      minutes /
      5;


    if (
      required >= 1 &&
      group.length !==
      required
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
            total,
            candle
          ) =>
            total +
            (
              candle.v ||
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


  const output =
    Array(
      period -
      1
    ).fill(null);


  output.push(
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


    output.push(
      current
    );

  }


  return output;
}


export function ema(
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


  let gains =
    0;


  let losses =
    0;


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

  const values =
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


    values.push(
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


  return values;
}


export function atr(
  candles,
  period = 14
) {

  const values =
    trueRanges(
      candles
    );


  if (
    values.length <
    period
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

  }


  return current;
}


/* =========================================================
   SIMPLE TIMEFRAME SNAPSHOT
========================================================= */

export function snapshot(
  candles
) {

  if (
    !Array.isArray(
      candles
    ) ||
    !candles.length
  ) {

    return {

      price:null,

      bias:"NEUTRAL",

      structure:"MIXED",

      indicators:{
        ema20:null,
        ema200:null,
        atr14:null,
        rsi14:null
      },

      ict:{
        bos:"NONE",
        choch:"NONE",
        lastSwingHigh:null,
        lastSwingLow:null
      }

    };

  }


  const closes =
    candles.map(
      candle =>
        candle.c
    );


  const price =
    closes.at(-1);


  const e20 =
    ema(
      closes,
      20
    );


  const e200 =
    ema(
      closes,
      200
    );


  let bias =
    "NEUTRAL";


  if (
    Number.isFinite(
      e200
    )
  ) {

    if (
      price >
        e200 &&
      (
        !Number.isFinite(e20) ||
        e20 >
          e200
      )
    ) {

      bias =
        "BULLISH";

    }
    else if (
      price <
        e200 &&
      (
        !Number.isFinite(e20) ||
        e20 <
          e200
      )
    ) {

      bias =
        "BEARISH";

    }

  }


  return {

    price:
      round(
        price,
        2
      ),

    bias,

    structure:
      bias ===
        "BULLISH"
        ? "HH/HL"
        : bias ===
          "BEARISH"
          ? "LH/LL"
          : "MIXED",

    indicators:{

      ema20:
        round(
          e20,
          2
        ),

      ema200:
        round(
          e200,
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
        )

    },

    ict:{

      bos:"NONE",

      choch:"NONE",

      lastSwingHigh:
        round(
          Math.max(
            ...candles
              .slice(-10)
              .map(
                candle =>
                  candle.h
              )
          ),
          2
        ),

      lastSwingLow:
        round(
          Math.min(
            ...candles
              .slice(-10)
              .map(
                candle =>
                  candle.l
              )
          ),
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
    candles.length <
    210
  ) {

    return {
      type:"UNKNOWN",
      confidence:0
    };

  }


  const closes =
    candles.map(
      candle =>
        candle.c
    );


  const e20 =
    ema(
      closes,
      20
    );


  const e200 =
    ema(
      closes,
      200
    );


  const a =
    atr(
      candles,
      14
    );


  if (
    !Number.isFinite(e20) ||
    !Number.isFinite(e200) ||
    !Number.isFinite(a) ||
    a <= 0
  ) {

    return {
      type:"UNKNOWN",
      confidence:0
    };

  }


  const spread =
    Math.abs(
      e20 -
      e200
    ) /
    a;


  if (
    spread <
    0.65
  ) {

    return {
      type:"RANGE",
      confidence:
        round(
          clamp(
            80 -
            spread *
              30,
            50,
            90
          ),
          1
        )
    };

  }


  return {

    type:
      e20 >
      e200
        ? "BULLISH_TREND"
        : "BEARISH_TREND",

    confidence:
      round(
        clamp(
          55 +
          spread *
            10,
          55,
          95
        ),
        1
      )

  };
}


/* =========================================================
   SIMPLE STRATEGY V14

   IMPORTANT:
   This function is used by BOTH:
   - live analysis
   - memory/backtesting

   Therefore research tests the same entry rules.
========================================================= */

export function simpleTrendPullbackStrategy({
  m5,
  m15,
  h1
}) {

  const noTrade = (
    reason,
    details = {}
  ) => ({

    signal:"WAIT",

    direction:null,

    qualified:false,

    setup:
      "TREND_PULLBACK",

    score:0,

    reason,

    reasons:[
      reason
    ],

    ...details

  });


  if (
    !Array.isArray(m5) ||
    !Array.isArray(m15) ||
    !Array.isArray(h1)
  ) {

    return noTrade(
      "Missing timeframe data."
    );

  }


  if (
    m5.length <
      210 ||
    m15.length <
      210 ||
    h1.length <
      210
  ) {

    return noTrade(
      "Not enough candles for EMA200 trend analysis."
    );

  }


  const m5Closes =
    m5.map(
      candle =>
        candle.c
    );


  const m15Closes =
    m15.map(
      candle =>
        candle.c
    );


  const h1Closes =
    h1.map(
      candle =>
        candle.c
    );


  const m5Price =
    m5Closes.at(-1);


  const m15Price =
    m15Closes.at(-1);


  const h1Price =
    h1Closes.at(-1);


  const m5Ema20 =
    ema(
      m5Closes,
      20
    );


  const m5Ema200 =
    ema(
      m5Closes,
      200
    );


  const m15Ema200 =
    ema(
      m15Closes,
      200
    );


  const h1Ema200 =
    ema(
      h1Closes,
      200
    );


  const m5Rsi =
    rsi(
      m5Closes,
      14
    );


  const m5Atr =
    atr(
      m5,
      14
    );


  if (
    [
      m5Price,
      m15Price,
      h1Price,
      m5Ema20,
      m5Ema200,
      m15Ema200,
      h1Ema200,
      m5Rsi,
      m5Atr
    ]
      .some(
        value =>
          !Number.isFinite(
            value
          )
      )
  ) {

    return noTrade(
      "Indicators unavailable."
    );

  }


  if (
    m5Atr <=
    0
  ) {

    return noTrade(
      "ATR unavailable."
    );

  }


  const last =
    m5.at(-1);


  const previous =
    m5.at(-2);


  const recent =
    m5.slice(
      -4
    );


  /* -----------------------------------------------------
     TREND
  ----------------------------------------------------- */

  const bullishH1 =
    h1Price >
    h1Ema200;


  const bearishH1 =
    h1Price <
    h1Ema200;


  const bullishM15 =
    m15Price >
    m15Ema200;


  const bearishM15 =
    m15Price <
    m15Ema200;


  const bullishM5 =
    m5Price >
      m5Ema200 &&
    m5Ema20 >
      m5Ema200;


  const bearishM5 =
    m5Price <
      m5Ema200 &&
    m5Ema20 <
      m5Ema200;


  /* -----------------------------------------------------
     CHOP FILTER

     EMA20 and EMA200 need meaningful separation.
  ----------------------------------------------------- */

  const trendSpreadAtr =
    Math.abs(
      m5Ema20 -
      m5Ema200
    ) /
    m5Atr;


  const trendStrong =
    trendSpreadAtr >=
    0.65;


  /* -----------------------------------------------------
     PULLBACK

     During the previous few candles price must
     come reasonably close to EMA20.
  ----------------------------------------------------- */

  const pullbackTolerance =
    m5Atr *
    0.30;


  const bullishPullback =
    recent.some(
      candle =>
        candle.l <=
        m5Ema20 +
        pullbackTolerance
    );


  const bearishPullback =
    recent.some(
      candle =>
        candle.h >=
        m5Ema20 -
        pullbackTolerance
    );


  /* -----------------------------------------------------
     TRIGGER

     Last completed M5 candle must confirm continuation.
  ----------------------------------------------------- */

  const bullishCandle =
    last.c >
    last.o;


  const bearishCandle =
    last.c <
    last.o;


  const bullishBreak =
    last.c >
    previous.h;


  const bearishBreak =
    last.c <
    previous.l;


  const bullishReclaim =
    last.c >
      m5Ema20 &&
    last.c >
      previous.c;


  const bearishReclaim =
    last.c <
      m5Ema20 &&
    last.c <
      previous.c;


  const bullishTrigger =
    bullishCandle &&
    (
      bullishBreak ||
      bullishReclaim
    );


  const bearishTrigger =
    bearishCandle &&
    (
      bearishBreak ||
      bearishReclaim
    );


  /* -----------------------------------------------------
     RSI
  ----------------------------------------------------- */

  const bullishMomentum =
    m5Rsi >=
      52 &&
    m5Rsi <=
      72;


  const bearishMomentum =
    m5Rsi <=
      48 &&
    m5Rsi >=
      28;


  /* -----------------------------------------------------
     BUY
  ----------------------------------------------------- */

  const buyChecks = {

    h1Trend:
      bullishH1,

    m15Trend:
      bullishM15,

    m5Trend:
      bullishM5,

    trendStrength:
      trendStrong,

    pullback:
      bullishPullback,

    momentum:
      bullishMomentum,

    trigger:
      bullishTrigger

  };


  /* -----------------------------------------------------
     SELL
  ----------------------------------------------------- */

  const sellChecks = {

    h1Trend:
      bearishH1,

    m15Trend:
      bearishM15,

    m5Trend:
      bearishM5,

    trendStrength:
      trendStrong,

    pullback:
      bearishPullback,

    momentum:
      bearishMomentum,

    trigger:
      bearishTrigger

  };


  const buyPassed =
    Object.values(
      buyChecks
    )
      .filter(Boolean)
      .length;


  const sellPassed =
    Object.values(
      sellChecks
    )
      .filter(Boolean)
      .length;


  const totalChecks =
    Object.keys(
      buyChecks
    ).length;


  const buyQualified =
    buyPassed ===
    totalChecks;


  const sellQualified =
    sellPassed ===
    totalChecks;


  let signal =
    "WAIT";


  let direction =
    null;


  let checks =
    buyPassed >=
    sellPassed
      ? buyChecks
      : sellChecks;


  if (
    buyQualified
  ) {

    signal =
      "BUY";

    direction =
      "BUY";

    checks =
      buyChecks;

  }
  else if (
    sellQualified
  ) {

    signal =
      "SELL";

    direction =
      "SELL";

    checks =
      sellChecks;

  }


  const passed =
    direction ===
      "BUY"
      ? buyPassed
      : direction ===
        "SELL"
        ? sellPassed
        : Math.max(
            buyPassed,
            sellPassed
          );


  const score =
    round(
      passed /
      totalChecks *
      100,
      1
    );


  const reasons =
    [];


  reasons.push(
    `H1 price ${h1Price > h1Ema200 ? "above" : "below"} EMA200.`
  );


  reasons.push(
    `M15 price ${m15Price > m15Ema200 ? "above" : "below"} EMA200.`
  );


  reasons.push(
    `M5 EMA20/EMA200 separation ${round(
      trendSpreadAtr,
      2
    )} ATR.`
  );


  reasons.push(
    `M5 RSI ${round(
      m5Rsi,
      1
    )}.`
  );


  if (
    signal ===
    "BUY"
  ) {

    reasons.push(
      "Bullish pullback and continuation trigger confirmed."
    );

  }
  else if (
    signal ===
    "SELL"
  ) {

    reasons.push(
      "Bearish pullback and continuation trigger confirmed."
    );

  }
  else {

    const preferred =
      buyPassed >=
      sellPassed
        ? buyChecks
        : sellChecks;


    const failed =
      Object.entries(
        preferred
      )
        .filter(
          ([, value]) =>
            !value
        )
        .map(
          ([key]) =>
            key
        );


    reasons.push(
      `No trade. Missing: ${failed.join(", ")}.`
    );

  }


  return {

    signal,

    direction,

    qualified:
      signal ===
        "BUY" ||
      signal ===
        "SELL",

    setup:
      "TREND_PULLBACK",

    score,

    checks,

    buyChecks,

    sellChecks,

    reasons,

    indicators:{

      h1Price:
        round(
          h1Price,
          2
        ),

      h1Ema200:
        round(
          h1Ema200,
          2
        ),

      m15Price:
        round(
          m15Price,
          2
        ),

      m15Ema200:
        round(
          m15Ema200,
          2
        ),

      m5Price:
        round(
          m5Price,
          2
        ),

      m5Ema20:
        round(
          m5Ema20,
          2
        ),

      m5Ema200:
        round(
          m5Ema200,
          2
        ),

      m5Rsi:
        round(
          m5Rsi,
          1
        ),

      m5Atr:
        round(
          m5Atr,
          5
        ),

      trendSpreadAtr:
        round(
          trendSpreadAtr,
          3
        )

    }

  };
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
    candles[index]
      ?.c;


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
    direction ===
      "BUY"
      ? 1
      : -1;


  const targetAtr =
    stopAtr *
    targetR;


  let resultR =
    null;


  let outcome =
    "UNRESOLVED";


  let mfeR =
    0;


  let maeR =
    0;


  for (
    const point of
    path
  ) {

    const favorable =
      sign ===
        1
        ? point.h
        : -point.l;


    const adverse =
      sign ===
        1
        ? -point.l
        : point.h;


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
      sign ===
        1
        ? point.l <=
          -stopAtr
        : point.h >=
          stopAtr;


    const hitTarget =
      sign ===
        1
        ? point.h >=
          targetAtr
        : point.l <=
          -targetAtr;


    /*
      If both are touched inside the same candle,
      assume the stop was hit first.

      This makes the backtest conservative.
    */

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
      path.at(-1)
        ?.c ??
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
    costAtr /
    Math.max(
      stopAtr,
      0.01
    );


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