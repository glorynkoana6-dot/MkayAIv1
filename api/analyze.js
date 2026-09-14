/* MKAYFX EXTREME AI V4 - ENSEMBLE / REGIME / LIQUIDITY */

const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const GEMINI_MODEL =
  process.env.GEMINI_MODEL ||
  "gemini-3.8-flash";

const USE_WEB_NEWS =
  String(
    process.env.USE_WEB_NEWS ||
    "true"
  ).toLowerCase() === "true";

const REQUIRE_AI_APPROVAL = false;
const USE_GEMINI_FILTER = false;;


/* ======================================================
   URLS
====================================================== */

const TWELVE_URL =
  "https://api.twelvedata.com/time_series";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/interactions";


/* ======================================================
   SETTINGS
====================================================== */

const CACHE_MS = 55_000;

const OUTPUT_SIZE = 1000;

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


const MIN_ENSEMBLE_SCORE =
  Number(
    process.env.MIN_ENSEMBLE_SCORE ||
    63
  );

const MIN_ENSEMBLE_MARGIN =
  Number(
    process.env.MIN_ENSEMBLE_MARGIN ||
    24
  );

const MIN_ENSEMBLE_QUALITY =
  Number(
    process.env.MIN_ENSEMBLE_QUALITY ||
    52
  );


/* ======================================================
   SUPPORTED SYMBOLS
====================================================== */

const ALLOWED_SYMBOLS =
  new Set(
    [
      "XAU/USD",
      "EUR/USD",
      "GBP/USD",
      "USD/JPY",
      "BTC/USD",
      "XBR/USD"
    ]
  );


/* ======================================================
   ENSEMBLE WEIGHTS
====================================================== */

const WEIGHTS =
  Object.freeze(
    {

      trend: 27,

      structure: 23,

      liquidity: 22,

      momentum: 16,

      regime: 8,

      session: 4

    }
  );


/* ======================================================
   CACHE
====================================================== */

const marketCache =
  new Map();

const inFlight =
  new Map();


/* ======================================================
   HELPERS
====================================================== */

function send(
  res,
  status,
  data
){

  return res
    .status(
      status
    )
    .json(
      data
    );

}


function clamp(
  value,
  min,
  max
){

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
){

  const n =
    Number(
      value
    );


  return Number.isFinite(
    n
  )
    ?
    Number(
      n.toFixed(
        digits
      )
    )
    :
    null;

}


function priceDigits(
  symbol
){

  if(
    [
      "EUR/USD",
      "GBP/USD"
    ].includes(
      symbol
    )
  ){

    return 5;

  }


  if(
    symbol ===
    "USD/JPY"
  ){

    return 3;

  }


  return 2;

}


function priceRound(
  symbol,
  value
){

  return round(
    value,
    priceDigits(
      symbol
    )
  );

}


function parseUTC(
  datetime
){

  const clean =
    String(
      datetime ||
      ""
    )
    .trim()
    .replace(
      " ",
      "T"
    );


  const zoned =
    /Z$|[+-]\d\d:\d\d$/
      .test(
        clean
      )
      ?
      clean
      :
      `${clean}Z`;


  return new Date(
    zoned
  )
  .getTime();

}


function getRequestBody(
  req
){

  if(
    !req.body
  ){

    return {};

  }


  if(
    typeof req.body ===
    "object"
  ){

    return req.body;

  }


  try{

    return JSON.parse(
      req.body
    );

  }
  catch{

    return {};

  }

}


/* ======================================================
   FETCH
====================================================== */

async function fetchJson(
  url,
  options = {},
  timeoutMs = 25000
){

  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () => {

        controller.abort();

      },
      timeoutMs
    );


  try{

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
  finally{

    clearTimeout(
      timer
    );

  }

}


/* ======================================================
   TWELVE DATA
====================================================== */

async function requestM5(
  symbol
){

  if(
    !TWELVE_DATA_API_KEY
  ){

    throw new Error(
      "TWELVE_DATA_API_KEY is missing in Vercel."
    );

  }


  const params =
    new URLSearchParams(
      {

        symbol,

        interval:
          "5min",

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

      }
    );


  const {
    response,
    data
  } =
    await fetchJson(
      `${TWELVE_URL}?${params.toString()}`,
      {},
      15000
    );


  if(
    !response.ok ||
    data.status ===
      "error" ||
    !Array.isArray(
      data.values
    )
  ){

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
        item =>
          [
            item.o,
            item.h,
            item.l,
            item.c
          ]
          .every(
            Number.isFinite
          )
      )

      .reverse();


  if(
    candles.length <
    240
  ){

    throw new Error(
      "Not enough market candles returned for analysis."
    );

  }


  return candles;

}


/* ======================================================
   MARKET CACHE
====================================================== */

async function getM5Cached(
  symbol
){

  const key =
    symbol
      .toUpperCase();


  const now =
    Date.now();


  const cached =
    marketCache.get(
      key
    );


  if(
    cached &&
    now -
    cached.time <
    CACHE_MS
  ){

    return {

      candles:
        cached.candles,

      cacheHit:
        true

    };

  }


  if(
    inFlight.has(
      key
    )
  ){

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
    requestM5(
      key
    )

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
      () => {

        inFlight.delete(
          key
        );

      }
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


/* ======================================================
   COMPLETED CANDLES
====================================================== */

function completedCandles(
  candles
){

  return candles.length >
    2
      ?
      candles.slice(
        0,
        -1
      )
      :
      candles;

}


/* ======================================================
   RESAMPLE TIMEFRAMES
====================================================== */

function resample(
  candles,
  minutes
){

  const bucketMs =
    minutes *
    60_000;


  const baseMs =
    5 *
    60_000;


  const buckets =
    new Map();


  for(
    const candle of
    candles
  ){

    const ms =
      parseUTC(
        candle.t
      );


    if(
      !Number.isFinite(
        ms
      )
    ){

      continue;

    }


    const bucket =
      Math.floor(
        ms /
        bucketMs
      ) *
      bucketMs;


    if(
      !buckets.has(
        bucket
      )
    ){

      buckets.set(
        bucket,
        []
      );

    }


    buckets
      .get(
        bucket
      )
      .push(
        candle
      );

  }


  const lastStart =
    parseUTC(
      candles.at(-1)?.t
    );


  const completedThrough =
    Number.isFinite(
      lastStart
    )
      ?
      lastStart +
      baseMs
      :
      null;


  const result =
    [];


  for(
    const [
      timestamp,
      group
    ]
    of buckets
  ){

    if(
      Number.isFinite(
        completedThrough
      ) &&
      timestamp +
      bucketMs >
      completedThrough
    ){

      continue;

    }


    group.sort(
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


    const first =
      group[0];


    const last =
      group.at(
        -1
      );


    result.push(
      {

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
              total,
              item
            ) =>
              total +
              (
                item.v ||
                0
              ),
            0
          )

      }
    );

  }


  return result.sort(
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


/* ======================================================
   SIMPLE MOVING AVERAGE
====================================================== */

function sma(
  values,
  period
){

  if(
    values.length <
    period
  ){

    return null;

  }


  const window =
    values.slice(
      -period
    );


  return window.reduce(
    (
      total,
      value
    ) =>
      total +
      value,
    0
  ) /
  period;

}


/* ======================================================
   EMA
====================================================== */

function emaSeries(
  values,
  period
){

  if(
    values.length <
    period
  ){

    return [];

  }


  const k =
    2 /
    (
      period +
      1
    );


  const seed =
    values
      .slice(
        0,
        period
      )
      .reduce(
        (
          total,
          value
        ) =>
          total +
          value,
        0
      ) /
      period;


  const output =
    Array(
      period -
      1
    )
    .fill(
      null
    );


  let current =
    seed;


  output.push(
    current
  );


  for(
    let index =
      period;

    index <
      values.length;

    index++
  ){

    current =
      (
        values[index] -
        current
      ) *
      k +
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
){

  const series =
    emaSeries(
      values,
      period
    );


  return series.length
    ?
    series.at(
      -1
    )
    :
    null;

}


/* ======================================================
   RSI
====================================================== */

function rsi(
  closes,
  period = 14
){

  if(
    closes.length <=
    period
  ){

    return null;

  }


  let gains =
    0;


  let losses =
    0;


  for(
    let index =
      closes.length -
      period;

    index <
      closes.length;

    index++
  ){

    const difference =
      closes[index] -
      closes[
        index -
        1
      ];


    if(
      difference >
      0
    ){

      gains +=
        difference;

    }
    else{

      losses +=
        Math.abs(
          difference
        );

    }

  }


  const avgGain =
    gains /
    period;


  const avgLoss =
    losses /
    period;


  if(
    avgLoss ===
    0
  ){

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


/* ======================================================
   TRUE RANGE
====================================================== */

function trueRanges(
  candles
){

  const output =
    [];


  for(
    let index =
      1;

    index <
      candles.length;

    index++
  ){

    const candle =
      candles[index];


    const previous =
      candles[
        index -
        1
      ];


    output.push(
      Math.max(

        candle.h -
        candle.l,

        Math.abs(
          candle.h -
          previous.c
        ),

        Math.abs(
          candle.l -
          previous.c
        )

      )
    );

  }


  return output;

}


/* ======================================================
   ATR
====================================================== */

function atr(
  candles,
  period = 14
){

  const ranges =
    trueRanges(
      candles
    );


  return ranges.length >=
    period
      ?
      sma(
        ranges,
        period
      )
      :
      null;

}


/* ======================================================
   MACD
====================================================== */

function macd(
  closes
){

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


  for(
    let index =
      0;

    index <
      closes.length;

    index++
  ){

    if(
      fast[index] ===
      null ||
      fast[index] ===
      undefined ||
      slow[index] ===
      null ||
      slow[index] ===
      undefined
    ){

      continue;

    }


    values.push(
      fast[index] -
      slow[index]
    );

  }


  if(
    values.length <
    9
  ){

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
    values.at(
      -1
    );


  const signal =
    ema(
      values,
      9
    );


  return {

    line,

    signal,

    histogram:
      line -
      signal

  };

}


/* ======================================================
   ADX
====================================================== */

function adx(
  candles,
  period = 14
){

  if(
    candles.length <
    period *
    2 +
    2
  ){

    return null;

  }


  const trs =
    [];


  const plusDM =
    [];


  const minusDM =
    [];


  for(
    let index =
      1;

    index <
      candles.length;

    index++
  ){

    const candle =
      candles[index];


    const previous =
      candles[
        index -
        1
      ];


    const up =
      candle.h -
      previous.h;


    const down =
      previous.l -
      candle.l;


    plusDM.push(
      up >
      down &&
      up >
      0
        ?
        up
        :
        0
    );


    minusDM.push(
      down >
      up &&
      down >
      0
        ?
        down
        :
        0
    );


    trs.push(
      Math.max(

        candle.h -
        candle.l,

        Math.abs(
          candle.h -
          previous.c
        ),

        Math.abs(
          candle.l -
          previous.c
        )

      )
    );

  }


  const dx =
    [];


  for(
    let index =
      period -
      1;

    index <
      trs.length;

    index++
  ){

    const trN =
      trs
        .slice(
          index -
          period +
          1,
          index +
          1
        )
        .reduce(
          (
            total,
            value
          ) =>
            total +
            value,
          0
        );


    if(
      !trN
    ){

      continue;

    }


    const pDM =
      plusDM
        .slice(
          index -
          period +
          1,
          index +
          1
        )
        .reduce(
          (
            total,
            value
          ) =>
            total +
            value,
          0
        );


    const mDM =
      minusDM
        .slice(
          index -
          period +
          1,
          index +
          1
        )
        .reduce(
          (
            total,
            value
          ) =>
            total +
            value,
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


    const denominator =
      pDI +
      mDI;


    if(
      denominator
    ){

      dx.push(
        100 *
        Math.abs(
          pDI -
          mDI
        ) /
        denominator
      );

    }

  }


  if(
    !dx.length
  ){

    return null;

  }


  return sma(
    dx,
    Math.min(
      period,
      dx.length
    )
  );

}


/* ======================================================
   STANDARD DEVIATION
====================================================== */

function stdDev(
  values
){

  if(
    !values.length
  ){

    return null;

  }


  const mean =
    values.reduce(
      (
        total,
        value
      ) =>
        total +
        value,
      0
    ) /
    values.length;


  const variance =
    values.reduce(
      (
        total,
        value
      ) =>
        total +
        (
          value -
          mean
        ) ** 2,
      0
    ) /
    values.length;


  return Math.sqrt(
    variance
  );

}


/* ======================================================
   BOLLINGER BANDS
====================================================== */

function bollinger(
  closes,
  period = 20,
  multiplier = 2
){

  if(
    closes.length <
    period
  ){

    return {

      middle:
        null,

      upper:
        null,

      lower:
        null,

      widthPct:
        null,

      position:
        null

    };

  }


  const window =
    closes.slice(
      -period
    );


  const middle =
    window.reduce(
      (
        total,
        value
      ) =>
        total +
        value,
      0
    ) /
    period;


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
    closes.at(
      -1
    );


  return {

    middle,

    upper,

    lower,

    widthPct:
      middle
        ?
        (
          width /
          Math.abs(
            middle
          )
        ) *
        100
        :
        null,

    position:
      width
        ?
        clamp(
          (
            price -
            lower
          ) /
          width,
          0,
          1
        )
        :
        .5

  };

}


/* ======================================================
   ROC
====================================================== */

function roc(
  closes,
  period = 10
){

  if(
    closes.length <=
    period
  ){

    return null;

  }


  const old =
    closes.at(
      -(
        period +
        1
      )
    );


  const current =
    closes.at(
      -1
    );


  if(
    !Number.isFinite(
      old
    ) ||
    old ===
    0 ||
    !Number.isFinite(
      current
    )
  ){

    return null;

  }


  return (
    (
      current /
      old
    ) -
    1
  ) *
  100;

}


/* ======================================================
   ATR PERCENTILE
====================================================== */

function atrPercentile(
  candles,
  period = 14,
  lookback = 120
){

  const values =
    [];


  const start =
    Math.max(
      period +
      1,
      candles.length -
      lookback
    );


  for(
    let index =
      start;

    index <=
      candles.length;

    index++
  ){

    const slice =
      candles.slice(
        0,
        index
      );


    const value =
      atr(
        slice,
        period
      );


    if(
      Number.isFinite(
        value
      )
    ){

      values.push(
        value
      );

    }

  }


  const current =
    atr(
      candles,
      period
    );


  if(
    !values.length ||
    !Number.isFinite(
      current
    )
  ){

    return null;

  }


  return (
    values.filter(
      value =>
        value <=
        current
    ).length /
    values.length
  ) *
  100;

}


/* ======================================================
   EMA SLOPE NORMALISED BY ATR
====================================================== */

function emaSlopeAtr(
  closes,
  candles,
  period = 20,
  bars = 5
){

  const series =
    emaSeries(
      closes,
      period
    );


  if(
    series.length <=
    bars
  ){

    return null;

  }


  const latest =
    series.at(
      -1
    );


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


  if(
    !Number.isFinite(
      latest
    ) ||
    !Number.isFinite(
      earlier
    ) ||
    !atr14
  ){

    return null;

  }


  return (
    latest -
    earlier
  ) /
  atr14;

}


/* ======================================================
   CANDLE EFFICIENCY
====================================================== */

function candleEfficiency(
  candles,
  bars = 10
){

  const window =
    candles.slice(
      -bars
    );


  if(
    window.length <
    2
  ){

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
        total,
        candle
      ) =>
        total +
        Math.abs(
          candle.c -
          candle.o
        ),
      0
    );


  if(
    !path
  ){

    return 0;

  }


  return clamp(
    net /
    path,
    0,
    1
  );

}


/* ======================================================
   RECENT RANGE
====================================================== */

function recentRange(
  candles,
  bars = 20
){

  const range =
    candles.slice(
      -bars
    );


  return {

    high:
      range.length
        ?
        Math.max(
          ...range.map(
            candle =>
              candle.h
          )
        )
        :
        null,

    low:
      range.length
        ?
        Math.min(
          ...range.map(
            candle =>
              candle.l
          )
        )
        :
        null

  };

}


/* ======================================================
   SWINGS
====================================================== */

function findSwings(
  candles,
  left = 2,
  right = 2
){

  const highs =
    [];


  const lows =
    [];


  for(
    let index =
      left;

    index <
      candles.length -
      right;

    index++
  ){

    const candle =
      candles[index];


    let isHigh =
      true;


    let isLow =
      true;


    for(
      let test =
        index -
        left;

      test <=
        index +
        right;

      test++
    ){

      if(
        test ===
        index
      ){

        continue;

      }


      if(
        candles[test].h >=
        candle.h
      ){

        isHigh =
          false;

      }


      if(
        candles[test].l <=
        candle.l
      ){

        isLow =
          false;

      }

    }


    if(
      isHigh
    ){

      highs.push(
        {

          index,

          price:
            candle.h,

          t:
            candle.t

        }
      );

    }


    if(
      isLow
    ){

      lows.push(
        {

          index,

          price:
            candle.l,

          t:
            candle.t

        }
      );

    }

  }


  return {
    highs,
    lows
  };

}


/* ======================================================
   STRUCTURE
====================================================== */

function structureLabel(
  swings
){

  const highs =
    swings.highs.slice(
      -2
    );


  const lows =
    swings.lows.slice(
      -2
    );


  if(
    highs.length <
    2 ||
    lows.length <
    2
  ){

    return "MIXED";

  }


  if(
    highs[1].price >
    highs[0].price &&
    lows[1].price >
    lows[0].price
  ){

    return "HH/HL";

  }


  if(
    highs[1].price <
    highs[0].price &&
    lows[1].price <
    lows[0].price
  ){

    return "LH/LL";

  }


  return "MIXED";

}


/* ======================================================
   BOS / CHOCH
====================================================== */

function detectBosChoch(
  candles,
  swings
){

  const close =
    candles.at(-1)?.c;


  const priorHigh =
    swings.highs.at(
      -1
    );


  const priorLow =
    swings.lows.at(
      -1
    );


  const structure =
    structureLabel(
      swings
    );


  let bos =
    "NONE";


  let choch =
    "NONE";


  if(
    priorHigh &&
    close >
    priorHigh.price
  ){

    bos =
      "BULLISH_BOS";


    if(
      structure ===
      "LH/LL"
    ){

      choch =
        "BULLISH_CHOCH";

    }

  }


  if(
    priorLow &&
    close <
    priorLow.price
  ){

    bos =
      "BEARISH_BOS";


    if(
      structure ===
      "HH/HL"
    ){

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


/* ======================================================
   LIQUIDITY SWEEP
====================================================== */

function detectLiquiditySweep(
  candles,
  lookback = 20
){

  if(
    candles.length <
    lookback +
    2
  ){

    return {

      type:
        "NONE",

      level:
        null

    };

  }


  const last =
    candles.at(
      -1
    );


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


  if(
    last.h >
    high &&
    last.c <
    high
  ){

    return {

      type:
        "BEARISH_BUYSIDE_SWEEP",

      level:
        high

    };

  }


  if(
    last.l <
    low &&
    last.c >
    low
  ){

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


/* ======================================================
   EQUAL HIGHS / LOWS
====================================================== */

function detectEqualLevels(
  candles,
  atrValue,
  lookback = 40
){

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

      (
        atrValue ||
        0
      ) *
      .18,

      Math.abs(
        candles.at(-1).c
      ) *
      .00008

    );


  let equalHigh =
    null;


  let equalLow =
    null;


  for(
    let index =
      swings.highs.length -
      1;

    index >
      0;

    index--
  ){

    if(
      Math.abs(
        swings.highs[index].price -
        swings.highs[
          index -
          1
        ].price
      ) <=
      tolerance
    ){

      equalHigh =
        (
          swings.highs[index].price +
          swings.highs[
            index -
            1
          ].price
        ) /
        2;


      break;

    }

  }


  for(
    let index =
      swings.lows.length -
      1;

    index >
      0;

    index--
  ){

    if(
      Math.abs(
        swings.lows[index].price -
        swings.lows[
          index -
          1
        ].price
      ) <=
      tolerance
    ){

      equalLow =
        (
          swings.lows[index].price +
          swings.lows[
            index -
            1
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


/* ======================================================
   FAIR VALUE GAPS
====================================================== */

function detectFVG(
  candles,
  lookback = 30
){

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


  for(
    let index =
      start;

    index <
      candles.length;

    index++
  ){

    const first =
      candles[
        index -
        2
      ];


    const third =
      candles[index];


    if(
      third.l >
      first.h
    ){

      bullish = {

        low:
          first.h,

        high:
          third.l,

        t:
          third.t

      };

    }


    if(
      third.h <
      first.l
    ){

      bearish = {

        low:
          third.h,

        high:
          first.l,

        t:
          third.t

      };

    }

  }


  return {

    bullish,

    bearish

  };

}


/* ======================================================
   ORDER BLOCK
====================================================== */

function detectOrderBlock(
  candles,
  bos
){

  if(
    bos ===
    "NONE"
  ){

    return null;

  }


  const bullishBos =
    bos ===
    "BULLISH_BOS";


  const bearishBos =
    bos ===
    "BEARISH_BOS";


  for(
    let index =
      candles.length -
      2;

    index >=
      Math.max(
        0,
        candles.length -
        15
      );

    index--
  ){

    const candle =
      candles[index];


    if(
      bullishBos &&
      candle.c <
      candle.o
    ){

      return {

        type:
          "BULLISH_OB",

        low:
          candle.l,

        high:
          candle.h,

        t:
          candle.t

      };

    }


    if(
      bearishBos &&
      candle.c >
      candle.o
    ){

      return {

        type:
          "BEARISH_OB",

        low:
          candle.l,

        high:
          candle.h,

        t:
          candle.t

      };

    }

  }


  return null;

}


/* ======================================================
   PREMIUM / DISCOUNT
====================================================== */

function premiumDiscount(
  candles,
  bars = 40
){

  const range =
    recentRange(
      candles,
      bars
    );


  const price =
    candles.at(
      -1
    ).c;


  if(
    range.high ===
    null ||
    range.low ===
    null
  ){

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
        ?
        "PREMIUM"
        :
        price <
        midpoint
          ?
          "DISCOUNT"
          :
          "EQUILIBRIUM",

    midpoint

  };

}


/* ======================================================
   TREND BIAS
====================================================== */

function trendBias(
  closes
){

  const price =
    closes.at(
      -1
    );


  if(
    !Number.isFinite(
      price
    ) ||
    closes.length <
    20
  ){

    return "NEUTRAL";

  }


  const fastPeriod =
    closes.length >=
    50
      ?
      20
      :
      8;


  const slowPeriod =
    closes.length >=
    50
      ?
      50
      :
      20;


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
      ?
      ema(
        closes,
        200
      )
      :
      null;


  if(
    fast ===
    null ||
    slow ===
    null
  ){

    return "NEUTRAL";

  }


  if(
    price >
    fast &&
    fast >
    slow &&
    (
      ema200 ===
      null ||
      slow >
      ema200
    )
  ){

    return "BULLISH";

  }


  if(
    price <
    fast &&
    fast <
    slow &&
    (
      ema200 ===
      null ||
      slow <
      ema200
    )
  ){

    return "BEARISH";

  }


  return "NEUTRAL";

}


/* ======================================================
   CANDLE MOMENTUM
====================================================== */

function candleMomentum(
  candles
){

  const recent =
    candles.slice(
      -6
    );


  let bull =
    0;


  let bear =
    0;


  for(
    const candle of
    recent
  ){

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


    if(
      candle.c >
      candle.o
    ){

      bull +=
        body;

    }


    if(
      candle.c <
      candle.o
    ){

      bear +=
        body;

    }

  }


  if(
    bull >
    bear *
    1.25
  ){

    return "BULLISH";

  }


  if(
    bear >
    bull *
    1.25
  ){

    return "BEARISH";

  }


  return "MIXED";

}


/* ======================================================
   SNAPSHOT
====================================================== */

function snapshot(
  symbol,
  candles
){

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


  const premium =
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


  const bands =
    bollinger(
      closes,
      20,
      2
    );


  return {

    price:
      priceRound(
        symbol,
        closes.at(
          -1
        )
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

    indicators:{

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
          bands.middle
        ),

      bollingerUpper:
        priceRound(
          symbol,
          bands.upper
        ),

      bollingerLower:
        priceRound(
          symbol,
          bands.lower
        ),

      bollingerWidthPct:
        round(
          bands.widthPct,
          4
        ),

      bollingerPosition:
        round(
          bands.position,
          3
        ),

      roc10:
        round(
          roc(
            closes,
            10
          ),
          4
        ),

      atrPercentile:
        round(
          atrPercentile(
            candles,
            14,
            120
          ),
          1
        ),

      ema20SlopeAtr:
        round(
          emaSlopeAtr(
            closes,
            candles,
            20,
            5
          ),
          3
        ),

      efficiency:
        round(
          candleEfficiency(
            candles,
            10
          ),
          3
        )

    },

    ict:{

      bos:
        event.bos,

      choch:
        event.choch,

      sweep:{

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
          ?
          {

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
          :
          null,

      bearishFVG:
        fvg.bearish
          ?
          {

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
          :
          null,

      orderBlock:
        (() => {

          const block =
            detectOrderBlock(
              candles,
              event.bos
            );


          return block
            ?
            {

              type:
                block.type,

              low:
                priceRound(
                  symbol,
                  block.low
                ),

              high:
                priceRound(
                  symbol,
                  block.high
                )

            }
            :
            null;

        })(),

      premiumDiscount:
        premium.zone,

      midpoint:
        priceRound(
          symbol,
          premium.midpoint
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

    range:{

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

    }

  };

}


/* ======================================================
   SESSION
====================================================== */

function currentSession(){

  const hour =
    new Date()
      .getUTCHours();


  if(
    hour <
    7
  ){

    return "ASIA";

  }


  if(
    hour <
    12
  ){

    return "LONDON";

  }


  if(
    hour <
    16
  ){

    return "LONDON_NEW_YORK_OVERLAP";

  }


  if(
    hour <
    21
  ){

    return "NEW_YORK";

  }


  return "TRANSITION";

}


/* ======================================================
   DAY KEY
====================================================== */

function dateKeyUTC(
  time
){

  const date =
    new Date(
      parseUTC(
        time
      )
    );


  if(
    !Number.isFinite(
      date.getTime()
    )
  ){

    return null;

  }


  return date
    .toISOString()
    .slice(
      0,
      10
    );

}


/* ======================================================
   PREVIOUS DAY LEVELS
====================================================== */

function previousDayLevels(
  candles
){

  const grouped =
    new Map();


  for(
    const candle of
    candles
  ){

    const key =
      dateKeyUTC(
        candle.t
      );


    if(
      !key
    ){

      continue;

    }


    if(
      !grouped.has(
        key
      )
    ){

      grouped.set(
        key,
        []
      );

    }


    grouped
      .get(
        key
      )
      .push(
        candle
      );

  }


  const keys =
    [
      ...grouped.keys()
    ]
    .sort();


  if(
    !keys.length
  ){

    return {

      previous:
        null,

      current:
        null

    };

  }


  const currentKey =
    keys.at(
      -1
    );


  const previousKey =
    keys.length >=
    2
      ?
      keys.at(
        -2
      )
      :
      null;


  const make =
    key => {

      if(
        !key
      ){

        return null;

      }


      const bars =
        grouped.get(
          key
        ) ||
        [];


      if(
        !bars.length
      ){

        return null;

      }


      return {

        date:
          key,

        high:
          Math.max(
            ...bars.map(
              candle =>
                candle.h
            )
          ),

        low:
          Math.min(
            ...bars.map(
              candle =>
                candle.l
            )
          ),

        open:
          bars[0].o,

        close:
          bars.at(-1).c

      };

    };


  return {

    previous:
      make(
        previousKey
      ),

    current:
      make(
        currentKey
      )

  };

}


/* ======================================================
   SESSION LEVELS
====================================================== */

function currentSessionLevels(
  candles
){

  const now =
    new Date();


  const today =
    now
      .toISOString()
      .slice(
        0,
        10
      );


  const hour =
    now
      .getUTCHours();


  let startHour =
    21;


  let session =
    "TRANSITION";


  if(
    hour <
    7
  ){

    startHour =
      0;

    session =
      "ASIA";

  }
  else if(
    hour <
    12
  ){

    startHour =
      7;

    session =
      "LONDON";

  }
  else if(
    hour <
    16
  ){

    startHour =
      12;

    session =
      "LONDON_NEW_YORK_OVERLAP";

  }
  else if(
    hour <
    21
  ){

    startHour =
      16;

    session =
      "NEW_YORK";

  }


  const bars =
    candles.filter(
      candle => {

        const ms =
          parseUTC(
            candle.t
          );


        if(
          !Number.isFinite(
            ms
          )
        ){

          return false;

        }


        const date =
          new Date(
            ms
          );


        return (
          date
            .toISOString()
            .slice(
              0,
              10
            ) ===
            today &&
          date
            .getUTCHours() >=
            startHour
        );

      }
    );


  if(
    !bars.length
  ){

    return null;

  }


  return {

    session,

    open:
      bars[0].o,

    high:
      Math.max(
        ...bars.map(
          candle =>
            candle.h
        )
      ),

    low:
      Math.min(
        ...bars.map(
          candle =>
            candle.l
        )
      ),

    bars:
      bars.length

  };

}


/* ======================================================
   LIQUIDITY MAP
====================================================== */

function buildLiquidityMap(
  symbol,
  packet,
  m5
){

  const price =
    Number(
      packet.currentPrice
    );


  const atr5 =
    Math.max(

      Number(
        packet.M5.indicators.atr14 ||
        0
      ),

      Math.abs(
        price
      ) *
      .0001

    );


  const day =
    previousDayLevels(
      m5
    );


  const session =
    currentSessionLevels(
      m5
    );


  const pools =
    [];


  const add =
    (
      priceValue,
      label,
      kind
    ) => {

      const numeric =
        Number(
          priceValue
        );


      if(
        !Number.isFinite(
          numeric
        )
      ){

        return;

      }


      pools.push(
        {

          price:
            priceRound(
              symbol,
              numeric
            ),

          label,

          kind,

          side:
            numeric >
            price
              ?
              "BUY_SIDE"
              :
              numeric <
              price
                ?
                "SELL_SIDE"
                :
                "AT_PRICE",

          distance:
            priceRound(
              symbol,
              Math.abs(
                numeric -
                price
              )
            ),

          distanceAtr:
            round(
              Math.abs(
                numeric -
                price
              ) /
              atr5,
              2
            )

        }
      );

    };


  add(
    day.previous?.high,
    "Previous Day High",
    "PDH"
  );


  add(
    day.previous?.low,
    "Previous Day Low",
    "PDL"
  );


  add(
    day.current?.high,
    "Current Day High",
    "CDH"
  );


  add(
    day.current?.low,
    "Current Day Low",
    "CDL"
  );


  add(
    session?.high,
    `${session?.session || "Session"} High`,
    "SESSION_HIGH"
  );


  add(
    session?.low,
    `${session?.session || "Session"} Low`,
    "SESSION_LOW"
  );


  add(
    packet.M5.ict.equalHigh,
    "M5 Equal High",
    "EQUAL_HIGH"
  );


  add(
    packet.M5.ict.equalLow,
    "M5 Equal Low",
    "EQUAL_LOW"
  );


  add(
    packet.M15.ict.equalHigh,
    "M15 Equal High",
    "EQUAL_HIGH"
  );


  add(
    packet.M15.ict.equalLow,
    "M15 Equal Low",
    "EQUAL_LOW"
  );


  add(
    packet.M15.ict.lastSwingHigh,
    "M15 Swing High",
    "SWING_HIGH"
  );


  add(
    packet.M15.ict.lastSwingLow,
    "M15 Swing Low",
    "SWING_LOW"
  );


  add(
    packet.H1.ict.lastSwingHigh,
    "H1 Swing High",
    "SWING_HIGH"
  );


  add(
    packet.H1.ict.lastSwingLow,
    "H1 Swing Low",
    "SWING_LOW"
  );


  pools.sort(
    (
      a,
      b
    ) =>
      Number(
        a.distance
      ) -
      Number(
        b.distance
      )
  );


  return {

    pools,

    nearestBuySide:
      pools.find(
        item =>
          item.side ===
          "BUY_SIDE"
      ) ||
      null,

    nearestSellSide:
      pools.find(
        item =>
          item.side ===
          "SELL_SIDE"
      ) ||
      null,

    previousDay:
      day.previous
        ?
        {

          high:
            priceRound(
              symbol,
              day.previous.high
            ),

          low:
            priceRound(
              symbol,
              day.previous.low
            )

        }
        :
        null,

    currentDay:
      day.current
        ?
        {

          high:
            priceRound(
              symbol,
              day.current.high
            ),

          low:
            priceRound(
              symbol,
              day.current.low
            )

        }
        :
        null,

    currentSession:
      session
        ?
        {

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
        :
        null,

    sweep:{

      M5:
        packet.M5.ict.sweep,

      M15:
        packet.M15.ict.sweep

    },

    zones:{

      M5BullishFVG:
        packet.M5.ict.bullishFVG,

      M5BearishFVG:
        packet.M5.ict.bearishFVG,

      M15BullishFVG:
        packet.M15.ict.bullishFVG,

      M15BearishFVG:
        packet.M15.ict.bearishFVG,

      M5OrderBlock:
        packet.M5.ict.orderBlock,

      M15OrderBlock:
        packet.M15.ict.orderBlock

    }

  };

}


/* ======================================================
   REGIME ENGINE
====================================================== */

function detectRegimeDetails(
  packet
){

  const adxValue =
    Number(
      packet.M15.indicators.adx14 ||
      0
    );


  const atrPercent =
    Number(
      packet.M15.indicators.atrPercentile ??
      50
    );


  const atrValue =
    Number(
      packet.M15.indicators.atr14 ||
      0
    );


  const rangeSize =
    Number(
      packet.M15.range.high
    ) -
    Number(
      packet.M15.range.low
    );


  const rangeAtr =
    atrValue >
    0
      ?
      rangeSize /
      atrValue
      :
      null;


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


  let name =
    "MIXED";


  let trend =
    "NEUTRAL";


  let quality =
    55;


  let volatility =
    "NORMAL";


  const notes =
    [];


  if(
    atrPercent >=
    85
  ){

    volatility =
      "EXTREME";

  }
  else if(
    atrPercent >=
    65
  ){

    volatility =
      "HIGH";

  }
  else if(
    atrPercent <=
    25
  ){

    volatility =
      "LOW";

  }


  if(
    alignedBull &&
    adxValue >=
    24
  ){

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
      "H1 and M15 are bullish with trend-strength confirmation."
    );

  }
  else if(
    alignedBear &&
    adxValue >=
    24
  ){

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
      "H1 and M15 are bearish with trend-strength confirmation."
    );

  }


  if(
    packet.M15.ict.bos ===
      "BULLISH_BOS" &&
    h1 !==
      "BEARISH" &&
    adxValue >=
      19 &&
    atrPercent >=
      45
  ){

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
          .8
        ),
        72,
        92
      );


    notes.push(
      "M15 bullish BOS with acceptable expansion."
    );

  }
  else if(
    packet.M15.ict.bos ===
      "BEARISH_BOS" &&
    h1 !==
      "BULLISH" &&
    adxValue >=
      19 &&
    atrPercent >=
      45
  ){

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
          .8
        ),
        72,
        92
      );


    notes.push(
      "M15 bearish BOS with acceptable expansion."
    );

  }
  else if(
    adxValue <
      17 &&
    Number.isFinite(
      rangeAtr
    ) &&
    rangeAtr <=
      5.2
  ){

    name =
      "COMPRESSION";


    quality =
      38;


    notes.push(
      "Low ADX and compressed M15 range."
    );

  }
  else if(
    adxValue <
      19 &&
    name ===
      "MIXED"
  ){

    name =
      "RANGE";


    quality =
      44;


    notes.push(
      "Weak directional strength; range conditions dominate."
    );

  }


  if(
    atrPercent >=
      90 &&
    hardConflict
  ){

    name =
      "HIGH_VOLATILITY_CHOP";


    trend =
      "NEUTRAL";


    quality =
      28;


    notes.push(
      "Extreme volatility with H1/M15 conflict."
    );

  }
  else if(
    hardConflict &&
    name ===
      "MIXED"
  ){

    name =
      "REVERSAL_RISK";


    quality =
      42;


    notes.push(
      "H1 and M15 disagree; transition risk is elevated."
    );

  }


  if(
    m5 !==
      "NEUTRAL" &&
    m15 !==
      "NEUTRAL" &&
    m5 !==
      m15
  ){

    quality =
      Math.max(
        25,
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
        atrPercent,
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

    hardConflict,

    notes

  };

}


/* ======================================================
   DIRECTION HELPERS
====================================================== */

function biasSign(
  value
){

  if(
    [
      "BULLISH",
      "HH/HL",
      "BULLISH_BOS",
      "BULLISH_CHOCH"
    ].includes(
      value
    )
  ){

    return 1;

  }


  if(
    [
      "BEARISH",
      "LH/LL",
      "BEARISH_BOS",
      "BEARISH_CHOCH"
    ].includes(
      value
    )
  ){

    return -1;

  }


  return 0;

}


/* ======================================================
   MODULE RESULT
====================================================== */

function moduleResult(
  name,
  signal,
  reliability,
  reasons = []
){

  const signed =
    clamp(
      Math.round(
        signal
      ),
      -100,
      100
    );


  const reliable =
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
      signed,

    reliability:
      reliable,

    bias:
      signed >=
      12
        ?
        "BULLISH"
        :
        signed <=
        -12
          ?
          "BEARISH"
          :
          "NEUTRAL",

    confidence:
      clamp(
        Math.round(
          50 +
          Math.abs(
            signed
          ) *
          .5
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


/* ======================================================
   TREND MODULE
====================================================== */

function trendModule(
  packet
){

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


  signal +=
    clamp(
      Number(
        packet.H1.indicators.ema20SlopeAtr ||
        0
      ) *
      9,
      -9,
      9
    );


  signal +=
    clamp(
      Number(
        packet.M15.indicators.ema20SlopeAtr ||
        0
      ) *
      7,
      -7,
      7
    );


  return moduleResult(
    "trend",
    signal,
    54 +
    Math.abs(
      signal
    ) *
    .38,
    [

      `H4 ${packet.H4.bias}`,

      `H1 ${packet.H1.bias}`,

      `M15 ${packet.M15.bias}`,

      `M5 ${packet.M5.bias}`

    ]
  );

}


/* ======================================================
   STRUCTURE MODULE
====================================================== */

function structureModule(
  packet
){

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


  return moduleResult(
    "structure",
    signal,
    46 +
    Math.abs(
      signal
    ) *
    .47,
    [

      `H1 structure ${packet.H1.structure}`,

      `M15 structure ${packet.M15.structure}`,

      `M15 ${packet.M15.ict.bos}`,

      `M15 ${packet.M15.ict.choch}`

    ]
  );

}


/* ======================================================
   LIQUIDITY MODULE
====================================================== */

function liquidityModule(
  packet
){

  let signal =
    0;


  const reasons =
    [];


  if(
    packet.M5.ict.sweep.type ===
    "BULLISH_SELLSIDE_SWEEP"
  ){

    signal +=
      35;


    reasons.push(
      "M5 sell-side liquidity sweep reclaimed."
    );

  }


  if(
    packet.M5.ict.sweep.type ===
    "BEARISH_BUYSIDE_SWEEP"
  ){

    signal -=
      35;


    reasons.push(
      "M5 buy-side liquidity sweep rejected."
    );

  }


  if(
    packet.M15.ict.sweep.type ===
    "BULLISH_SELLSIDE_SWEEP"
  ){

    signal +=
      24;


    reasons.push(
      "M15 sell-side liquidity sweep reclaimed."
    );

  }


  if(
    packet.M15.ict.sweep.type ===
    "BEARISH_BUYSIDE_SWEEP"
  ){

    signal -=
      24;


    reasons.push(
      "M15 buy-side liquidity sweep rejected."
    );

  }


  if(
    packet.M15.ict.premiumDiscount ===
    "DISCOUNT"
  ){

    signal +=
      13;

  }


  if(
    packet.M15.ict.premiumDiscount ===
    "PREMIUM"
  ){

    signal -=
      13;

  }


  if(
    packet.M15.ict.bullishFVG
  ){

    signal +=
      8;

  }


  if(
    packet.M15.ict.bearishFVG
  ){

    signal -=
      8;

  }


  if(
    packet.M15.ict.orderBlock?.type ===
    "BULLISH_OB"
  ){

    signal +=
      9;

  }


  if(
    packet.M15.ict.orderBlock?.type ===
    "BEARISH_OB"
  ){

    signal -=
      9;

  }


  return moduleResult(
    "liquidity",
    signal,
    44 +
    Math.abs(
      signal
    ) *
    .5,
    reasons
  );

}


/* ======================================================
   MOMENTUM MODULE
====================================================== */

function momentumModule(
  packet
){

  let signal =
    0;


  const hist5 =
    Number(
      packet.M5.indicators.macdHistogram ||
      0
    );


  const hist15 =
    Number(
      packet.M15.indicators.macdHistogram ||
      0
    );


  const rsi5 =
    Number(
      packet.M5.indicators.rsi14 ||
      50
    );


  const roc5 =
    Number(
      packet.M5.indicators.roc10 ||
      0
    );


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


  signal +=
    hist5 >
    0
      ?
      14
      :
      hist5 <
      0
        ?
        -14
        :
        0;


  signal +=
    hist15 >
    0
      ?
      10
      :
      hist15 <
      0
        ?
        -10
        :
        0;


  signal +=
    clamp(
      (
        rsi5 -
        50
      ) *
      .9,
      -18,
      18
    );


  signal +=
    clamp(
      roc5 *
      4,
      -12,
      12
    );


  return moduleResult(
    "momentum",
    signal,
    48 +
    Math.abs(
      signal
    ) *
    .42,
    [

      `M5 momentum ${packet.M5.momentum}`,

      `M15 momentum ${packet.M15.momentum}`,

      `M5 RSI ${round(rsi5,1)}`,

      `M5 MACD histogram ${hist5 >= 0 ? "positive" : "negative"}`

    ]
  );

}


/* ======================================================
   REGIME MODULE
====================================================== */

function regimeModule(
  packet
){

  const regime =
    packet.regimeDetails;


  let signal =
    0;


  if(
    regime.name ===
    "TRENDING_BULLISH"
  ){

    signal =
      78;

  }
  else if(
    regime.name ===
    "TRENDING_BEARISH"
  ){

    signal =
      -78;

  }
  else if(
    regime.name ===
    "BREAKOUT_BULLISH"
  ){

    signal =
      88;

  }
  else if(
    regime.name ===
    "BREAKOUT_BEARISH"
  ){

    signal =
      -88;

  }
  else if(
    regime.name ===
    "REVERSAL_RISK"
  ){

    signal =
      biasSign(
        packet.M15.ict.choch
      ) *
      42;

  }
  else if(
    regime.name ===
    "MIXED"
  ){

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


/* ======================================================
   SESSION MODULE
====================================================== */

function sessionModule(
  packet
){

  const liquid =
    [
      "LONDON",
      "LONDON_NEW_YORK_OVERLAP",
      "NEW_YORK"
    ].includes(
      packet.session
    );


  let signal =
    0;


  if(
    packet.H1.bias ===
    packet.M15.bias &&
    packet.M15.bias !==
    "NEUTRAL"
  ){

    signal =
      biasSign(
        packet.M15.bias
      ) *
      (
        liquid
          ?
          65
          :
          36
      );

  }
  else if(
    packet.M15.bias !==
    "NEUTRAL"
  ){

    signal =
      biasSign(
        packet.M15.bias
      ) *
      (
        liquid
          ?
          32
          :
          18
      );

  }


  return moduleResult(
    "session",
    signal,
    liquid
      ?
      58
      :
      30,
    [

      `${packet.session} session`,

      liquid
        ?
        "Active liquidity window."
        :
        "Lower-liquidity context."

    ]
  );

}


/* ======================================================
   EXTREME ENSEMBLE ENGINE
====================================================== */

function scoreTechnical(
  packet
){

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


  let weightedSignal =
    0;


  let weightedReliability =
    0;


  let denominator =
    0;


  const totalWeight =
    Object.values(
      WEIGHTS
    )
    .reduce(
      (
        total,
        value
      ) =>
        total +
        value,
      0
    );


  for(
    const module of
    modules
  ){

    const weight =
      WEIGHTS[
        module.name
      ] ||
      0;


    const reliabilityFactor =
      Math.max(
        .25,
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
      ?
      weightedSignal /
      denominator
      :
      0;


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
    signal >
    0
      ?
      "BUY"
      :
      signal <
      0
        ?
        "SELL"
        :
        "WAIT";


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

        if(
          provisional ===
          "BUY"
        ){

          return module.signal >
            0;

        }


        if(
          provisional ===
          "SELL"
        ){

          return module.signal <
            0;

        }


        return false;

      }
    ).length;


  const agreementPct =
    directionalModules.length
      ?
      (
        agreeing /
        directionalModules.length
      ) *
      100
      :
      0;


  const penalties =
    [];


  const price =
    Number(
      packet.currentPrice
    );


  const atr5 =
    Math.max(

      Number(
        packet.M5.indicators.atr14 ||
        0
      ),

      Math.abs(
        price
      ) *
      .0001

    );


  const ema20 =
    Number(
      packet.M5.indicators.ema20
    );


  const stretch =
    Number.isFinite(
      ema20
    )
      ?
      Math.abs(
        price -
        ema20
      ) /
      atr5
      :
      0;


  const rsi5 =
    Number(
      packet.M5.indicators.rsi14 ||
      50
    );


  if(
    stretch >
    2
  ){

    quality -=
      15;


    penalties.push(
      `Price is ${round(stretch,2)} ATR from M5 EMA20.`
    );

  }
  else if(
    stretch >
    1.5
  ){

    quality -=
      8;


    penalties.push(
      `Price is extended ${round(stretch,2)} ATR from M5 EMA20.`
    );

  }


  if(
    packet.regimeDetails.name ===
    "HIGH_VOLATILITY_CHOP"
  ){

    quality -=
      20;


    penalties.push(
      "High-volatility chop regime."
    );

  }


  if(
    [
      "RANGE",
      "COMPRESSION"
    ].includes(
      packet.regimeDetails.name
    )
  ){

    quality -=
      8;


    penalties.push(
      `${packet.regimeDetails.name.toLowerCase()} regime reduces continuation quality.`
    );

  }


  if(
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
  ){

    quality -=
      8;


    penalties.push(
      "H4/H1 directional conflict."
    );

  }


  if(
    provisional ===
    "BUY" &&
    rsi5 >
    76
  ){

    quality -=
      8;


    penalties.push(
      "M5 RSI is overbought for a fresh BUY."
    );

  }


  if(
    provisional ===
    "SELL" &&
    rsi5 <
    24
  ){

    quality -=
      8;


    penalties.push(
      "M5 RSI is oversold for a fresh SELL."
    );

  }


  if(
    agreementPct <
    50 &&
    directionalModules.length >=
    3
  ){

    quality -=
      10;


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


  if(
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
  ){

    direction =
      provisional;

  }


  const ranked =
    [
      ...modules
    ]
    .sort(
      (
        a,
        b
      ) => {

        const impactA =
          Math.abs(
            a.signal
          ) *
          (
            WEIGHTS[
              a.name
            ] ||
            0
          ) *
          (
            a.reliability /
            100
          );


        const impactB =
          Math.abs(
            b.signal
          ) *
          (
            WEIGHTS[
              b.name
            ] ||
            0
          ) *
          (
            b.reliability /
            100
          );


        return impactB -
          impactA;

      }
    );


  const reasons =
    [];


  for(
    const module of
    ranked
  ){

    const aligned =
      direction ===
      "BUY"
        ?
        module.signal >
        0
        :
        direction ===
        "SELL"
          ?
          module.signal <
          0
          :
          Math.abs(
            module.signal
          ) >=
          12;


    if(
      !aligned
    ){

      continue;

    }


    reasons.push(
      `${module.name.toUpperCase()}: ${module.bias} (${module.confidence}% module confidence)`
    );


    if(
      module.reasons?.[0]
    ){

      reasons.push(
        module.reasons[0]
      );

    }


    if(
      reasons.length >=
      8
    ){

      break;

    }

  }


  if(
    !reasons.length
  ){

    reasons.push(
      "Ensemble did not produce enough directional separation."
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


/* ======================================================
   LIQUIDITY TARGETS
====================================================== */

function candidateLiquidityTargets(
  direction,
  packet,
  entry
){

  const levels =
    [];


  const add =
    (
      value,
      name,
      kind = "LEVEL"
    ) => {

      const price =
        Number(
          value
        );


      if(
        !Number.isFinite(
          price
        )
      ){

        return;

      }


      if(
        direction ===
        "BUY" &&
        price >
        entry
      ){

        levels.push(
          {
            price,
            name,
            kind
          }
        );

      }


      if(
        direction ===
        "SELL" &&
        price <
        entry
      ){

        levels.push(
          {
            price,
            name,
            kind
          }
        );

      }

    };


  for(
    const pool of
    packet.liquidityMap?.pools ||
    []
  ){

    add(
      pool.price,
      pool.label,
      pool.kind
    );

  }


  add(
    packet.H1.range.high,
    "H1 Range High",
    "RANGE_HIGH"
  );


  add(
    packet.H1.range.low,
    "H1 Range Low",
    "RANGE_LOW"
  );


  const tolerance =
    Math.abs(
      entry
    ) *
    .00003;


  const unique =
    [];


  for(
    const item of
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
    )
  ){

    if(
      unique.some(
        existing =>
          Math.abs(
            existing.price -
            item.price
          ) <=
          tolerance
      )
    ){

      continue;

    }


    unique.push(
      item
    );

  }


  return unique;

}


/* ======================================================
   SMART ENTRY / SL / TP ENGINE
====================================================== */

function buildRiskPlan(
  direction,
  symbol,
  packet
){

  if(
    direction ===
    "WAIT"
  ){

    return {

      valid:
        false,

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
        packet.M5.indicators.atr14 ||
        0
      ),

      Math.abs(
        entry
      ) *
      .0001

    );


  const swingLow =
    Number(
      packet.M5.ict.lastSwingLow
    );


  const swingHigh =
    Number(
      packet.M5.ict.lastSwingHigh
    );


  const ema20 =
    Number(
      packet.M5.indicators.ema20
    );


  const stretchAtr =
    Number.isFinite(
      ema20
    )
      ?
      Math.abs(
        entry -
        ema20
      ) /
      atr5
      :
      0;


  if(
    stretchAtr >
    2.05
  ){

    return {

      valid:
        false,

      reason:
        `Price is stretched ${round(stretchAtr,2)} ATR from M5 EMA20; wait for a retest.`,

      entryType:
        "WAIT_RETEST",

      suggestedEntry:
        Number.isFinite(
          ema20
        )
          ?
          priceRound(
            symbol,
            ema20
          )
          :
          null,

      stretchAtr:
        round(
          stretchAtr,
          2
        )

    };

  }


  const regime =
    packet.regimeDetails.name;


  let stopAtrFactor =
    1.08;


  if(
    regime.startsWith(
      "TRENDING_"
    )
  ){

    stopAtrFactor =
      1;

  }


  if(
    regime.startsWith(
      "BREAKOUT_"
    )
  ){

    stopAtrFactor =
      1.12;

  }


  if(
    regime ===
    "RANGE"
  ){

    stopAtrFactor =
      .95;

  }


  if(
    regime ===
    "HIGH_VOLATILITY_CHOP"
  ){

    stopAtrFactor =
      1.35;

  }


  const buffer =
    atr5 *
    .20;


  let stop;


  if(
    direction ===
    "BUY"
  ){

    const structureStop =
      Number.isFinite(
        swingLow
      ) &&
      swingLow <
      entry
        ?
        swingLow -
        buffer
        :
        entry -
        atr5 *
        1.25;


    stop =
      Math.min(

        entry -
        atr5 *
        stopAtrFactor,

        structureStop

      );

  }
  else{

    const structureStop =
      Number.isFinite(
        swingHigh
      ) &&
      swingHigh >
      entry
        ?
        swingHigh +
        buffer
        :
        entry +
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


  if(
    !Number.isFinite(
      risk
    ) ||
    risk <=
    0
  ){

    return {

      valid:
        false,

      reason:
        "Invalid stop distance.",

      entryType:
        "NONE"

    };

  }


  if(
    risk >
    atr5 *
    2.8
  ){

    return {

      valid:
        false,

      reason:
        `Logical stop is ${round(risk/atr5,2)} ATR wide, above the 2.8 ATR safety limit.`,

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
      ?
      Math.abs(
        nearest.price -
        entry
      ) /
      risk
      :
      null;


  if(
    roomR !==
      null &&
    roomR <
      .80
  ){

    return {

      valid:
        false,

      reason:
        `Nearest target liquidity (${nearest.name}) is only ${roomR.toFixed(2)}R away.`,

      entryType:
        "NONE"

    };

  }


  const sign =
    direction ===
    "BUY"
      ?
      1
      :
      -1;


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


  if(
    nearest &&
    roomR >=
      1.05 &&
    roomR <
      TP1_R
  ){

    tp1 =
      nearest.price;

  }


  const secondTarget =
    targets.find(
      target =>
        Math.abs(
          target.price -
          entry
        ) /
        risk >=
        1.45
    );


  if(
    secondTarget
  ){

    const secondR =
      Math.abs(
        secondTarget.price -
        entry
      ) /
      risk;


    if(
      secondR >=
        1.45 &&
      secondR <=
        TP2_R *
        1.35
    ){

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


  if(
    rr1 <
      1 ||
    rr2 <
      1.4
  ){

    return {

      valid:
        false,

      reason:
        `Risk/reward is too weak (TP1 ${round(rr1,2)}R, TP2 ${round(rr2,2)}R).`,

      entryType:
        "NONE"

    };

  }


  let entryType =
    "MARKET";


  if(
    regime.startsWith(
      "BREAKOUT_"
    )
  ){

    entryType =
      "BREAKOUT_CONTINUATION";

  }
  else if(
    stretchAtr >=
    1.25
  ){

    entryType =
      "CAUTION_EXTENDED";

  }
  else if(
    regime.startsWith(
      "TRENDING_"
    )
  ){

    entryType =
      "TREND_CONTINUATION";

  }


  return {

    valid:
      true,

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
      `1:${round(rr2,2)}`,

    riskDistance:
      priceRound(
        symbol,
        risk
      ),

    stopAtr:
      round(
        risk /
        atr5,
        2
      ),

    stretchAtr:
      round(
        stretchAtr,
        2
      ),

    nearestLiquidity:
      nearest
        ?
        {

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
        :
        null,

    targetLiquidity:
      secondTarget
        ?
        {

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
        :
        null

  };

}


/* ======================================================
   PRE-TRADE PERMISSION ENGINE
====================================================== */

function buildPreTradePermission(
  packet,
  technical,
  riskPlan
){

  const checks =
    [];


  const blockers =
    [];


  const warnings =
    [];


  const check =
    (
      name,
      pass,
      detail,
      hard = true
    ) => {

      checks.push(
        {

          name,

          pass:
            Boolean(
              pass
            ),

          detail

        }
      );


      if(
        !pass &&
        hard
      ){

        blockers.push(
          detail
        );

      }


      if(
        !pass &&
        !hard
      ){

        warnings.push(
          detail
        );

      }

    };


  check(

    "ensembleScore",

    technical.score >=
      MIN_ENSEMBLE_SCORE,

    `Ensemble score ${technical.score} is below ${MIN_ENSEMBLE_SCORE}.`

  );


  check(

    "directionalMargin",

    technical.margin >=
      MIN_ENSEMBLE_MARGIN,

    `Directional margin ${technical.margin} is below ${MIN_ENSEMBLE_MARGIN}.`

  );


  check(

    "ensembleQuality",

    technical.quality >=
      MIN_ENSEMBLE_QUALITY,

    `Ensemble quality ${technical.quality} is below ${MIN_ENSEMBLE_QUALITY}.`

  );


  check(

    "moduleAgreement",

    technical.agreementPct >=
      50,

    `Module agreement ${technical.agreementPct}% is below 50%.`

  );


  check(

    "riskPlan",

    Boolean(
      riskPlan.valid
    ),

    riskPlan.reason ||
    "Risk plan is invalid."

  );


  check(

    "regimeSafety",

    packet.regime !==
      "HIGH_VOLATILITY_CHOP",

    "High-volatility chop blocks fresh entries."

  );


  check(

    "higherTimeframeConflict",

    !packet.regimeDetails.hardConflict,

    "H1/M15 hard directional conflict is active.",

    false

  );


  return {

    allowed:
      blockers.length ===
        0 &&
      technical.direction !==
        "WAIT",

    checks,

    blockers,

    warnings

  };

}


/* ======================================================
   GEMINI REVIEW SCHEMA
====================================================== */

const REVIEW_SCHEMA =
{

  type:
    "object",

  additionalProperties:
    false,

  properties:{

    verdict:{

      type:
        "string",

      enum:[
        "APPROVE",
        "REJECT",
        "WAIT"
      ]

    },

    confidence:{

      type:
        "integer",

      minimum:
        0,

      maximum:
        99

    },

    macroBias:{

      type:
        "string"

    },

    newsRisk:{

      type:
        "string",

      enum:[
        "LOW",
        "MEDIUM",
        "HIGH",
        "UNKNOWN"
      ]

    },

    newsBlock:{

      type:
        "boolean"

    },

    newsSummary:{

      type:
        "string"

    },

    reasons:{

      type:
        "array",

      items:{

        type:
          "string"

      },

      minItems:
        2,

      maxItems:
        6

    },

    risks:{

      type:
        "array",

      items:{

        type:
          "string"

      },

      minItems:
        1,

      maxItems:
        5

    }

  },

  required:[

    "verdict",

    "confidence",

    "macroBias",

    "newsRisk",

    "newsBlock",

    "newsSummary",

    "reasons",

    "risks"

  ]

};


/* ======================================================
   CRITIC SCHEMA
====================================================== */

const CRITIC_SCHEMA =
{

  type:
    "object",

  additionalProperties:
    false,

  properties:{

    verdict:{

      type:
        "string",

      enum:[
        "PASS",
        "REJECT"
      ]

    },

    riskLevel:{

      type:
        "string",

      enum:[
        "LOW",
        "MEDIUM",
        "HIGH"
      ]

    },

    summary:{

      type:
        "string"

    },

    issues:{

      type:
        "array",

      items:{

        type:
          "string"

      },

      minItems:
        1,

      maxItems:
        6

    }

  },

  required:[

    "verdict",

    "riskLevel",

    "summary",

    "issues"

  ]

};


/* ======================================================
   EXTRACT GEMINI TEXT
====================================================== */

function extractInteractionText(
  data
){

  const output =
    [];


  for(
    const step of
    data.steps ||
    []
  ){

    if(
      step.type !==
      "model_output"
    ){

      continue;

    }


    for(
      const block of
      step.content ||
      []
    ){

      if(
        block.type ===
        "text" &&
        typeof block.text ===
        "string"
      ){

        output.push(
          block.text
        );

      }

    }

  }


  return output
    .join(
      ""
    )
    .trim();

}


/* ======================================================
   EXTRACT SEARCH SOURCES
====================================================== */

function extractSources(
  data
){

  const result =
    [];


  const seen =
    new Set();


  const walk =
    value => {

      if(
        !value ||
        typeof value !==
        "object"
      ){

        return;

      }


      if(
        Array.isArray(
          value
        )
      ){

        value.forEach(
          walk
        );

        return;

      }


      const url =
        value.url ||
        value.uri;


      if(
        typeof url ===
          "string" &&
        /^https?:\/\//
          .test(
            url
          ) &&
        !seen.has(
          url
        )
      ){

        seen.add(
          url
        );


        result.push(
          {

            title:
              value.title ||
              "Source",

            url

          }
        );

      }


      Object
        .values(
          value
        )
        .forEach(
          walk
        );

    };


  walk(
    data.steps ||
    []
  );


  return result.slice(
    0,
    6
  );

}


/* ======================================================
   GEMINI CALL
====================================================== */

async function callGemini(
  {
    systemInstruction,
    input,
    schema,
    thinking = "high",
    useSearch = false
  }
){

  if(
    !GEMINI_API_KEY
  ){

    throw new Error(
      "GEMINI_API_KEY is missing in Vercel."
    );

  }


  const body =
  {

    model:
      GEMINI_MODEL,

    system_instruction:
      systemInstruction,

    input,

    response_format:{

      type:
        "text",

      mime_type:
        "application/json",

      schema

    },

    generation_config:{

      thinking_level:
        thinking,

      max_output_tokens:
        2400

    },

    store:
      false

  };


  if(
    useSearch
  ){

    body.tools =
      [
        {

          type:
            "google_search",

          search_types:[
            "web_search"
          ]

        }
      ];

  }


  const {
    response,
    data
  } =
    await fetchJson(
      GEMINI_URL,
      {

        method:
          "POST",

        headers:{

          "Content-Type":
            "application/json",

          "x-goog-api-key":
            GEMINI_API_KEY

        },

        body:
          JSON.stringify(
            body
          )

      },
      28000
    );


  if(
    !response.ok
  ){

    throw new Error(
      data?.error?.message ||
      `Gemini API error ${response.status}`
    );

  }


  if(
    data.status &&
    data.status !==
    "completed"
  ){

    throw new Error(
      `Gemini status: ${data.status}`
    );

  }


  const text =
    extractInteractionText(
      data
    );


  if(
    !text
  ){

    throw new Error(
      "Gemini returned no text."
    );

  }


  let parsed;


  try{

    parsed =
      JSON.parse(
        text
      );

  }
  catch{

    throw new Error(
      "Gemini returned invalid JSON."
    );

  }


  return {

    value:
      parsed,

    sources:
      extractSources(
        data
      ),

    usage:
      data.usage ||
      null

  };

}


/* ======================================================
   AI REVIEWER
====================================================== */

async function getAiReview(
  packet,
  technical,
  riskPlan
){

  const systemInstruction =
`You are the independent reviewer for MKAYFX.

Code already chose the candidate direction using a deterministic ensemble.

You may APPROVE, REJECT, or WAIT.

You may NOT flip BUY to SELL or SELL to BUY.

Review:

- trend
- structure
- liquidity
- momentum
- regime
- entry quality
- overextension
- risk reward
- session
- macro conditions
- current high-impact news

Prefer REJECT or WAIT when evidence conflicts.

If Google Search is available:

newsBlock=true ONLY when reliable current information shows a high-impact catalyst relevant to this symbol is imminent, approximately within the next 20 minutes, or has just occurred approximately within the past 10 minutes and price may be abnormally unstable.

Never claim certainty.

Never claim guaranteed profit.`;


  const compact =
  {

    symbol:
      packet.symbol,

    currentUTC:
      packet.currentUTC,

    session:
      packet.session,

    regime:
      packet.regimeDetails,

    ensemble:
      technical,

    riskPlan,

    liquidityMap:
      packet.liquidityMap,

    H4:
      packet.H4,

    H1:
      packet.H1,

    M15:
      packet.M15,

    M5:
      packet.M5

  };


  return callGemini(
    {

      systemInstruction,

      input:
        `Review this candidate. Direction is locked; do not flip it.\n${JSON.stringify(compact)}`,

      schema:
        REVIEW_SCHEMA,

      thinking:
        "high",

      useSearch:
        USE_WEB_NEWS

    }
  );

}


/* ======================================================
   ADVERSARIAL CRITIC
====================================================== */

async function getAiCritic(
  packet,
  technical,
  riskPlan,
  review
){

  const systemInstruction =
`You are MKAYFX's adversarial trade critic.

Try to DISPROVE the candidate trade.

Check:

- timeframe conflict
- false BOS
- false CHOCH
- fake liquidity sweeps
- stale FVG
- weak order blocks
- poor market regime
- overextension
- nearby opposing liquidity
- weak risk reward
- reviewer overconfidence

PASS only when no major contradiction remains.

Do not change the direction.

Do not invent new price levels.`;


  const compact =
  {

    symbol:
      packet.symbol,

    currentUTC:
      packet.currentUTC,

    session:
      packet.session,

    regime:
      packet.regimeDetails,

    ensemble:
      technical,

    riskPlan,

    review,

    liquidityMap:
      packet.liquidityMap,

    H1:
      packet.H1,

    M15:
      packet.M15,

    M5:
      packet.M5

  };


  return callGemini(
    {

      systemInstruction,

      input:
        `Attack this setup and return PASS or REJECT.\n${JSON.stringify(compact)}`,

      schema:
        CRITIC_SCHEMA,

      thinking:
        "medium",

      useSearch:
        false

    }
  );

}


/* ======================================================
   TIMEFRAME STRENGTH
====================================================== */

function timeframeStrength(
  timeframe
){

  let score =
    50;


  const adxValue =
    Number(
      timeframe.indicators.adx14 ||
      0
    );


  const slope =
    Number(
      timeframe.indicators.ema20SlopeAtr ||
      0
    );


  const efficiency =
    Number(
      timeframe.indicators.efficiency ||
      0
    );


  score +=
    clamp(
      (
        adxValue -
        18
      ) *
      1.5,
      -12,
      22
    );


  score +=
    clamp(
      Math.abs(
        slope
      ) *
      12,
      0,
      18
    );


  score +=
    clamp(
      (
        efficiency -
        .25
      ) *
      35,
      -10,
      15
    );


  if(
    timeframe.bias ===
    "NEUTRAL"
  ){

    score -=
      10;

  }


  return clamp(
    Math.round(
      score
    ),
    10,
    100
  );

}


/* ======================================================
   SETUP GRADE
====================================================== */

function gradeFromConfidence(
  action,
  confidence
){

  if(
    action ===
    "WAIT"
  ){

    return "WAIT";

  }


  if(
    confidence >=
    90
  ){

    return "A+";

  }


  if(
    confidence >=
    84
  ){

    return "A";

  }


  if(
    confidence >=
    78
  ){

    return "B+";

  }


  if(
    confidence >=
    70
  ){

    return "B";

  }


  return "C";

}


/* ======================================================
   FINAL DECISION
====================================================== */

function buildFinalAnalysis(
  packet,
  technical,
  riskPlan,
  permission,
  review,
  critic,
  aiError
){

  let action =
    technical.direction;


  const rejectionReasons =
    [];


  if(
    action !==
      "WAIT" &&
    !permission.allowed
  ){

    rejectionReasons.push(
      ...permission.blockers
    );


    action =
      "WAIT";

  }


  if(
    action !==
      "WAIT" &&
    !riskPlan.valid
  ){

    rejectionReasons.push(
      riskPlan.reason ||
      "Risk plan rejected the setup."
    );


    action =
      "WAIT";

  }


  if(
    action !==
      "WAIT" &&
    REQUIRE_AI_APPROVAL
  ){

    if(
      !review
    ){

      rejectionReasons.push(
        "AI approval unavailable."
      );


      action =
        "WAIT";

    }
    else if(
      review.verdict !==
      "APPROVE"
    ){

      rejectionReasons.push(
        `AI reviewer: ${review.verdict}.`
      );


      action =
        "WAIT";

    }
    else if(
      review.confidence <
      70
    ){

      rejectionReasons.push(
        "AI reviewer confidence is below 70%."
      );


      action =
        "WAIT";

    }
    else if(
      review.newsBlock
    ){

      rejectionReasons.push(
        "High-impact news block is active."
      );


      action =
        "WAIT";

    }

  }


  if(
    action !==
      "WAIT" &&
    critic
  ){

    if(
      critic.verdict !==
        "PASS" ||
      critic.riskLevel ===
        "HIGH"
    ){

      rejectionReasons.push(
        `AI critic rejected setup (${critic.riskLevel} risk).`
      );


      action =
        "WAIT";

    }

  }
  else if(
    action !==
      "WAIT" &&
    REQUIRE_AI_APPROVAL &&
    !critic
  ){

    rejectionReasons.push(
      "AI critic unavailable."
    );


    action =
      "WAIT";

  }


  const technicalConfidence =
    Math.round(

      technical.score *
      .50 +

      technical.quality *
      .25 +

      technical.agreementPct *
      .25

    );


  const aiConfidence =
    review
      ?
      Number(
        review.confidence ||
        0
      )
      :
      technicalConfidence;


  let confidence =
    Math.round(

      technicalConfidence *
      .60 +

      aiConfidence *
      .40

    );


  if(
    critic?.riskLevel ===
    "MEDIUM"
  ){

    confidence -=
      5;

  }


  if(
    critic?.riskLevel ===
    "LOW"
  ){

    confidence +=
      1;

  }


  confidence =
    clamp(
      confidence,
      action ===
      "WAIT"
        ?
        30
        :
        60,
      96
    );


  const directionText =
    technical.direction ===
    "WAIT"
      ?
      `No ensemble trade passed the ${MIN_ENSEMBLE_SCORE} score / ${MIN_ENSEMBLE_MARGIN} margin / ${MIN_ENSEMBLE_QUALITY} quality gates.`
      :
      `${technical.direction} ensemble candidate scored ${technical.score}/100, quality ${technical.quality}/100, agreement ${technical.agreementPct}%, with ${technical.margin}-point separation.`;


  const summary =
    action ===
    "WAIT"
      ?
      `${directionText}${rejectionReasons.length ? ` Final filter: ${rejectionReasons.join(" ")}` : ""}`
      :
      `${technical.direction} passed ensemble, regime, liquidity/risk plan, AI reviewer and adversarial critic.`;


  const liquidityMap =
    packet.liquidityMap ||
    {};


  return {

    action,

    confidence,

    setupGrade:
      gradeFromConfidence(
        action,
        confidence
      ),

    summary,


    timeframeBias:{

      M5:
        packet.M5.bias,

      M15:
        packet.M15.bias,

      H1:
        packet.H1.bias,

      H4:
        packet.H4.bias

    },


    timeframes:{

      m5:{

        bias:
          packet.M5.bias,

        strength:
          timeframeStrength(
            packet.M5
          )

      },

      m15:{

        bias:
          packet.M15.bias,

        strength:
          timeframeStrength(
            packet.M15
          )

      },

      h1:{

        bias:
          packet.H1.bias,

        strength:
          timeframeStrength(
            packet.H1
          )

      },

      h4:{

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
      `H4 ${packet.H4.structure}; H1 ${packet.H1.structure}; M15 ${packet.M15.structure}; M5 ${packet.M5.structure}.`,


    momentum:
      packet.M5.momentum,


    liquiditySummary:
      `Buy-side: ${
        liquidityMap.nearestBuySide
          ?
          `${liquidityMap.nearestBuySide.label} ${liquidityMap.nearestBuySide.price}`
          :
          "none mapped"
      }. Sell-side: ${
        liquidityMap.nearestSellSide
          ?
          `${liquidityMap.nearestSellSide.label} ${liquidityMap.nearestSellSide.price}`
          :
          "none mapped"
      }. M5 sweep ${packet.M5.ict.sweep.type}; M15 zone ${packet.M15.ict.premiumDiscount}.`,


    liquidityMap,


    macroBias:
      review?.macroBias ||
      "UNKNOWN",


    newsRisk:
      review?.newsRisk ||
      "UNKNOWN",


    newsSummary:
      review?.newsSummary ||
      (
        aiError
          ?
          `AI/news unavailable: ${aiError}`
          :
          "Live news scan not available."
      ),


    entry:
      action ===
      "WAIT"
        ?
        null
        :
        riskPlan.entry,


    stopLoss:
      action ===
      "WAIT"
        ?
        null
        :
        riskPlan.stopLoss,


    takeProfit1:
      action ===
      "WAIT"
        ?
        null
        :
        riskPlan.takeProfit1,


    takeProfit2:
      action ===
      "WAIT"
        ?
        null
        :
        riskPlan.takeProfit2,


    riskReward:
      action ===
      "WAIT"
        ?
        "—"
        :
        riskPlan.riskReward,


    entryType:
      action ===
      "WAIT"
        ?
        (
          riskPlan.entryType ||
          "WAIT"
        )
        :
        riskPlan.entryType,


    invalidation:
      action ===
      "BUY"
        ?
        `Bullish setup invalid below ${riskPlan.stopLoss}.`
        :
        action ===
        "SELL"
          ?
          `Bearish setup invalid above ${riskPlan.stopLoss}.`
          :
          "No active setup.",


    nextTrigger:
      riskPlan.entryType ===
      "WAIT_RETEST"
        ?
        `Wait for price to retrace toward ${riskPlan.suggestedEntry || "the M5 EMA20 area"}, then rescan.`
        :
        action ===
        "WAIT"
          ?
          "Wait for a fresh ensemble-qualified setup with acceptable regime, liquidity room and AI permission."
          :
          `Maintain ${action} only while M5/M15 structure remains supportive; rescan after a material structure or news change.`,


    reasons:[

      ...technical.reasons,

      ...(
        review?.reasons ||
        []
      ),

      ...(
        critic?.verdict ===
        "PASS"
          ?
          [
            "Adversarial AI critic passed the setup."
          ]
          :
          []
      )

    ]
    .slice(
      0,
      10
    ),


    risks:[

      ...technical.penalties,

      ...(
        permission.warnings ||
        []
      ),

      ...(
        review?.risks ||
        []
      ),

      ...(
        critic?.issues ||
        []
      ),

      ...rejectionReasons

    ]
    .slice(
      0,
      10
    ),


    technicalScore:{

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


    ensemble:{

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


    tradePermission:{

      preAi:
        permission,

      aiReviewer:
        review
          ?
          {

            verdict:
              review.verdict,

            confidence:
              review.confidence,

            newsBlock:
              review.newsBlock,

            newsRisk:
              review.newsRisk

          }
          :
          null,

      critic:
        critic
          ?
          {

            verdict:
              critic.verdict,

            riskLevel:
              critic.riskLevel

          }
          :
          null,

      finalAllowed:
        action !==
        "WAIT",

      state:
        action !==
        "WAIT"
          ?
          "APPROVED"
          :
          "BLOCKED",

      blockers:
        rejectionReasons

    },


    aiReview:
      review
        ?
        {

          verdict:
            review.verdict,

          confidence:
            review.confidence,

          newsBlock:
            review.newsBlock

        }
        :
        null,


    aiCritic:
      critic
        ?
        {

          verdict:
            critic.verdict,

          riskLevel:
            critic.riskLevel,

          summary:
            critic.summary

        }
        :
        null,


    riskPlan:
      riskPlan.valid
        ?
        riskPlan
        :
        {

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


/* ======================================================
   MAIN VERCEL API
====================================================== */

export default async function handler(
  req,
  res
){

  res.setHeader(
    "Cache-Control",
    "no-store"
  );


  res.setHeader(
    "Allow",
    "GET, POST, OPTIONS"
  );


  if(
    req.method ===
    "OPTIONS"
  ){

    return res
      .status(
        204
      )
      .end();

  }


  if(
    req.method !==
      "GET" &&
    req.method !==
      "POST"
  ){

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


  try{

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


    if(
      !ALLOWED_SYMBOLS.has(
        symbol
      )
    ){

      return send(
        res,
        400,
        {

          success:
            false,

          error:
            `Unsupported symbol: ${symbol}`

        }
      );

    }


    /* ======================
       LOAD MARKET DATA
    ====================== */

    const {
      candles:
        rawM5,
      cacheHit
    } =
      await getM5Cached(
        symbol
      );


    const currentPrice =
      rawM5.at(
        -1
      ).c;


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


    if(
      m5.length <
        180 ||
      m15.length <
        50 ||
      h1.length <
        24 ||
      h4.length <
        6
    ){

      throw new Error(
        "Not enough completed candles for M5/M15/H1/H4 analysis."
      );

    }


    /* ======================
       MARKET PACKET
    ====================== */

    const packet =
    {

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


    /* ======================
       ADVANCED ENGINES
    ====================== */

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
      packet.regimeDetails.name;


    /* ======================
       ENSEMBLE
    ====================== */

    const technical =
      scoreTechnical(
        packet
      );


    /* ======================
       RISK PLAN
    ====================== */

    const riskPlan =
      buildRiskPlan(
        technical.direction,
        symbol,
        packet
      );


    /* ======================
       PERMISSION ENGINE
    ====================== */

    const permission =
      buildPreTradePermission(
        packet,
        technical,
        riskPlan
      );


    /* ======================
       AI REVIEW
    ====================== */

    let review =
      null;


    let critic =
      null;


    let sources =
      [];


    let aiError =
      null;


    let usage =
      null;


    if(
      GEMINI_API_KEY
    ){

      try{

        const reviewResult =
          await getAiReview(
            packet,
            technical,
            riskPlan
          );


        review =
          reviewResult.value;


        sources =
          reviewResult.sources;


        usage =
        {

          reviewer:
            reviewResult.usage

        };


        /* ======================
           RUN CRITIC ONLY AFTER
           FIRST AI APPROVES
        ====================== */

        if(
          technical.direction !==
            "WAIT" &&
          permission.allowed &&
          riskPlan.valid &&
          review.verdict ===
            "APPROVE" &&
          review.confidence >=
            70 &&
          !review.newsBlock
        ){

          const criticResult =
            await getAiCritic(
              packet,
              technical,
              riskPlan,
              review
            );


          critic =
            criticResult.value;


          usage.critic =
            criticResult.usage;

        }

      }
      catch(
        error
      ){

        aiError =
          error?.name ===
          "AbortError"
            ?
            "Gemini request timed out."
            :
            (
              error?.message ||
              "Gemini failed."
            );


        console.error(
          "Gemini error:",
          error
        );

      }

    }
    else{

      aiError =
        "GEMINI_API_KEY is not configured.";

    }


    /* ======================
       FINAL JUDGE
    ====================== */

    const analysis =
      buildFinalAnalysis(
        packet,
        technical,
        riskPlan,
        permission,
        review,
        critic,
        aiError
      );


    /* ======================
       RECENT CHANGE
    ====================== */

    const oldPrice =
      rawM5[
        Math.max(
          0,
          rawM5.length -
          13
        )
      ]?.c;


    const changePct =
      oldPrice
        ?
        (
          (
            currentPrice /
            oldPrice
          ) -
          1
        ) *
        100
        :
        0;


    /* ======================
       RESPONSE
    ====================== */

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
          GEMINI_API_KEY
            ?
            GEMINI_MODEL
            :
            "deterministic-hybrid",


        ai_provider:
          GEMINI_API_KEY
            ?
            "Google Gemini"
            :
            "None",


        ai_online:
          Boolean(
            review
          ),


        ai_error:
          aiError,


        analysis,


        chart:
          rawM5
            .slice(
              -60
            )
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
          "Twelve Data M5 + completed local M15/H1/H4 + ensemble/regime/liquidity + Gemini reviewer/critic",


        cache_hit:
          cacheHit,


        guardrail_note:
          cacheHit
            ?
            "55-second market cache used."
            :
            "Fresh M5 data loaded; higher timeframes generated locally from completed candles.",


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
          sources,


        ai_usage:
          usage,


        timestamp:
          new Date()
            .toISOString()

      }
    );

  }
  catch(
    error
  ){

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