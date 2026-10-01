/* =========================================================
   MKAYFX GOLD SCALPER V7 LIVE
   XAU/USD ONLY

   LIVE ARCHITECTURE
   -----------------
   /price
      -> live XAU/USD price
      -> refreshed every few seconds

   /time_series M1
      -> candle/indicator engine
      -> cached ~55 seconds
      -> strategy recalculated only when a new completed M1
         candle appears

   CORE MODEL
   ----------
   H1  = Macro intraday context
   M15 = Main directional bias
   M5  = Confirmation
   M1  = Entry trigger

   V7 IMPROVEMENTS
   ---------------
   - Live XAU/USD price
   - Closed-candle strategy engine
   - 5000 M1 bars
   - Fresh BOS crossing only
   - Better CHOCH detection
   - Liquidity sweep age tracking
   - Asian H/L
   - Previous-day H/L
   - Gold displacement quality
   - Weighted module agreement
   - Reduced correlated voting
   - London / NY session filter
   - Live anti-chase / retest state
   - Dynamic spread vs ATR filter
   - Safer null handling
   - R200 account protection
   - Broker minimum lot protection
   - USD news guard
   - TP2 never extended unnecessarily
   - Setup strength != win probability

========================================================= */


/* =========================================================
   CONFIG
========================================================= */

const TWELVE_DATA_API_KEY =
  process.env.TWELVE_DATA_API_KEY;

const TWELVE_BASE =
  "https://api.twelvedata.com";

const SYMBOL =
  "XAU/USD";


/* =========================================================
   DATA
========================================================= */

const OUTPUT_SIZE =
  envNumber(
    "OUTPUT_SIZE",
    5000,
    {
      min: 500,
      max: 5000
    }
  );

const CANDLE_CACHE_MS =
  envNumber(
    "CANDLE_CACHE_MS",
    55_000,
    {
      min: 15_000,
      max: 120_000
    }
  );

const PRICE_CACHE_MS =
  envNumber(
    "PRICE_CACHE_MS",
    8_000,
    {
      min: 2_000,
      max: 30_000
    }
  );

const STALE_DATA_MS =
  envNumber(
    "STALE_DATA_MS",
    5 * 60_000,
    {
      min: 60_000,
      max: 60 * 60_000
    }
  );

const HTF_MIN_COMPLETENESS =
  envNumber(
    "HTF_MIN_COMPLETENESS",
    0.92,
    {
      min: 0.70,
      max: 1
    }
  );


/* =========================================================
   SMALL ACCOUNT
========================================================= */

const DEFAULT_EQUITY_ZAR =
  envNumber(
    "DEFAULT_EQUITY_ZAR",
    200,
    {
      min: 1
    }
  );

const RISK_PER_TRADE_PCT =
  envNumber(
    "RISK_PER_TRADE_PCT",
    0.25,
    {
      min: 0.01,
      max: 0.50
    }
  );

const MAX_RISK_PER_TRADE_PCT =
  0.50;

const DAILY_LOSS_LIMIT_PCT =
  envNumber(
    "DAILY_LOSS_LIMIT_PCT",
    1.50,
    {
      min: 0.25,
      max: 5
    }
  );

const MAX_TRADES_PER_DAY =
  envNumber(
    "MAX_TRADES_PER_DAY",
    6,
    {
      min: 1,
      max: 30
    }
  );

const MAX_CONSECUTIVE_LOSSES =
  envNumber(
    "MAX_CONSECUTIVE_LOSSES",
    3,
    {
      min: 1,
      max: 10
    }
  );

const LOSS_COOLDOWN_MINUTES =
  envNumber(
    "LOSS_COOLDOWN_MINUTES",
    10,
    {
      min: 0,
      max: 180
    }
  );


/* =========================================================
   GOLD EXECUTION
========================================================= */

const MAX_SPREAD_USD =
  envNumber(
    "MAX_SPREAD_USD",
    0.45,
    {
      min: 0.01,
      max: 5
    }
  );

const MAX_SPREAD_ATR_FRACTION =
  envNumber(
    "MAX_SPREAD_ATR_FRACTION",
    0.35,
    {
      min: 0.05,
      max: 1
    }
  );

const MAX_ENTRY_STRETCH_ATR =
  envNumber(
    "MAX_ENTRY_STRETCH_ATR",
    1.45,
    {
      min: 0.5,
      max: 4
    }
  );

const MAX_LIVE_DEVIATION_ATR =
  envNumber(
    "MAX_LIVE_DEVIATION_ATR",
    0.65,
    {
      min: 0.1,
      max: 3
    }
  );

const ENTRY_ZONE_ATR =
  envNumber(
    "ENTRY_ZONE_ATR",
    0.22,
    {
      min: 0.05,
      max: 1
    }
  );

const MAX_STOP_ATR =
  envNumber(
    "MAX_STOP_ATR",
    1.70,
    {
      min: 0.5,
      max: 5
    }
  );

const MIN_STOP_ATR =
  envNumber(
    "MIN_STOP_ATR",
    0.65,
    {
      min: 0.20,
      max: 2
    }
  );

const MAX_SWING_AGE_M1 =
  envNumber(
    "MAX_SWING_AGE_M1",
    18,
    {
      min: 3,
      max: 100
    }
  );


/* =========================================================
   TARGETS
========================================================= */

const TP1_R =
  envNumber(
    "TP1_R",
    1.0,
    {
      min: 0.5,
      max: 5
    }
  );

const TP2_R =
  envNumber(
    "TP2_R",
    1.6,
    {
      min: 1,
      max: 6
    }
  );

const MIN_LIQUIDITY_ROOM_R =
  envNumber(
    "MIN_LIQUIDITY_ROOM_R",
    1.05,
    {
      min: 0.5,
      max: 4
    }
  );

const MAX_HOLD_MINUTES =
  envNumber(
    "MAX_HOLD_MINUTES",
    25,
    {
      min: 5,
      max: 240
    }
  );


/* =========================================================
   ENSEMBLE
========================================================= */

const MIN_ENSEMBLE_SCORE =
  envNumber(
    "MIN_ENSEMBLE_SCORE",
    66,
    {
      min: 50,
      max: 95
    }
  );

const MIN_ENSEMBLE_MARGIN =
  envNumber(
    "MIN_ENSEMBLE_MARGIN",
    32,
    {
      min: 5,
      max: 90
    }
  );

const MIN_ENSEMBLE_QUALITY =
  envNumber(
    "MIN_ENSEMBLE_QUALITY",
    58,
    {
      min: 20,
      max: 95
    }
  );

const MIN_MODULE_AGREEMENT =
  envNumber(
    "MIN_MODULE_AGREEMENT",
    58,
    {
      min: 20,
      max: 100
    }
  );


/*
   Regime + gold remain context modules,
   but receive less directional voting power.
*/

const WEIGHTS =
  Object.freeze({

    trend:
      24,

    structure:
      24,

    liquidity:
      28,

    momentum:
      14,

    regime:
      5,

    gold:
      5

  });


/* =========================================================
   WARM INSTANCE CACHE
========================================================= */

let candleCache = {

  time:
    0,

  candles:
    null

};


let candleInFlight =
  null;


let priceCache = {

  time:
    0,

  price:
    null

};


let priceInFlight =
  null;


/*
   Heavy technical calculations are cached based
   on the last completed M1 candle.
*/

let analysisCache = {

  candleTime:
    null,

  packet:
    null,

  technical:
    null

};


/* =========================================================
   UTILITIES
========================================================= */

function envNumber(
  name,
  fallback,
  {
    min = -Infinity,
    max = Infinity
  } = {}
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


function finiteNumber(
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
    finiteNumber(
      value
    );

  if (
    n === null
  ) {

    return null;

  }

  return Number(
    n.toFixed(
      digits
    )
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
      (
        sum,
        value
      ) =>
        sum +
        value,
      0
    ) /
    clean.length
  );

}


function parseUTC(
  datetime
) {

  if (
    !datetime
  ) {

    return NaN;

  }

  const clean =
    String(
      datetime
    )
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

  }
  catch {

    return {};

  }

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
    );


  const parts =
    formatter
      .formatToParts(
        new Date(
          ms
        )
      );


  const object =
    {};


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
    !Number.isFinite(
      ms
    )
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
     London/NY overlap.
  */

  if (
    london.hour >=
      12 &&
    london.hour <
      16 &&
    ny.hour >=
      7 &&
    ny.hour <
      11
  ) {

    return "LONDON_NEW_YORK_OVERLAP";

  }


  if (
    london.hour >=
      8 &&
    london.hour <
      12
  ) {

    return "LONDON";

  }


  if (
    ny.hour >=
      8 &&
    ny.hour <
      13
  ) {

    return "NEW_YORK";

  }


  if (
    london.hour >=
      0 &&
    london.hour <
      8
  ) {

    return "ASIA";

  }


  return "TRANSITION";

}


function scalpSessionAllowed(
  session
) {

  return [

    "LONDON",
    "LONDON_NEW_YORK_OVERLAP",
    "NEW_YORK"

  ].includes(
    session
  );

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

  }
  finally {

    clearTimeout(
      timer
    );

  }

}


/* =========================================================
   TWELVE DATA CANDLES
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

      `${TWELVE_BASE}/time_series?${params.toString()}`

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
      "Twelve Data XAU/USD candle request failed."
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
          ]
          .every(
            Number.isFinite
          )
      )

      .reverse();


  if (
    candles.length <
    500
  ) {

    throw new Error(
      "Not enough XAU/USD M1 candles."
    );

  }


  return candles;

}


/* =========================================================
   TWELVE DATA LIVE PRICE
========================================================= */

async function requestGoldPrice() {

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

      dp:
        "5",

      apikey:
        TWELVE_DATA_API_KEY

    });


  const {
    response,
    data
  } =
    await fetchJson(

      `${TWELVE_BASE}/price?${params.toString()}`,

      {},

      10_000

    );


  const price =
    finiteNumber(
      data.price
    );


  if (
    !response.ok ||
    price ===
      null
  ) {

    throw new Error(
      data.message ||
      "Live XAU/USD price unavailable."
    );

  }


  return price;

}


/* =========================================================
   CACHE
========================================================= */

async function getGoldM1Cached() {

  const now =
    Date.now();


  if (
    candleCache.candles &&
    now -
      candleCache.time <
      CANDLE_CACHE_MS
  ) {

    return {

      candles:
        candleCache.candles,

      cacheHit:
        true

    };

  }


  if (
    candleInFlight
  ) {

    return {

      candles:
        await candleInFlight,

      cacheHit:
        true

    };

  }


  candleInFlight =
    requestGoldM1()

      .then(
        candles => {

          candleCache = {

            time:
              Date.now(),

            candles

          };


          return candles;

        }
      )

      .finally(
        () => {

          candleInFlight =
            null;

        }
      );


  return {

    candles:
      await candleInFlight,

    cacheHit:
      false

  };

}


async function getGoldPriceCached() {

  const now =
    Date.now();


  if (
    finiteNumber(
      priceCache.price
    ) !==
      null &&
    now -
      priceCache.time <
      PRICE_CACHE_MS
  ) {

    return {

      price:
        priceCache.price,

      cacheHit:
        true

    };

  }


  if (
    priceInFlight
  ) {

    return {

      price:
        await priceInFlight,

      cacheHit:
        true

    };

  }


  priceInFlight =
    requestGoldPrice()

      .then(
        price => {

          priceCache = {

            time:
              Date.now(),

            price

          };


          return price;

        }
      )

      .finally(
        () => {

          priceInFlight =
            null;

        }
      );


  return {

    price:
      await priceInFlight,

    cacheHit:
      false

  };

}


/* =========================================================
   COMPLETED M1
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
   RESAMPLE
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
      .get(
        bucket
      )
      .push(
        candle
      );

  }


  const output =
    [];


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
        (
          a,
          b
        ) =>
          parseUTC(
            a.t
          ) -
          parseUTC(
            b.t
          )
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
    (
      a,
      b
    ) =>
      parseUTC(
        a.t
      ) -
      parseUTC(
        b.t
      )
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


  let gains =
    0;


  let losses =
    0;


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
      change >=
      0
    ) {

      gains +=
        change;

    }
    else {

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
    avgLoss ===
    0
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
    period *
      2 +
      2
  ) {

    return null;

  }


  const tr =
    [];


  const plusDM =
    [];


  const minusDM =
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


    const up =
      current.h -
      previous.h;


    const down =
      previous.l -
      current.l;


    plusDM.push(

      up >
          down &&
        up >
          0
        ? up
        : 0

    );


    minusDM.push(

      down >
          up &&
        down >
          0
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
          sum +
          value,
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
          sum +
          value,
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
          sum +
          value,
        0
      );


  const dx =
    [];


  function calculate() {

    if (
      smoothedTR <=
      0
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
      total <=
      0
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


  calculate();


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


    calculate();

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
      fast[i] ===
        null ||
      fast[i] ===
        undefined ||
      slow[i] ===
        null ||
      slow[i] ===
        undefined
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

      line:
        null,

      signal:
        null,

      histogram:
        null

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
    old ===
      0
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
   PERCENTILE
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


/* =========================================================
   SWINGS
========================================================= */

function findSwings(
  candles,
  left = 2,
  right = 2
) {

  const highs =
    [];


  const lows =
    [];


  for (
    let i =
      left;

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
        j ===
        i
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


    if (
      high
    ) {

      highs.push({

        index:
          i,

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


    if (
      low
    ) {

      lows.push({

        index:
          i,

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


/*
   V7 FIX:
   BOS is a fresh CROSS, not simply
   "current close is above an old swing".
*/

function detectBosChoch(
  candles,
  swings
) {

  const currentClose =
    finiteNumber(
      candles.at(-1)?.c
    );


  const previousClose =
    finiteNumber(
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
    currentClose !==
      null &&
    previousClose !==
      null &&
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
    currentClose !==
      null &&
    previousClose !==
      null &&
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

    bos,
    choch,
    structure

  };

}


/* =========================================================
   GENERIC SWEEP
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
        null,

      ageBars:
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
        candle =>
          candle.h
      )
    );


  const low =
    Math.min(
      ...prior.map(
        candle =>
          candle.l
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
        high,

      ageBars:
        0

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
        low,

      ageBars:
        0

    };

  }


  return {

    type:
      "NONE",

    level:
      null,

    ageBars:
      null

  };

}


/* =========================================================
   RECENT LEVEL SWEEP
========================================================= */

function findRecentSweep(
  candles,
  level,
  type,
  lookback = 8
) {

  const n =
    finiteNumber(
      level
    );


  if (
    n ===
    null
  ) {

    return {

      found:
        false,

      ageBars:
        null,

      price:
        null

    };

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

    i >=
      start;

    i--
  ) {

    const candle =
      candles[i];


    if (
      type ===
        "SELL_SIDE" &&
      candle.l <
        n &&
      candle.c >
        n
    ) {

      return {

        found:
          true,

        ageBars:
          candles.length -
          1 -
          i,

        price:
          n

      };

    }


    if (
      type ===
        "BUY_SIDE" &&
      candle.h >
        n &&
      candle.c <
        n
    ) {

      return {

        found:
          true,

        ageBars:
          candles.length -
          1 -
          i,

        price:
          n

      };

    }

  }


  return {

    found:
      false,

    ageBars:
      null,

    price:
      n

  };

}


/* =========================================================
   DISPLACEMENT
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
    atr14 <=
      0
  ) {

    return {

      direction:
        "NONE",

      strength:
        0,

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


  const rangeAtr =
    range /
    atr14;


  const bodyAtr =
    body /
    atr14;


  const bodyRatio =
    body /
    range;


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
    rangeAtr >=
      0.85 &&
    bodyAtr >=
      0.50 &&
    bodyRatio >=
      0.58 &&
    closePosition >=
      0.72
  ) {

    direction =
      "BULLISH";

  }


  if (
    last.c <
      last.o &&
    rangeAtr >=
      0.85 &&
    bodyAtr >=
      0.50 &&
    bodyRatio >=
      0.58 &&
    closePosition <=
      0.28
  ) {

    direction =
      "BEARISH";

  }


  const quality =
    clamp(
      Math.round(

        bodyRatio *
          40 +

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
    );


  return {

    direction,

    strength:
      round(
        bodyAtr,
        2
      ),

    rangeAtr:
      round(
        rangeAtr,
        2
      ),

    bodyRatio:
      round(
        bodyRatio,
        2
      ),

    quality

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
      e200 ===
        null ||
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
      e200 ===
        null ||
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

function candleMomentum(
  candles
) {

  const recent =
    candles.slice(
      -6
    );


  let bull =
    0;


  let bear =
    0;


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
   SNAPSHOT
========================================================= */

function snapshot(
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


  const atrHistory =
    atrSeries(

      candles.slice(
        -250
      ),

      14

    );


  const swings =
    findSwings(
      candles,
      2,
      2
    );


  const structure =
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
      structure.structure,

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
        structure.bos,

      choch:
        structure.choch,

      sweep: {

        type:
          sweep.type,

        level:
          priceRound(
            sweep.level
          ),

        ageBars:
          sweep.ageBars

      },

      lastSwingHigh:
        priceRound(
          latestHigh?.price
        ),

      lastSwingHighAge:
        latestHigh?.ageBars ??
        null,

      lastSwingLow:
        priceRound(
          latestLow?.price
        ),

      lastSwingLowAge:
        latestLow?.ageBars ??
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
    candles.slice(
      -5000
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
      .get(
        key
      )
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

  }


  return {

    currentDay:
      keys.at(-1)
        ? make(
            keys.at(-1)
          )
        : null,

    previousDay:
      keys.at(-2)
        ? make(
            keys.at(-2)
          )
        : null

  };

}


/* =========================================================
   ASIA RANGE
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


  const date =
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
            date &&
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

    date,

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

    bars:
      group.length,

    complete:
      latestLondon.hour >=
      8

  };

}


/* =========================================================
   GOLD CONTEXT
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


  const signals =
    [];


  const events =
    [];


  let bullish =
    0;


  let bearish =
    0;


  function ageMultiplier(
    age
  ) {

    if (
      age ===
        null ||
      age ===
        undefined
    ) {

      return 0;

    }

    if (
      age <=
      1
    ) {

      return 1;

    }

    if (
      age <=
      3
    ) {

      return 0.85;

    }

    if (
      age <=
      6
    ) {

      return 0.65;

    }

    return 0.45;

  }


  if (
    asia?.complete
  ) {

    const lowSweep =
      findRecentSweep(
        m1,
        asia.low,
        "SELL_SIDE",
        10
      );


    if (
      lowSweep.found
    ) {

      const score =
        36 *
        ageMultiplier(
          lowSweep.ageBars
        );


      bullish +=
        score;


      signals.push(
        `Asian low swept ${lowSweep.ageBars} M1 bars ago.`
      );


      events.push({

        type:
          "ASIAN_LOW_SWEEP",

        direction:
          "BULLISH",

        level:
          priceRound(
            asia.low
          ),

        ageBars:
          lowSweep.ageBars

      });

    }


    const highSweep =
      findRecentSweep(
        m1,
        asia.high,
        "BUY_SIDE",
        10
      );


    if (
      highSweep.found
    ) {

      const score =
        36 *
        ageMultiplier(
          highSweep.ageBars
        );


      bearish +=
        score;


      signals.push(
        `Asian high swept ${highSweep.ageBars} M1 bars ago.`
      );


      events.push({

        type:
          "ASIAN_HIGH_SWEEP",

        direction:
          "BEARISH",

        level:
          priceRound(
            asia.high
          ),

        ageBars:
          highSweep.ageBars

      });

    }

  }


  if (
    previousDay
  ) {

    const lowSweep =
      findRecentSweep(
        m1,
        previousDay.low,
        "SELL_SIDE",
        12
      );


    if (
      lowSweep.found
    ) {

      bullish +=
        30 *
        ageMultiplier(
          lowSweep.ageBars
        );


      signals.push(
        `Previous-day low swept ${lowSweep.ageBars} M1 bars ago.`
      );


      events.push({

        type:
          "PDL_SWEEP",

        direction:
          "BULLISH",

        level:
          priceRound(
            previousDay.low
          ),

        ageBars:
          lowSweep.ageBars

      });

    }


    const highSweep =
      findRecentSweep(
        m1,
        previousDay.high,
        "BUY_SIDE",
        12
      );


    if (
      highSweep.found
    ) {

      bearish +=
        30 *
        ageMultiplier(
          highSweep.ageBars
        );


      signals.push(
        `Previous-day high swept ${highSweep.ageBars} M1 bars ago.`
      );


      events.push({

        type:
          "PDH_SWEEP",

        direction:
          "BEARISH",

        level:
          priceRound(
            previousDay.high
          ),

        ageBars:
          highSweep.ageBars

      });

    }

  }


  if (
    packet.M1.ict
      .sweep.type ===
    "BULLISH_SELLSIDE_SWEEP"
  ) {

    bullish +=
      18;

  }


  if (
    packet.M1.ict
      .sweep.type ===
    "BEARISH_BUYSIDE_SWEEP"
  ) {

    bearish +=
      18;

  }


  if (
    packet.M1
      .displacement
      .direction ===
    "BULLISH"
  ) {

    bullish +=
      12;

  }


  if (
    packet.M1
      .displacement
      .direction ===
    "BEARISH"
  ) {

    bearish +=
      12;

  }


  if (
    packet.M5
      .displacement
      .direction ===
    "BULLISH"
  ) {

    bullish +=
      12;

  }


  if (
    packet.M5
      .displacement
      .direction ===
    "BEARISH"
  ) {

    bearish +=
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

    events,

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
    finiteNumber(
      packet.M5
        .indicators
        .adx14
    ) ??
    0;


  const adx15 =
    finiteNumber(
      packet.M15
        .indicators
        .adx14
    ) ??
    0;


  const atrPct =
    finiteNumber(
      packet.M5
        .indicators
        .atrPercentile
    ) ??
    50;


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
        24,

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
            adx5 -
            23
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
            adx5 -
            23
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
   BIAS
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
   MODULE
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
        6
      )

  };

}


/* =========================================================
   TREND MODULE
========================================================= */

function trendModule(
  packet
) {

  const signal =

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

    64 +
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

  let signal =
    0;


  signal +=
    biasSign(
      packet.M15.structure
    ) *
      18;


  signal +=
    biasSign(
      packet.M5.structure
    ) *
      24;


  signal +=
    biasSign(
      packet.M5.ict.bos
    ) *
      22;


  signal +=
    biasSign(
      packet.M1.ict.bos
    ) *
      20;


  signal +=
    biasSign(
      packet.M1.ict.choch
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

  let signal =
    packet.gold
      .bullishLiquidityScore -
    packet.gold
      .bearishLiquidityScore;


  if (
    packet.M1.ict
      .sweep.type ===
    "BULLISH_SELLSIDE_SWEEP"
  ) {

    signal +=
      15;

  }


  if (
    packet.M1.ict
      .sweep.type ===
    "BEARISH_BUYSIDE_SWEEP"
  ) {

    signal -=
      15;

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

    packet.gold.signals

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


  const histogram1 =
    finiteNumber(
      packet.M1
        .indicators
        .macdHistogram
    ) ??
    0;


  const histogram5 =
    finiteNumber(
      packet.M5
        .indicators
        .macdHistogram
    ) ??
    0;


  signal +=
    histogram1 >
      0
      ? 15
      : histogram1 <
          0
        ? -15
        : 0;


  signal +=
    histogram5 >
      0
      ? 10
      : histogram5 <
          0
        ? -10
        : 0;


  const rsi1 =
    finiteNumber(
      packet.M1
        .indicators
        .rsi14
    ) ??
    50;


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
        0.30,

    [

      `M1 ${packet.M1.momentum}`,

      `M5 ${packet.M5.momentum}`,

      `M1 RSI ${round(
        rsi1,
        1
      )}`

    ]

  );

}


/* =========================================================
   REGIME MODULE
========================================================= */

function regimeModule(
  packet
) {

  let signal =
    0;


  switch (
    packet.regime.name
  ) {

    case "TRENDING_BULLISH":

      signal =
        80;

      break;


    case "TRENDING_BEARISH":

      signal =
        -80;

      break;


    case "BREAKOUT_BULLISH":

      signal =
        88;

      break;


    case "BREAKOUT_BEARISH":

      signal =
        -88;

      break;

  }


  return moduleResult(

    "regime",

    signal,

    packet.regime
      .quality,

    [
      packet.regime
        .name
    ]

  );

}


/* =========================================================
   GOLD MODULE
========================================================= */

function goldModule(
  packet
) {

  let signal =
    0;


  const reasons =
    [];


  if (
    scalpSessionAllowed(
      packet.session
    )
  ) {

    if (
      packet.M15.bias ===
      "BULLISH"
    ) {

      signal +=
        15;

    }


    if (
      packet.M15.bias ===
      "BEARISH"
    ) {

      signal -=
        15;

    }


    reasons.push(
      `${packet.session} gold liquidity window.`
    );

  }


  if (
    packet.M1
      .displacement
      .direction ===
    "BULLISH"
  ) {

    signal +=
      25;

    reasons.push(
      `M1 bullish displacement Q${packet.M1.displacement.quality}.`
    );

  }


  if (
    packet.M1
      .displacement
      .direction ===
    "BEARISH"
  ) {

    signal -=
      25;

    reasons.push(
      `M1 bearish displacement Q${packet.M1.displacement.quality}.`
    );

  }


  if (
    packet.M5
      .displacement
      .direction ===
    "BULLISH"
  ) {

    signal +=
      25;

  }


  if (
    packet.M5
      .displacement
      .direction ===
    "BEARISH"
  ) {

    signal -=
      25;

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
        "BULLISH_CHOCH" ||
      packet.M5.ict
        .bos ===
        "BULLISH_BOS";


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
      (
        finiteNumber(
          packet.M1
            .indicators
            .macdHistogram
        ) ??
        0
      ) >
        0;


    const confirmation =
      packet.M5.bias !==
        "BEARISH" ||
      packet.M15.bias ===
        "BULLISH";


    return (
      (
        liquidity ||
        structure
      ) &&
      displacement &&
      momentum &&
      confirmation
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
        "BEARISH_CHOCH" ||
      packet.M5.ict
        .bos ===
        "BEARISH_BOS";


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
      (
        finiteNumber(
          packet.M1
            .indicators
            .macdHistogram
        ) ??
        0
      ) <
        0;


    const confirmation =
      packet.M5.bias !==
        "BULLISH" ||
      packet.M15.bias ===
        "BEARISH";


    return (
      (
        liquidity ||
        structure
      ) &&
      displacement &&
      momentum &&
      confirmation
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


  let numerator =
    0;


  let denominator =
    0;


  let reliabilityTotal =
    0;


  let totalWeight =
    0;


  for (
    const module of
    modules
  ) {

    const weight =
      WEIGHTS[
        module.name
      ];


    const reliabilityFactor =
      Math.max(
        0.25,
        module.reliability /
          100
      );


    numerator +=
      module.signal *
      weight *
      reliabilityFactor;


    denominator +=
      weight *
      reliabilityFactor;


    reliabilityTotal +=
      module.reliability *
      weight;


    totalWeight +=
      weight;

  }


  const signedSignal =
    denominator
      ? numerator /
        denominator
      : 0;


  let quality =
    totalWeight
      ? reliabilityTotal /
        totalWeight
      : 0;


  const buyScore =
    clamp(
      Math.round(
        50 +
        signedSignal /
          2
      ),
      0,
      100
    );


  const sellScore =
    clamp(
      Math.round(
        50 -
        signedSignal /
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
    signedSignal >
      0
      ? "BUY"
      : signedSignal <
          0
        ? "SELL"
        : "WAIT";


  /*
     Weighted agreement only among the main alpha engines.
     Avoid counting regime/session as equal independent votes.
  */

  const agreementModules =
    modules.filter(
      module =>
        [
          "trend",
          "structure",
          "liquidity",
          "momentum"
        ].includes(
          module.name
        ) &&
        Math.abs(
          module.signal
        ) >=
          12
    );


  let directionalWeight =
    0;


  let alignedWeight =
    0;


  for (
    const module of
    agreementModules
  ) {

    const weight =
      WEIGHTS[
        module.name
      ] *
      (
        module.reliability /
        100
      );


    directionalWeight +=
      weight;


    if (
      provisional ===
        "BUY" &&
      module.signal >
        0
    ) {

      alignedWeight +=
        weight;

    }


    if (
      provisional ===
        "SELL" &&
      module.signal <
        0
    ) {

      alignedWeight +=
        weight;

    }

  }


  const agreementPct =
    directionalWeight >
      0
      ? alignedWeight /
        directionalWeight *
        100
      : 0;


  const penalties =
    [];


  const anchor =
    finiteNumber(
      packet.currentPrice
    );


  const ema20 =
    finiteNumber(
      packet.M1
        .indicators
        .ema20
    );


  const atr1 =
    Math.max(
      finiteNumber(
        packet.M1
          .indicators
          .atr14
      ) ??
        0,
      0.01
    );


  const stretch =
    anchor !==
      null &&
    ema20 !==
      null
      ? Math.abs(
          anchor -
          ema20
        ) /
        atr1
      : 0;


  if (
    stretch >
    MAX_ENTRY_STRETCH_ATR
  ) {

    quality -=
      18;


    penalties.push(
      `Signal candle stretched ${round(
        stretch,
        2
      )} ATR from M1 EMA20.`
    );

  }


  if (
    provisional ===
      "BUY" &&
    packet.M5.bias ===
      "BEARISH" &&
    packet.M15.bias ===
      "BEARISH"
  ) {

    quality -=
      22;


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

    quality -=
      22;


    penalties.push(
      "SELL conflicts with both M5 and M15."
    );

  }


  if (
    packet.regime.name ===
    "EXTREME_CHOP"
  ) {

    quality -=
      30;


    penalties.push(
      "Extreme-volatility chop."
    );

  }


  if (
    !scalpSessionAllowed(
      packet.session
    )
  ) {

    quality -=
      packet.session ===
        "ASIA"
        ? 10
        : 20;


    penalties.push(
      `${packet.session} is outside the primary gold scalp window.`
    );

  }


  if (
    agreementPct <
    MIN_MODULE_AGREEMENT
  ) {

    quality -=
      10;


    penalties.push(
      `Weighted agreement ${round(
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


  const trigger =
    provisional !==
      "WAIT"
      ? hasEntryTrigger(
          provisional,
          packet
        )
      : false;


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
    trigger
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
        signedSignal,
        1
      ),

    stretchAtr:
      round(
        stretch,
        2
      ),

    entryTrigger:
      trigger,

    modules,

    penalties

  };

}


/* =========================================================
   LIVE ENTRY STATE
========================================================= */

function buildLiveState(
  technical,
  packet,
  livePrice
) {

  const direction =
    technical.direction;


  const anchor =
    finiteNumber(
      packet.currentPrice
    );


  const price =
    finiteNumber(
      livePrice
    );


  const atr1 =
    finiteNumber(
      packet.M1
        .indicators
        .atr14
    );


  if (
    direction ===
      "WAIT" ||
    anchor ===
      null ||
    price ===
      null ||
    atr1 ===
      null ||
    atr1 <=
      0
  ) {

    return {

      state:
        "SEARCHING",

      direction:
        direction ===
          "WAIT"
          ? null
          : direction,

      entryAllowed:
        false,

      anchor:
        priceRound(
          anchor
        ),

      livePrice:
        priceRound(
          price
        ),

      distanceAtr:
        null,

      message:
        "Waiting for a qualified closed-candle gold setup."

    };

  }


  const signedDistance =
    (
      price -
      anchor
    ) /
    atr1;


  const absoluteDistance =
    Math.abs(
      signedDistance
    );


  if (
    absoluteDistance >
    MAX_LIVE_DEVIATION_ATR
  ) {

    return {

      state:
        "CHASE_BLOCK",

      direction,

      entryAllowed:
        false,

      anchor:
        priceRound(
          anchor
        ),

      livePrice:
        priceRound(
          price
        ),

      distanceAtr:
        round(
          absoluteDistance,
          2
        ),

      message:
        "Gold moved too far from the signal candle. Do not chase."

    };

  }


  /*
     BUY:
     slight pullback from signal close is preferred.

     SELL:
     slight bounce from signal close is preferred.
  */

  if (
    direction ===
    "BUY"
  ) {

    if (
      signedDistance >
      ENTRY_ZONE_ATR
    ) {

      return {

        state:
          "WAITING_FOR_RETEST",

        direction,

        entryAllowed:
          false,

        anchor:
          priceRound(
            anchor
          ),

        livePrice:
          priceRound(
            price
          ),

        distanceAtr:
          round(
            absoluteDistance,
            2
          ),

        message:
          "Bullish setup exists, but gold is extended. Waiting for retest."

      };

    }


    if (
      signedDistance <
      -MAX_LIVE_DEVIATION_ATR
    ) {

      return {

        state:
          "SETUP_INVALID",

        direction,

        entryAllowed:
          false,

        anchor:
          priceRound(
            anchor
          ),

        livePrice:
          priceRound(
            price
          ),

        distanceAtr:
          round(
            absoluteDistance,
            2
          ),

        message:
          "Bullish setup lost too much ground."

      };

    }

  }


  if (
    direction ===
    "SELL"
  ) {

    if (
      signedDistance <
      -ENTRY_ZONE_ATR
    ) {

      return {

        state:
          "WAITING_FOR_RETEST",

        direction,

        entryAllowed:
          false,

        anchor:
          priceRound(
            anchor
          ),

        livePrice:
          priceRound(
            price
          ),

        distanceAtr:
          round(
            absoluteDistance,
            2
          ),

        message:
          "Bearish setup exists, but gold is extended. Waiting for retest."

      };

    }


    if (
      signedDistance >
      MAX_LIVE_DEVIATION_ATR
    ) {

      return {

        state:
          "SETUP_INVALID",

        direction,

        entryAllowed:
          false,

        anchor:
          priceRound(
            anchor
          ),

        livePrice:
          priceRound(
            price
          ),

        distanceAtr:
          round(
            absoluteDistance,
            2
          ),

        message:
          "Bearish setup lost too much ground."

      };

    }

  }


  return {

    state:
      "ENTRY_ZONE",

    direction,

    entryAllowed:
      true,

    anchor:
      priceRound(
        anchor
      ),

    livePrice:
      priceRound(
        price
      ),

    distanceAtr:
      round(
        absoluteDistance,
        2
      ),

    message:
      `${direction} setup is inside the live entry zone.`

  };

}


/* =========================================================
   TARGETS
========================================================= */

function buildTargets(
  direction,
  packet,
  entry
) {

  const levels =
    [];


  function add(
    value,
    name
  ) {

    const price =
      finiteNumber(
        value
      );


    if (
      price ===
      null
    ) {

      return;

    }


    if (
      direction ===
        "BUY" &&
      price >
        entry
    ) {

      levels.push({

        price,
        name

      });

    }


    if (
      direction ===
        "SELL" &&
      price <
        entry
    ) {

      levels.push({

        price,
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


  const sorted =
    levels.sort(
      (
        a,
        b
      ) =>
        Math.abs(
          a.price -
          entry
        ) -
        Math.abs(
          b.price -
          entry
        )
    );


  const unique =
    [];


  for (
    const item of
    sorted
  ) {

    if (
      unique.some(
        previous =>
          Math.abs(
            previous.price -
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
  packet,
  livePrice
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
    finiteNumber(
      livePrice
    );


  const atr1 =
    finiteNumber(
      packet.M1
        .indicators
        .atr14
    );


  if (
    entry ===
      null ||
    atr1 ===
      null ||
    atr1 <=
      0
  ) {

    return {

      valid:
        false,

      reason:
        "Invalid live entry or M1 ATR."

    };

  }


  const swingLow =
    finiteNumber(
      packet.M1.ict
        .lastSwingLow
    );


  const swingHigh =
    finiteNumber(
      packet.M1.ict
        .lastSwingHigh
    );


  const swingLowAge =
    finiteNumber(
      packet.M1.ict
        .lastSwingLowAge
    );


  const swingHighAge =
    finiteNumber(
      packet.M1.ict
        .lastSwingHighAge
    );


  const validLow =
    swingLow !==
      null &&
    swingLowAge !==
      null &&
    swingLowAge <=
      MAX_SWING_AGE_M1 &&
    swingLow <
      entry;


  const validHigh =
    swingHigh !==
      null &&
    swingHighAge !==
      null &&
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
          atr1;

  }
  else {

    stop =
      validHigh
        ? swingHigh +
          buffer
        : entry +
          atr1;

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
        )} ATR; too wide for this scalp.`

    };

  }


  const targets =
    buildTargets(
      direction,
      packet,
      entry
    );


  const nearest =
    targets[0] ??
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


  const baseTP1 =
    entry +
    sign *
      risk *
      TP1_R;


  const baseTP2 =
    entry +
    sign *
      risk *
      TP2_R;


  let tp1 =
    baseTP1;


  let tp2 =
    baseTP2;


  /*
     Liquidity can pull the target CLOSER,
     but V7 never extends TP2 beyond the
     configured TP2_R just because a distant
     liquidity level exists.
  */

  if (
    nearest &&
    nearestR >=
      0.95 &&
    nearestR <
      TP1_R
  ) {

    tp1 =
      nearest.price;

  }


  const inwardTP2Target =
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
            1.30 &&
          rr <
            TP2_R
        );

      }
    );


  if (
    inwardTP2Target
  ) {

    tp2 =
      inwardTP2Target.price;

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
      0.90 ||
    rr2 <
      1.30
  ) {

    return {

      valid:
        false,

      reason:
        `Weak live RR: ${round(
          rr1,
          2
        )}R / ${round(
          rr2,
          2
        )}R.`

    };

  }


  return {

    valid:
      true,

    direction,

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

    nearestLiquidity:
      nearest
        ? {

            name:
              nearest.name,

            price:
              priceRound(
                nearest.price
              ),

            distanceR:
              round(
                nearestR,
                2
              )

          }
        : null,

    targetLiquidity:
      inwardTP2Target
        ?.name ??
      nearest
        ?.name ??
      null,

    management: {

      maxHoldMinutes:
        MAX_HOLD_MINUTES,

      moveStopToBreakevenAtR:
        0.80,

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
   ACCOUNT PROTECTION
========================================================= */

function buildAccountProtection(
  body
) {

  const equity =
    finiteNumber(
      body.equity
    ) ??
    DEFAULT_EQUITY_ZAR;


  const dailyPnL =
    finiteNumber(
      body.dailyPnL
    ) ??
    0;


  const tradesToday =
    finiteNumber(
      body.tradesToday
    ) ??
    0;


  const consecutiveLosses =
    finiteNumber(
      body.consecutiveLosses
    ) ??
    0;


  const minutesSinceLastLoss =
    finiteNumber(
      body.minutesSinceLastLoss
    ) ??
    999;


  const riskPct =
    Math.min(
      RISK_PER_TRADE_PCT,
      MAX_RISK_PER_TRADE_PCT
    );


  const maxRiskZAR =
    equity *
    riskPct /
    100;


  const dailyLossLimitZAR =
    equity *
    DAILY_LOSS_LIMIT_PCT /
    100;


  const blockers =
    [];


  if (
    equity <=
    0
  ) {

    blockers.push(
      "Invalid account equity."
    );

  }


  if (
    dailyPnL <=
    -dailyLossLimitZAR
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
      "Consecutive-loss protection active."
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
        maxRiskZAR,
        2
      ),

    dailyLossLimitZAR:
      round(
        dailyLossLimitZAR,
        2
      ),

    tradesToday,

    consecutiveLosses,

    blockers

  };

}


/* =========================================================
   BROKER EXECUTION
========================================================= */

function floorToStep(
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


function buildExecutionSizing(
  body,
  account,
  riskPlan,
  packet
) {

  const bid =
    finiteNumber(
      body.bid
    );


  const ask =
    finiteNumber(
      body.ask
    );


  const tickSize =
    finiteNumber(
      body.tickSize
    );


  /*
     Prefer an explicitly ZAR-denominated
     tick value for a R200 account.
  */

  const tickValuePerLotZAR =
    finiteNumber(
      body.tickValuePerLotZAR
    ) ??
    finiteNumber(
      body.tickValuePerLot
    );


  const minLot =
    finiteNumber(
      body.minLot
    );


  const lotStep =
    finiteNumber(
      body.lotStep
    );


  const spreadKnown =
    bid !==
      null &&
    ask !==
      null &&
    ask >=
      bid;


  const spread =
    spreadKnown
      ? ask -
        bid
      : null;


  const atr1 =
    finiteNumber(
      packet.M1
        .indicators
        .atr14
    );


  const dynamicSpreadLimit =
    atr1 !==
      null
      ? Math.min(
          MAX_SPREAD_USD,
          Math.max(
            0.15,
            atr1 *
              MAX_SPREAD_ATR_FRACTION
          )
        )
      : MAX_SPREAD_USD;


  if (
    spreadKnown &&
    spread >
      dynamicSpreadLimit
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

      allowedSpread:
        priceRound(
          dynamicSpreadLimit
        ),

      reason:
        `Gold spread ${priceRound(
          spread
        )} exceeds live limit ${priceRound(
          dynamicSpreadLimit
        )}.`

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

      allowedSpread:
        priceRound(
          dynamicSpreadLimit
        ),

      reason:
        "No valid risk plan."

    };

  }


  const sizingAvailable =
    [
      tickSize,
      tickValuePerLotZAR,
      minLot,
      lotStep
    ]
    .every(
      value =>
        value !==
          null &&
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

      allowedSpread:
        priceRound(
          dynamicSpreadLimit
        ),

      reason:
        "Signal can be analysed, but broker tickSize, tickValuePerLotZAR, minLot and lotStep were not all supplied."

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


  const riskPerLotZAR =
    ticks *
    tickValuePerLotZAR;


  if (
    !Number.isFinite(
      riskPerLotZAR
    ) ||
    riskPerLotZAR <=
      0
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
    riskPerLotZAR;


  const lot =
    floorToStep(
      rawLot,
      lotStep
    );


  if (
    lot <
    minLot
  ) {

    const minimumLotRiskZAR =
      riskPerLotZAR *
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
          minimumLotRiskZAR,
          2
        ),

      maxAllowedRiskZAR:
        account.maxRiskZAR,

      reason:
        "Broker minimum lot would risk more than the account allows."

    };

  }


  const estimatedRiskZAR =
    lot *
    riskPerLotZAR;


  return {

    valid:
      estimatedRiskZAR <=
      account.maxRiskZAR *
      1.02,

    executionReady:
      true,

    spread:
      priceRound(
        spread
      ),

    allowedSpread:
      priceRound(
        dynamicSpreadLimit
      ),

    lot:
      round(
        lot,
        4
      ),

    estimatedRiskZAR:
      round(
        estimatedRiskZAR,
        2
      ),

    maxAllowedRiskZAR:
      account.maxRiskZAR,

    tickSize,

    tickValuePerLotZAR,

    minimumLot:
      minLot,

    lotStep

  };

}


/* =========================================================
   NEWS
========================================================= */

function buildNewsGuard(
  body
) {

  const explicitRisk =
    body.highImpactUsdNews ===
    true;


  const minutes =
    finiteNumber(
      body.minutesToHighImpactUsdNews
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
        "High-impact USD news is active."

    };

  }


  if (
    minutes !==
    null
  ) {

    if (
      minutes >=
        0 &&
      minutes <=
        20
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
      "USD news calendar is not connected."

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


  if (
    !last
  ) {

    return {

      valid:
        false,

      stale:
        true,

      reason:
        "No completed M1 candle."

    };

  }


  const endTime =
    parseUTC(
      last.t
    ) +
    60_000;


  const age =
    Math.max(
      0,
      Date.now() -
      endTime
    );


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
   CLOSED CANDLE ENGINE
========================================================= */

function buildClosedCandleAnalysis(
  rawM1
) {

  const m1 =
    completedM1(
      rawM1
    );


  if (
    m1.length <
    500
  ) {

    throw new Error(
      "Not enough completed M1 gold data."
    );

  }


  const lastCompleted =
    m1.at(-1);


  const candleTime =
    lastCompleted.t;


  /*
     Same completed candle:
     reuse technical calculations.
  */

  if (
    analysisCache.candleTime ===
      candleTime &&
    analysisCache.packet &&
    analysisCache.technical
  ) {

    return {

      packet:
        {
          ...analysisCache.packet,

          dataQuality:
            buildDataQuality(
              m1
            )
        },

      technical:
        analysisCache.technical,

      m1,

      analysisFresh:
        false

    };

  }


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
    m5.length <
      60 ||
    m15.length <
      40 ||
    h1.length <
      30
  ) {

    throw new Error(
      "Not enough completed M5/M15/H1 gold data."
    );

  }


  const latestCompletedMs =
    parseUTC(
      lastCompleted.t
    );


  /*
     Technical decisions are anchored to the last
     COMPLETED M1 close, not to every live tick.
  */

  const packet = {

    symbol:
      SYMBOL,

    currentPrice:
      priceRound(
        lastCompleted.c
      ),

    signalAnchorPrice:
      priceRound(
        lastCompleted.c
      ),

    signalCandleTime:
      lastCompleted.t,

    session:
      sessionForTimestamp(
        latestCompletedMs
      ),

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


  analysisCache = {

    candleTime,

    packet,

    technical

  };


  return {

    packet,

    technical,

    m1,

    analysisFresh:
      true

  };

}


/* =========================================================
   PERMISSION
========================================================= */

function buildPermission(
  packet,
  technical,
  liveState,
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

    "Market candle data is stale."
  );


  require(
    scalpSessionAllowed(
      packet.session
    ),

    `${packet.session} is outside the primary live gold scalp session.`
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

    `Weighted agreement below ${MIN_MODULE_AGREEMENT}%.`
  );


  require(
    technical.entryTrigger,

    "No confirmed gold M1 entry trigger."
  );


  require(
    liveState.entryAllowed,

    liveState.message
  );


  require(
    riskPlan.valid,

    riskPlan.reason ||
      "Invalid live risk plan."
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


  if (
    sizing.valid ===
      false &&
    sizing.reason
  ) {

    if (
      sizing.reason
        .toLowerCase()
        .includes(
          "spread"
        ) ||
      sizing.reason
        .toLowerCase()
        .includes(
          "minimum lot"
        )
    ) {

      blockers.push(
        sizing.reason
      );

    }

  }


  if (
    !sizing.executionReady
  ) {

    warnings.push(
      sizing.reason ||
      "Broker execution information unavailable."
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
  liveState,
  riskPlan,
  account,
  sizing,
  news,
  permission,
  livePrice
) {

  const action =
    permission.allowed
      ? technical.direction
      : "WAIT";


  let setupStrength =
    Math.round(

      technical.score *
        0.50 +

      technical.quality *
        0.28 +

      technical.agreementPct *
        0.22

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

    candidateDirection:
      technical.direction,

    setupStrength,

    confidence:
      setupStrength,

    confidenceType:
      "SETUP_STRENGTH_NOT_WIN_PROBABILITY",

    symbol:
      SYMBOL,

    strategy:
      "MKAYFX GOLD SCALPER V7 LIVE",

    session:
      packet.session,

    regime:
      packet.regime,

    currentPrice:
      priceRound(
        livePrice
      ),

    signalAnchorPrice:
      packet.signalAnchorPrice,

    signalCandleTime:
      packet.signalCandleTime,

    liveState,

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

    riskPlan,

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
          : liveState.message,

    nextTrigger:
      action !==
        "WAIT"
        ? `Live ${action} entry approved. Maximum intended hold ${MAX_HOLD_MINUTES} minutes.`
        : technical.direction !==
            "WAIT"
          ? liveState.message
          : "Wait for a fresh liquidity sweep / structure shift / displacement setup."

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
    "Allow",
    "GET, POST, OPTIONS"
  );


  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );


  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );


  res.setHeader(
    "Access-Control-Allow-Methods",
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
       Fetch candles + live price simultaneously.
    */

    const [
      candleResult,
      priceResult
    ] =
      await Promise.allSettled(
        [

          getGoldM1Cached(),

          getGoldPriceCached()

        ]
      );


    if (
      candleResult.status !==
      "fulfilled"
    ) {

      throw candleResult.reason;

    }


    const rawM1 =
      candleResult.value
        .candles;


    const candleCacheHit =
      candleResult.value
        .cacheHit;


    /*
       If /price temporarily fails,
       fall back to latest available candle close.
    */

    let livePrice;


    let priceCacheHit =
      false;


    let livePriceSource =
      "TWELVE_DATA_PRICE";


    if (
      priceResult.status ===
      "fulfilled"
    ) {

      livePrice =
        priceResult.value
          .price;


      priceCacheHit =
        priceResult.value
          .cacheHit;

    }
    else {

      livePrice =
        rawM1.at(-1)?.c;


      livePriceSource =
        "M1_FALLBACK";

    }


    if (
      finiteNumber(
        livePrice
      ) ===
      null
    ) {

      throw new Error(
        "Live XAU/USD price unavailable."
      );

    }


    const {
      packet,
      technical,
      m1,
      analysisFresh
    } =
      buildClosedCandleAnalysis(
        rawM1
      );


    const liveState =
      buildLiveState(
        technical,
        packet,
        livePrice
      );


    const riskPlan =
      buildRiskPlan(
        technical.direction,
        packet,
        livePrice
      );


    const account =
      buildAccountProtection(
        body
      );


    const sizing =
      buildExecutionSizing(
        body,
        account,
        riskPlan,
        packet
      );


    const news =
      buildNewsGuard(
        body
      );


    const permission =
      buildPermission(

        packet,

        technical,

        liveState,

        riskPlan,

        account,

        sizing,

        news

      );


    const analysis =
      buildFinalAnalysis(

        packet,

        technical,

        liveState,

        riskPlan,

        account,

        sizing,

        news,

        permission,

        livePrice

      );


    return send(
      res,
      200,
      {

        success:
          true,

        model:
          "MKAYFX GOLD SCALPER V7 LIVE",

        symbol:
          SYMBOL,

        gold_only:
          true,

        live:
          true,

        price:
          priceRound(
            livePrice
          ),

        live_price_source:
          livePriceSource,

        live_state:
          liveState,

        analysis_fresh:
          analysisFresh,

        /*
           false = same completed M1 signal candle,
           but live price/risk state still updated.
        */

        analysis,

        chart:
          m1
            .slice(
              -180
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

        timeframe_engine: {

          live_price:
            "Twelve Data /price",

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

        data_quality:
          packet.dataQuality,

        cache: {

          candles:
            candleCacheHit,

          livePrice:
            priceCacheHit,

          candleAnalysis:
            !analysisFresh

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
      "MKAYFX GOLD V7 LIVE ERROR:",
      error
    );


    return send(
      res,
      500,
      {

        success:
          false,

        model:
          "MKAYFX GOLD SCALPER V7 LIVE",

        error:
          error?.message ||
          "Unknown server error."

      }
    );

  }

}