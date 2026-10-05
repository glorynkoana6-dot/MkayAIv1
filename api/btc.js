/* ============================================================
   MKAYFX BTC LIQUIDITY INTELLIGENCE ENGINE V2.1
   ------------------------------------------------------------
   FILE:
   /api/btc.js

   FIXES
   ------------------------------------------------------------
   - Prevents [object Object] errors
   - Cleaner Coinbase error handling
   - Safer JSON parsing
   - Safer candle fetching
   - Safer frontend-compatible error response
   - Coinbase-only BTC-USD
============================================================ */

const PRODUCT =
  "BTC-USD";

const COINBASE =
  "https://api.exchange.coinbase.com";


const SETTINGS = {

  M5_GRANULARITY: 300,
  H1_GRANULARITY: 3600,
  D1_GRANULARITY: 86400,

  M5_CANDLES: 280,
  H1_CANDLES: 280,
  D1_CANDLES: 40,

  ATR_PERIOD: 14,
  RSI_PERIOD: 14,

  EMA_FAST: 20,
  EMA_MID: 50,
  EMA_SLOW: 200,

  SWING_STRENGTH: 2,
  EQUAL_LEVEL_ATR_TOLERANCE: 0.12,

  ROUND_NUMBER_STEP: 1000,
  MAJOR_ROUND_NUMBER_STEP: 5000,

  TRACKING_SCORE: 35,
  ARMED_SCORE: 55,

  SWEEP_MIN_ATR: 0.04,
  SWEEP_MAX_ATR: 0.45,

  SIGNAL_SCORE: 70,
  SIGNAL_GAP: 7,

  TP1_R: 1.5,
  TP2_R: 2.5,

  STOP_ATR: 0.55,

  ORDER_BOOK_LEVELS: 30,
  VOLUME_LOOKBACK: 20

};


/* ============================================================
   HELPERS
============================================================ */

function num(
  value,
  fallback = 0
) {

  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;

}


function round(
  value,
  digits = 2
) {

  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(Number(value))
  ) {

    return null;

  }

  const p =
    10 ** digits;

  return (
    Math.round(
      Number(value) *
      p
    ) / p
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


function average(
  values
) {

  if (!values.length) {

    return 0;

  }

  return (
    values.reduce(
      (a, b) =>
        a + b,
      0
    ) /
    values.length
  );

}


/* ============================================================
   ERROR STRING NORMALIZER
============================================================ */

function errorText(
  error
) {

  if (
    error === null ||
    error === undefined
  ) {

    return "Unknown error";

  }


  if (
    typeof error ===
    "string"
  ) {

    return error;

  }


  if (
    error instanceof Error
  ) {

    return (
      error.message ||
      error.name ||
      "Unknown error"
    );

  }


  if (
    typeof error ===
    "object"
  ) {

    if (
      typeof error.message ===
      "string"
    ) {

      return error.message;

    }


    if (
      typeof error.error ===
      "string"
    ) {

      return error.error;

    }


    try {

      return JSON.stringify(
        error
      );

    }

    catch {

      return "Unknown object error";

    }

  }


  return String(
    error
  );

}


/* ============================================================
   HTTP
============================================================ */

async function getJSON(
  url,
  timeoutMs = 9000
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

          method:
            "GET",

          headers: {

            Accept:
              "application/json",

            "User-Agent":
              "MKAYFX-BTC-V2.1"

          },

          cache:
            "no-store",

          signal:
            controller.signal

        }
      );


    const rawText =
      await response.text();


    let data = null;


    try {

      data =
        rawText
          ? JSON.parse(rawText)
          : null;

    }

    catch {

      throw new Error(
        `Coinbase returned invalid JSON. HTTP ${response.status}. Response: ${rawText.slice(0, 180)}`
      );

    }


    if (
      !response.ok
    ) {

      let message =
        `Coinbase HTTP ${response.status}`;


      if (
        typeof data?.message ===
        "string"
      ) {

        message =
          data.message;

      }

      else if (
        typeof data?.error ===
        "string"
      ) {

        message =
          data.error;

      }

      else if (
        data
      ) {

        try {

          message =
            JSON.stringify(
              data
            );

        }

        catch {}

      }


      throw new Error(
        message
      );

    }


    return data;

  }

  catch (
    error
  ) {

    if (
      error?.name ===
      "AbortError"
    ) {

      throw new Error(
        "Coinbase request timed out"
      );

    }


    throw new Error(
      errorText(
        error
      )
    );

  }

  finally {

    clearTimeout(
      timer
    );

  }

}


/* ============================================================
   COINBASE ENDPOINTS
============================================================ */

async function fetchTicker() {

  return getJSON(
    `${COINBASE}/products/${PRODUCT}/ticker`
  );

}


async function fetchTrades() {

  return getJSON(
    `${COINBASE}/products/${PRODUCT}/trades`
  );

}


async function fetchOrderBook() {

  return getJSON(
    `${COINBASE}/products/${PRODUCT}/book?level=2`
  );

}


/* ============================================================
   CANDLES
============================================================ */

async function fetchCandles({
  granularity,
  count
}) {

  const now =
    Math.floor(
      Date.now() /
      1000
    );


  const safeCount =
    Math.min(
      Math.max(
        Number(count) || 50,
        10
      ),
      280
    );


  const end =
    now;


  const start =
    end -
    granularity *
    safeCount;


  const url =
    `${COINBASE}/products/${PRODUCT}/candles` +
    `?granularity=${granularity}` +
    `&start=${start}` +
    `&end=${end}`;


  const raw =
    await getJSON(
      url
    );


  if (
    !Array.isArray(raw)
  ) {

    throw new Error(
      `Coinbase candle response was not an array: ${errorText(raw)}`
    );

  }


  const candles =
    raw
      .map(
        row => ({

          timestamp:
            num(
              row?.[0]
            ) *
            1000,

          low:
            num(
              row?.[1]
            ),

          high:
            num(
              row?.[2]
            ),

          open:
            num(
              row?.[3]
            ),

          close:
            num(
              row?.[4]
            ),

          volume:
            num(
              row?.[5]
            )

        })
      )
      .filter(
        candle =>
          candle.timestamp > 0 &&
          candle.high > 0 &&
          candle.low > 0 &&
          candle.open > 0 &&
          candle.close > 0
      )
      .sort(
        (a, b) =>
          a.timestamp -
          b.timestamp
      );


  const unique =
    new Map();


  for (
    const candle of
    candles
  ) {

    unique.set(
      candle.timestamp,
      candle
    );

  }


  return [
    ...unique.values()
  ];

}


/* ============================================================
   RESAMPLE
============================================================ */

function resample(
  candles,
  targetMinutes
) {

  const interval =
    targetMinutes *
    60 *
    1000;


  const buckets =
    new Map();


  for (
    const candle of
    candles
  ) {

    const key =
      Math.floor(
        candle.timestamp /
        interval
      ) *
      interval;


    if (
      !buckets.has(key)
    ) {

      buckets.set(
        key,
        {

          timestamp:
            key,

          open:
            candle.open,

          high:
            candle.high,

          low:
            candle.low,

          close:
            candle.close,

          volume:
            candle.volume

        }
      );

    }

    else {

      const bucket =
        buckets.get(
          key
        );


      bucket.high =
        Math.max(
          bucket.high,
          candle.high
        );


      bucket.low =
        Math.min(
          bucket.low,
          candle.low
        );


      bucket.close =
        candle.close;


      bucket.volume +=
        candle.volume;

    }

  }


  return [
    ...buckets.values()
  ].sort(
    (a, b) =>
      a.timestamp -
      b.timestamp
  );

}


/* ============================================================
   EMA
============================================================ */

function emaSeries(
  values,
  period
) {

  if (!values.length) {

    return [];

  }


  const multiplier =
    2 /
    (
      period +
      1
    );


  const output =
    [];


  let current =
    values[0];


  for (
    const value of
    values
  ) {

    current =
      value *
      multiplier +
      current *
      (
        1 -
        multiplier
      );


    output.push(
      current
    );

  }


  return output;

}


/* ============================================================
   RSI
============================================================ */

function calculateRSI(
  closes,
  period = 14
) {

  if (
    closes.length <
    period + 1
  ) {

    return 50;

  }


  let gains =
    0;


  let losses =
    0;


  for (
    let i =
      closes.length -
      period;
    i <
      closes.length;
    i++
  ) {

    const change =
      closes[i] -
      closes[i - 1];


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


  if (
    losses ===
    0
  ) {

    return 100;

  }


  const rs =
    gains /
    losses;


  return (
    100 -
    100 /
    (
      1 +
      rs
    )
  );

}


/* ============================================================
   ATR
============================================================ */

function calculateATR(
  candles,
  period = 14
) {

  if (
    candles.length <
    period + 1
  ) {

    return 0;

  }


  const tr =
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
      candles[i - 1];


    tr.push(

      Math.max(

        current.high -
        current.low,

        Math.abs(
          current.high -
          previous.close
        ),

        Math.abs(
          current.low -
          previous.close
        )

      )

    );

  }


  return average(
    tr.slice(
      -period
    )
  );

}


/* ============================================================
   STRUCTURE
============================================================ */

function detectStructure(
  candles
) {

  if (
    !candles ||
    candles.length <
    15
  ) {

    return {

      bias:
        "NEUTRAL",

      bull:
        0,

      bear:
        0,

      score:
        0,

      rsi:
        50,

      ema20:
        null,

      ema50:
        null,

      ema200:
        null

    };

  }


  const closes =
    candles.map(
      candle =>
        candle.close
    );


  const e20 =
    emaSeries(
      closes,
      SETTINGS.EMA_FAST
    );


  const e50 =
    emaSeries(
      closes,
      SETTINGS.EMA_MID
    );


  const e200 =
    emaSeries(
      closes,
      SETTINGS.EMA_SLOW
    );


  const price =
    closes.at(-1);


  const ema20 =
    e20.at(-1);


  const ema50 =
    e50.at(-1);


  const ema200 =
    e200.at(-1);


  let bull =
    0;


  let bear =
    0;


  if (
    price >
    ema20
  ) {

    bull++;

  }

  else {

    bear++;

  }


  if (
    ema20 >
    ema50
  ) {

    bull++;

  }

  else {

    bear++;

  }


  if (
    ema50 >
    ema200
  ) {

    bull++;

  }

  else {

    bear++;

  }


  const recent =
    candles.slice(
      -10
    );


  if (
    recent.length >=
    10
  ) {

    const first =
      recent.slice(
        0,
        5
      );


    const second =
      recent.slice(
        5
      );


    const high1 =
      Math.max(
        ...first.map(
          c =>
            c.high
        )
      );


    const high2 =
      Math.max(
        ...second.map(
          c =>
            c.high
        )
      );


    const low1 =
      Math.min(
        ...first.map(
          c =>
            c.low
        )
      );


    const low2 =
      Math.min(
        ...second.map(
          c =>
            c.low
        )
      );


    if (
      high2 >
      high1 &&
      low2 >
      low1
    ) {

      bull +=
        2;

    }


    if (
      high2 <
      high1 &&
      low2 <
      low1
    ) {

      bear +=
        2;

    }

  }


  let bias =
    "NEUTRAL";


  if (
    bull >
    bear
  ) {

    bias =
      "BULLISH";

  }


  if (
    bear >
    bull
  ) {

    bias =
      "BEARISH";

  }


  return {

    bias,

    bull,

    bear,

    score:
      Math.abs(
        bull -
        bear
      ),

    price:
      round(
        price
      ),

    ema20:
      round(
        ema20
      ),

    ema50:
      round(
        ema50
      ),

    ema200:
      round(
        ema200
      ),

    rsi:
      round(
        calculateRSI(
          closes,
          SETTINGS.RSI_PERIOD
        ),
        1
      )

  };

}


/* ============================================================
   VWAP
============================================================ */

function calculateVWAP(
  candles
) {

  if (
    !candles.length
  ) {

    return null;

  }


  let priceVolume =
    0;


  let volume =
    0;


  for (
    const candle of
    candles
  ) {

    const typical =
      (
        candle.high +
        candle.low +
        candle.close
      ) /
      3;


    priceVolume +=
      typical *
      candle.volume;


    volume +=
      candle.volume;

  }


  if (
    volume <=
    0
  ) {

    return null;

  }


  return (
    priceVolume /
    volume
  );

}


/* ============================================================
   UTC DAY
============================================================ */

function dayKeyUTC(
  timestamp
) {

  const d =
    new Date(
      timestamp
    );


  return (
    `${d.getUTCFullYear()}-` +
    `${String(
      d.getUTCMonth() +
      1
    ).padStart(
      2,
      "0"
    )}-` +
    `${String(
      d.getUTCDate()
    ).padStart(
      2,
      "0"
    )}`
  );

}


/* ============================================================
   DAILY LEVELS
============================================================ */

function dailyLevels(
  dailyCandles
) {

  if (
    dailyCandles.length <
    2
  ) {

    return {

      previousDayHigh:
        null,

      previousDayLow:
        null,

      previousDayClose:
        null,

      dailyOpen:
        null

    };

  }


  const sorted =
    [...dailyCandles]
      .sort(
        (a, b) =>
          a.timestamp -
          b.timestamp
      );


  const current =
    sorted.at(-1);


  const previous =
    sorted.at(-2);


  return {

    previousDayHigh:
      previous.high,

    previousDayLow:
      previous.low,

    previousDayClose:
      previous.close,

    dailyOpen:
      current.open

  };

}


/* ============================================================
   WEEKLY LEVELS
============================================================ */

function utcWeekStart(
  timestamp
) {

  const date =
    new Date(
      timestamp
    );


  const day =
    date.getUTCDay();


  const mondayOffset =
    day === 0
      ? 6
      : day - 1;


  return Date.UTC(

    date.getUTCFullYear(),

    date.getUTCMonth(),

    date.getUTCDate() -
      mondayOffset

  );

}


function weeklyLevels(
  dailyCandles
) {

  const weeks =
    new Map();


  for (
    const candle of
    dailyCandles
  ) {

    const key =
      utcWeekStart(
        candle.timestamp
      );


    if (
      !weeks.has(key)
    ) {

      weeks.set(
        key,
        []
      );

    }


    weeks
      .get(key)
      .push(
        candle
      );

  }


  const keys =
    [...weeks.keys()]
      .sort(
        (a, b) =>
          a - b
      );


  if (
    keys.length <
    2
  ) {

    return {

      previousWeekHigh:
        null,

      previousWeekLow:
        null,

      weeklyOpen:
        null

    };

  }


  const currentWeek =
    weeks.get(
      keys.at(-1)
    );


  const previousWeek =
    weeks.get(
      keys.at(-2)
    );


  return {

    previousWeekHigh:
      Math.max(
        ...previousWeek.map(
          c =>
            c.high
        )
      ),

    previousWeekLow:
      Math.min(
        ...previousWeek.map(
          c =>
            c.low
        )
      ),

    weeklyOpen:
      currentWeek[0]
        ?.open ??
      null

  };

}


/* ============================================================
   TODAY M5
============================================================ */

function getTodayCandles(
  candles
) {

  const now =
    new Date();


  const start =
    Date.UTC(

      now.getUTCFullYear(),

      now.getUTCMonth(),

      now.getUTCDate()

    );


  return candles.filter(
    candle =>
      candle.timestamp >=
      start
  );

}


/* ============================================================
   SESSION LEVELS
============================================================ */

function sessionLevels(
  candles
) {

  const now =
    new Date();


  const midnight =
    Date.UTC(

      now.getUTCFullYear(),

      now.getUTCMonth(),

      now.getUTCDate()

    );


  function window(
    startHour,
    endHour
  ) {

    const start =
      midnight +
      startHour *
      3600000;


    const end =
      midnight +
      endHour *
      3600000;


    const bars =
      candles.filter(
        candle =>
          candle.timestamp >=
            start &&
          candle.timestamp <
            end
      );


    if (
      !bars.length
    ) {

      return null;

    }


    return {

      open:
        bars[0].open,

      high:
        Math.max(
          ...bars.map(
            b =>
              b.high
          )
        ),

      low:
        Math.min(
          ...bars.map(
            b =>
              b.low
          )
        ),

      close:
        bars.at(-1)
          .close

    };

  }


  return {

    asia:
      window(
        0,
        8
      ),

    london:
      window(
        7,
        16
      ),

    newYork:
      window(
        13,
        22
      )

  };

}


/* ============================================================
   CURRENT SESSION
============================================================ */

function currentSession() {

  const now =
    new Date();


  const hour =
    now.getUTCHours();


  const day =
    now.getUTCDay();


  const active =
    [];


  if (
    hour >= 0 &&
    hour < 8
  ) {

    active.push(
      "ASIA"
    );

  }


  if (
    hour >= 7 &&
    hour < 16
  ) {

    active.push(
      "LONDON"
    );

  }


  if (
    hour >= 13 &&
    hour < 22
  ) {

    active.push(
      "NEW YORK"
    );

  }


  if (
    !active.length
  ) {

    active.push(
      "CRYPTO 24/7"
    );

  }


  return {

    active,

    utcHour:
      hour,

    weekend:
      day === 0 ||
      day === 6,

    day:
      [

        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday"

      ][day]

  };

}


/* ============================================================
   SWINGS
============================================================ */

function findSwings(
  candles,
  strength =
    SETTINGS.SWING_STRENGTH
) {

  const highs =
    [];


  const lows =
    [];


  for (
    let i =
      strength;
    i <
      candles.length -
      strength;
    i++
  ) {

    let swingHigh =
      true;


    let swingLow =
      true;


    for (
      let j = 1;
      j <=
        strength;
      j++
    ) {

      if (
        candles[i].high <=
          candles[i - j].high ||
        candles[i].high <=
          candles[i + j].high
      ) {

        swingHigh =
          false;

      }


      if (
        candles[i].low >=
          candles[i - j].low ||
        candles[i].low >=
          candles[i + j].low
      ) {

        swingLow =
          false;

      }

    }


    if (
      swingHigh
    ) {

      highs.push({

        price:
          candles[i].high,

        timestamp:
          candles[i].timestamp

      });

    }


    if (
      swingLow
    ) {

      lows.push({

        price:
          candles[i].low,

        timestamp:
          candles[i].timestamp

      });

    }

  }


  return {

    highs,

    lows

  };

}


/* ============================================================
   EQUAL LIQUIDITY
============================================================ */

function findEqualLiquidity(
  swings,
  atr
) {

  const tolerance =
    atr *
    SETTINGS
      .EQUAL_LEVEL_ATR_TOLERANCE;


  const equalHighs =
    [];


  const equalLows =
    [];


  function compare(
    points,
    destination
  ) {

    const recent =
      points.slice(
        -25
      );


    for (
      let i = 0;
      i <
        recent.length;
      i++
    ) {

      for (
        let j =
          i + 1;
        j <
          recent.length;
        j++
      ) {

        const difference =
          Math.abs(
            recent[i].price -
            recent[j].price
          );


        if (
          difference <=
          tolerance
        ) {

          destination.push({

            price:
              (
                recent[i].price +
                recent[j].price
              ) /
              2

          });

        }

      }

    }

  }


  compare(
    swings.highs,
    equalHighs
  );


  compare(
    swings.lows,
    equalLows
  );


  return {

    equalHighs:
      equalHighs.slice(
        -5
      ),

    equalLows:
      equalLows.slice(
        -5
      )

  };

}


/* ============================================================
   ROUND NUMBERS
============================================================ */

function roundLevels(
  price
) {

  const small =
    SETTINGS
      .ROUND_NUMBER_STEP;


  const major =
    SETTINGS
      .MAJOR_ROUND_NUMBER_STEP;


  return {

    lower:
      Math.floor(
        price /
        small
      ) *
      small,

    upper:
      Math.ceil(
        price /
        small
      ) *
      small,

    majorLower:
      Math.floor(
        price /
        major
      ) *
      major,

    majorUpper:
      Math.ceil(
        price /
        major
      ) *
      major

  };

}


/* ============================================================
   VOLUME
============================================================ */

function volumeAnalysis(
  m5
) {

  const recent =
    m5.slice(
      -SETTINGS
        .VOLUME_LOOKBACK
    );


  const volumes =
    recent.map(
      c =>
        c.volume
    );


  const avg =
    average(
      volumes
    );


  const current =
    m5.at(-1)
      ?.volume ??
    0;


  const ratio =
    avg > 0
      ? current / avg
      : 1;


  let state =
    "NORMAL";


  if (
    ratio >=
    1.4
  ) {

    state =
      "HIGH";

  }


  if (
    ratio <=
    0.65
  ) {

    state =
      "LOW";

  }


  return {

    current:
      round(
        current,
        5
      ),

    average:
      round(
        avg,
        5
      ),

    ratio:
      round(
        ratio,
        2
      ),

    state

  };

}


/* ============================================================
   TRADE FLOW
============================================================ */

function analyzeTrades(
  trades
) {

  if (
    !Array.isArray(trades)
  ) {

    return {

      trades:
        0,

      aggressiveBuyBTC:
        0,

      aggressiveSellBTC:
        0,

      deltaBTC:
        0,

      deltaPercent:
        0,

      cvd:
        0,

      pressure:
        "UNKNOWN"

    };

  }


  const sorted =
    [...trades]
      .sort(
        (a, b) =>
          new Date(a.time) -
          new Date(b.time)
      );


  let aggressiveBuy =
    0;


  let aggressiveSell =
    0;


  let cvd =
    0;


  for (
    const trade of
    sorted
  ) {

    const size =
      num(
        trade.size
      );


    if (
      trade.side ===
      "sell"
    ) {

      aggressiveBuy +=
        size;


      cvd +=
        size;

    }


    if (
      trade.side ===
      "buy"
    ) {

      aggressiveSell +=
        size;


      cvd -=
        size;

    }

  }


  const total =
    aggressiveBuy +
    aggressiveSell;


  const delta =
    aggressiveBuy -
    aggressiveSell;


  const deltaPercent =
    total > 0
      ? delta /
        total *
        100
      : 0;


  let pressure =
    "BALANCED";


  if (
    deltaPercent >
    8
  ) {

    pressure =
      "AGGRESSIVE BUYING";

  }


  if (
    deltaPercent <
    -8
  ) {

    pressure =
      "AGGRESSIVE SELLING";

  }


  return {

    trades:
      sorted.length,

    aggressiveBuyBTC:
      round(
        aggressiveBuy,
        5
      ),

    aggressiveSellBTC:
      round(
        aggressiveSell,
        5
      ),

    deltaBTC:
      round(
        delta,
        5
      ),

    deltaPercent:
      round(
        deltaPercent,
        2
      ),

    cvd:
      round(
        cvd,
        5
      ),

    pressure

  };

}


/* ============================================================
   ORDER BOOK
============================================================ */

function analyzeOrderBook(
  book
) {

  const bids =
    Array.isArray(
      book?.bids
    )
      ? book.bids.slice(
        0,
        SETTINGS.ORDER_BOOK_LEVELS
      )
      : [];


  const asks =
    Array.isArray(
      book?.asks
    )
      ? book.asks.slice(
        0,
        SETTINGS.ORDER_BOOK_LEVELS
      )
      : [];


  let bidUSD =
    0;


  let askUSD =
    0;


  for (
    const bid of
    bids
  ) {

    bidUSD +=
      num(bid[0]) *
      num(bid[1]);

  }


  for (
    const ask of
    asks
  ) {

    askUSD +=
      num(ask[0]) *
      num(ask[1]);

  }


  const total =
    bidUSD +
    askUSD;


  const imbalance =
    total > 0
      ? (
        (
          bidUSD -
          askUSD
        ) /
        total
      ) *
        100
      : 0;


  let pressure =
    "BALANCED";


  if (
    imbalance >
    7
  ) {

    pressure =
      "BID HEAVY";

  }


  if (
    imbalance <
    -7
  ) {

    pressure =
      "ASK HEAVY";

  }


  return {

    bestBid:
      bids.length
        ? num(
          bids[0][0]
        )
        : null,

    bestAsk:
      asks.length
        ? num(
          asks[0][0]
        )
        : null,

    bidUSD:
      round(
        bidUSD
      ),

    askUSD:
      round(
        askUSD
      ),

    imbalancePercent:
      round(
        imbalance,
        2
      ),

    pressure

  };

}


/* ============================================================
   LIQUIDITY
============================================================ */

function buildLiquidityPools({

  price,
  atr,
  daily,
  weekly,
  sessions,
  equalLiquidity,
  swings,
  roundNumbers

}) {

  const pools =
    [];


  function add(
    name,
    level,
    side,
    weight,
    type
  ) {

    if (
      level === null ||
      level === undefined ||
      !Number.isFinite(
        Number(level)
      )
    ) {

      return;

    }


    const numericLevel =
      Number(level);


    const distance =
      Math.abs(
        price -
        numericLevel
      );


    const distanceATR =
      atr > 0
        ? distance /
          atr
        : 999;


    if (
      distanceATR >
      12
    ) {

      return;

    }


    let proximity =
      0;


    if (
      distanceATR <=
      0.25
    ) {

      proximity =
        30;

    }

    else if (
      distanceATR <=
      0.50
    ) {

      proximity =
        25;

    }

    else if (
      distanceATR <=
      1.00
    ) {

      proximity =
        18;

    }

    else if (
      distanceATR <=
      1.50
    ) {

      proximity =
        10;

    }

    else if (
      distanceATR <=
      3
    ) {

      proximity =
        5;

    }


    pools.push({

      name,

      level:
        numericLevel,

      side,

      type,

      distance,

      distanceATR,

      baseWeight:
        weight,

      score:
        clamp(
          weight +
          proximity,
          0,
          65
        )

    });

  }


  add(
    "Previous Day High",
    daily.previousDayHigh,
    "BUY_SIDE",
    24,
    "PDH"
  );


  add(
    "Previous Day Low",
    daily.previousDayLow,
    "SELL_SIDE",
    24,
    "PDL"
  );


  add(
    "Previous Week High",
    weekly.previousWeekHigh,
    "BUY_SIDE",
    27,
    "PWH"
  );


  add(
    "Previous Week Low",
    weekly.previousWeekLow,
    "SELL_SIDE",
    27,
    "PWL"
  );


  if (
    sessions.asia
  ) {

    add(
      "Asia High",
      sessions.asia.high,
      "BUY_SIDE",
      14,
      "ASIA"
    );


    add(
      "Asia Low",
      sessions.asia.low,
      "SELL_SIDE",
      14,
      "ASIA"
    );

  }


  if (
    sessions.london
  ) {

    add(
      "London High",
      sessions.london.high,
      "BUY_SIDE",
      15,
      "LONDON"
    );


    add(
      "London Low",
      sessions.london.low,
      "SELL_SIDE",
      15,
      "LONDON"
    );

  }


  if (
    sessions.newYork
  ) {

    add(
      "New York High",
      sessions.newYork.high,
      "BUY_SIDE",
      15,
      "NEW_YORK"
    );


    add(
      "New York Low",
      sessions.newYork.low,
      "SELL_SIDE",
      15,
      "NEW_YORK"
    );

  }


  for (
    const item of
    equalLiquidity.equalHighs
  ) {

    add(
      "Equal Highs",
      item.price,
      "BUY_SIDE",
      20,
      "EQH"
    );

  }


  for (
    const item of
    equalLiquidity.equalLows
  ) {

    add(
      "Equal Lows",
      item.price,
      "SELL_SIDE",
      20,
      "EQL"
    );

  }


  for (
    const swing of
    swings.highs.slice(
      -4
    )
  ) {

    add(
      "M15 Swing High",
      swing.price,
      "BUY_SIDE",
      15,
      "SWING_HIGH"
    );

  }


  for (
    const swing of
    swings.lows.slice(
      -4
    )
  ) {

    add(
      "M15 Swing Low",
      swing.price,
      "SELL_SIDE",
      15,
      "SWING_LOW"
    );

  }


  add(
    "Round Number Above",
    roundNumbers.upper,
    "BUY_SIDE",
    10,
    "ROUND"
  );


  add(
    "Round Number Below",
    roundNumbers.lower,
    "SELL_SIDE",
    10,
    "ROUND"
  );


  if (
    roundNumbers.majorUpper !==
    roundNumbers.upper
  ) {

    add(
      "Major Round Number Above",
      roundNumbers.majorUpper,
      "BUY_SIDE",
      17,
      "MAJOR_ROUND"
    );

  }


  if (
    roundNumbers.majorLower !==
    roundNumbers.lower
  ) {

    add(
      "Major Round Number Below",
      roundNumbers.majorLower,
      "SELL_SIDE",
      17,
      "MAJOR_ROUND"
    );

  }


  return pools.sort(
    (a, b) => {

      if (
        b.score !==
        a.score
      ) {

        return (
          b.score -
          a.score
        );

      }


      return (
        a.distance -
        b.distance
      );

    }
  );

}


function choosePrimaryLiquidity(
  pools
) {

  if (
    !pools.length
  ) {

    return null;

  }


  return [
    ...pools
  ].sort(
    (a, b) => {

      const scoreA =
        a.score -
        Math.min(
          a.distanceATR *
          4,
          25
        );


      const scoreB =
        b.score -
        Math.min(
          b.distanceATR *
          4,
          25
        );


      return (
        scoreB -
        scoreA
      );

    }
  )[0];

}


/* ============================================================
   REJECTION
============================================================ */

function candleRejection(
  candle
) {

  const range =
    candle.high -
    candle.low;


  if (
    range <=
    0
  ) {

    return {

      bullish:
        false,

      bearish:
        false,

      upperWickPercent:
        0,

      lowerWickPercent:
        0

    };

  }


  const bodyHigh =
    Math.max(
      candle.open,
      candle.close
    );


  const bodyLow =
    Math.min(
      candle.open,
      candle.close
    );


  const upper =
    candle.high -
    bodyHigh;


  const lower =
    bodyLow -
    candle.low;


  const upperPct =
    upper /
    range *
    100;


  const lowerPct =
    lower /
    range *
    100;


  return {

    bullish:
      lowerPct >=
        38 &&
      candle.close >
        candle.open,

    bearish:
      upperPct >=
        38 &&
      candle.close <
        candle.open,

    upperWickPercent:
      round(
        upperPct,
        1
      ),

    lowerWickPercent:
      round(
        lowerPct,
        1
      )

  };

}


/* ============================================================
   STRUCTURE TRIGGER
============================================================ */

function structureTrigger(
  candles
) {

  if (
    candles.length <
    10
  ) {

    return {

      bullish:
        false,

      bearish:
        false,

      previousHigh:
        null,

      previousLow:
        null

    };

  }


  const previous =
    candles.slice(
      -8,
      -1
    );


  const current =
    candles.at(-1);


  const previousHigh =
    Math.max(
      ...previous.map(
        c =>
          c.high
      )
    );


  const previousLow =
    Math.min(
      ...previous.map(
        c =>
          c.low
      )
    );


  return {

    bullish:
      current.close >
      previousHigh,

    bearish:
      current.close <
      previousLow,

    previousHigh:
      round(
        previousHigh
      ),

    previousLow:
      round(
        previousLow
      )

  };

}


/* ============================================================
   RAID
============================================================ */

function analyzeRaid({

  pool,
  price,
  atr,
  lastM5,
  m15Structure,
  h1Structure,
  h4Structure,
  flow,
  book,
  volume

}) {

  if (
    !pool
  ) {

    return null;

  }


  const level =
    pool.level;


  const distance =
    Math.abs(
      price -
      level
    );


  const distanceATR =
    atr > 0
      ? distance /
        atr
      : 999;


  let score =
    pool.baseWeight;


  const reasons =
    [];


  if (
    distanceATR <=
    1.5
  ) {

    score +=
      10;


    reasons.push(
      "Price is approaching the liquidity target"
    );

  }


  if (
    distanceATR <=
    0.75
  ) {

    score +=
      8;


    reasons.push(
      "Liquidity is within 0.75 ATR"
    );

  }


  if (
    distanceATR <=
    0.30
  ) {

    score +=
      8;


    reasons.push(
      "Price is extremely close to the target"
    );

  }


  let swept =
    false;


  let rejected =
    false;


  if (
    pool.side ===
    "BUY_SIDE"
  ) {

    if (
      lastM5.high >
      level
    ) {

      swept =
        true;


      score +=
        12;


      reasons.push(
        "Buy-side liquidity was swept"
      );

    }


    if (
      swept &&
      lastM5.close <
      level
    ) {

      rejected =
        true;


      score +=
        14;


      reasons.push(
        "Price closed back below the swept liquidity"
      );

    }


    if (
      flow.deltaPercent <
      -5
    ) {

      score +=
        7;


      reasons.push(
        "Aggressive flow is bearish"
      );

    }


    if (
      book.imbalancePercent <
      -5
    ) {

      score +=
        5;


      reasons.push(
        "Order book is ask-heavy"
      );

    }


    if (
      m15Structure.bias ===
      "BEARISH"
    ) {

      score +=
        7;


      reasons.push(
        "M15 supports bearish reversal"
      );

    }


    if (
      h1Structure.bias ===
      "BEARISH"
    ) {

      score +=
        5;


      reasons.push(
        "H1 supports downside"
      );

    }

  }


  if (
    pool.side ===
    "SELL_SIDE"
  ) {

    if (
      lastM5.low <
      level
    ) {

      swept =
        true;


      score +=
        12;


      reasons.push(
        "Sell-side liquidity was swept"
      );

    }


    if (
      swept &&
      lastM5.close >
      level
    ) {

      rejected =
        true;


      score +=
        14;


      reasons.push(
        "Price closed back above the swept liquidity"
      );

    }


    if (
      flow.deltaPercent >
      5
    ) {

      score +=
        7;


      reasons.push(
        "Aggressive flow is bullish"
      );

    }


    if (
      book.imbalancePercent >
      5
    ) {

      score +=
        5;


      reasons.push(
        "Order book is bid-heavy"
      );

    }


    if (
      m15Structure.bias ===
      "BULLISH"
    ) {

      score +=
        7;


      reasons.push(
        "M15 supports bullish reversal"
      );

    }


    if (
      h1Structure.bias ===
      "BULLISH"
    ) {

      score +=
        5;


      reasons.push(
        "H1 supports upside"
      );

    }

  }


  if (
    volume.state ===
    "HIGH"
  ) {

    score +=
      5;


    reasons.push(
      "M5 volume is elevated"
    );

  }


  if (
    pool.side ===
      "BUY_SIDE" &&
    h4Structure.bias ===
      "BULLISH"
  ) {

    score -=
      5;

  }


  if (
    pool.side ===
      "SELL_SIDE" &&
    h4Structure.bias ===
      "BEARISH"
  ) {

    score -=
      5;

  }


  score =
    clamp(
      score,
      0,
      95
    );


  let stage =
    "MONITORING";


  if (
    score >=
    SETTINGS.TRACKING_SCORE
  ) {

    stage =
      "TRACKING";

  }


  if (
    score >=
    SETTINGS.ARMED_SCORE
  ) {

    stage =
      "ARMED";

  }


  if (
    swept
  ) {

    stage =
      "SWEPT";

  }


  if (
    swept &&
    rejected
  ) {

    stage =
      "REVERSAL WATCH";

  }


  const minOvershoot =
    atr *
    SETTINGS.SWEEP_MIN_ATR;


  let maxOvershoot =
    atr *
    SETTINGS.SWEEP_MAX_ATR;


  if (
    volume.state ===
    "HIGH"
  ) {

    maxOvershoot *=
      1.20;

  }


  if (
    Math.abs(
      flow.deltaPercent
    ) >
    20
  ) {

    maxOvershoot *=
      1.15;

  }


  const zone =
    pool.side ===
    "BUY_SIDE"

      ? {

        low:
          level +
          minOvershoot,

        high:
          level +
          maxOvershoot

      }

      : {

        low:
          level -
          maxOvershoot,

        high:
          level -
          minOvershoot

      };


  return {

    target:
      pool.name,

    type:
      pool.type,

    side:
      pool.side,

    level:
      round(
        level
      ),

    livePrice:
      round(
        price
      ),

    distance:
      round(
        distance
      ),

    distanceATR:
      round(
        distanceATR,
        2
      ),

    score:
      round(
        score
      ),

    maxScore:
      95,

    stage,

    swept,

    rejected,

    projectedSweepZone: {

      low:
        round(
          zone.low
        ),

      high:
        round(
          zone.high
        )

    },

    reasons

  };

}


/* ============================================================
   SIGNAL
============================================================ */

function generateSignal({

  price,
  atr,
  vwap,
  raid,
  m5Structure,
  m15Structure,
  h1Structure,
  h4Structure,
  flow,
  book,
  rejection,
  trigger

}) {

  let buyScore =
    0;


  let sellScore =
    0;


  const buyReasons =
    [];


  const sellReasons =
    [];


  if (
    m5Structure.bias ===
    "BULLISH"
  ) {

    buyScore +=
      7;


    buyReasons.push(
      "M5 bullish"
    );

  }


  if (
    m5Structure.bias ===
    "BEARISH"
  ) {

    sellScore +=
      7;


    sellReasons.push(
      "M5 bearish"
    );

  }


  if (
    m15Structure.bias ===
    "BULLISH"
  ) {

    buyScore +=
      13;


    buyReasons.push(
      "M15 bullish"
    );

  }


  if (
    m15Structure.bias ===
    "BEARISH"
  ) {

    sellScore +=
      13;


    sellReasons.push(
      "M15 bearish"
    );

  }


  if (
    h1Structure.bias ===
    "BULLISH"
  ) {

    buyScore +=
      12;


    buyReasons.push(
      "H1 bullish"
    );

  }


  if (
    h1Structure.bias ===
    "BEARISH"
  ) {

    sellScore +=
      12;


    sellReasons.push(
      "H1 bearish"
    );

  }


  if (
    h4Structure.bias ===
    "BULLISH"
  ) {

    buyScore +=
      8;


    buyReasons.push(
      "H4 bullish"
    );

  }


  if (
    h4Structure.bias ===
    "BEARISH"
  ) {

    sellScore +=
      8;


    sellReasons.push(
      "H4 bearish"
    );

  }


  if (
    Number.isFinite(
      vwap
    )
  ) {

    if (
      price >
      vwap
    ) {

      buyScore +=
        5;


      buyReasons.push(
        "Price above VWAP"
      );

    }


    if (
      price <
      vwap
    ) {

      sellScore +=
        5;


      sellReasons.push(
        "Price below VWAP"
      );

    }

  }


  if (
    flow.deltaPercent >
    5
  ) {

    buyScore +=
      9;


    buyReasons.push(
      "Positive delta"
    );

  }


  if (
    flow.deltaPercent <
    -5
  ) {

    sellScore +=
      9;


    sellReasons.push(
      "Negative delta"
    );

  }


  if (
    book.imbalancePercent >
    5
  ) {

    buyScore +=
      6;


    buyReasons.push(
      "Bid-heavy order book"
    );

  }


  if (
    book.imbalancePercent <
    -5
  ) {

    sellScore +=
      6;


    sellReasons.push(
      "Ask-heavy order book"
    );

  }


  if (
    rejection.bullish
  ) {

    buyScore +=
      7;


    buyReasons.push(
      "Bullish rejection candle"
    );

  }


  if (
    rejection.bearish
  ) {

    sellScore +=
      7;


    sellReasons.push(
      "Bearish rejection candle"
    );

  }


  if (
    trigger.bullish
  ) {

    buyScore +=
      10;


    buyReasons.push(
      "Bullish M5 structure break"
    );

  }


  if (
    trigger.bearish
  ) {

    sellScore +=
      10;


    sellReasons.push(
      "Bearish M5 structure break"
    );

  }


  if (
    raid?.swept &&
    raid?.rejected
  ) {

    if (
      raid.side ===
      "SELL_SIDE"
    ) {

      buyScore +=
        23;


      buyReasons.push(
        "Sell-side sweep rejected"
      );

    }


    if (
      raid.side ===
      "BUY_SIDE"
    ) {

      sellScore +=
        23;


      sellReasons.push(
        "Buy-side sweep rejected"
      );

    }

  }


  buyScore =
    clamp(
      buyScore,
      0,
      100
    );


  sellScore =
    clamp(
      sellScore,
      0,
      100
    );


  const gap =
    Math.abs(
      buyScore -
      sellScore
    );


  let signal =
    "WAIT";


  if (
    buyScore >=
      SETTINGS.SIGNAL_SCORE &&
    buyScore >
      sellScore &&
    gap >=
      SETTINGS.SIGNAL_GAP
  ) {

    signal =
      "BUY";

  }


  if (
    sellScore >=
      SETTINGS.SIGNAL_SCORE &&
    sellScore >
      buyScore &&
    gap >=
      SETTINGS.SIGNAL_GAP
  ) {

    signal =
      "SELL";

  }


  let entry =
    null;


  let stopLoss =
    null;


  let takeProfit1 =
    null;


  let takeProfit2 =
    null;


  if (
    signal ===
    "BUY"
  ) {

    entry =
      price;


    stopLoss =
      price -
      atr *
      SETTINGS.STOP_ATR;


    if (
      raid?.side ===
      "SELL_SIDE"
    ) {

      stopLoss =
        Math.min(

          stopLoss,

          raid
            .projectedSweepZone
            .low -
          atr *
          0.10

        );

    }


    const risk =
      entry -
      stopLoss;


    takeProfit1 =
      entry +
      risk *
      SETTINGS.TP1_R;


    takeProfit2 =
      entry +
      risk *
      SETTINGS.TP2_R;

  }


  if (
    signal ===
    "SELL"
  ) {

    entry =
      price;


    stopLoss =
      price +
      atr *
      SETTINGS.STOP_ATR;


    if (
      raid?.side ===
      "BUY_SIDE"
    ) {

      stopLoss =
        Math.max(

          stopLoss,

          raid
            .projectedSweepZone
            .high +
          atr *
          0.10

        );

    }


    const risk =
      stopLoss -
      entry;


    takeProfit1 =
      entry -
      risk *
      SETTINGS.TP1_R;


    takeProfit2 =
      entry -
      risk *
      SETTINGS.TP2_R;

  }


  return {

    signal,

    buyScore:
      round(
        buyScore,
        1
      ),

    sellScore:
      round(
        sellScore,
        1
      ),

    confidence:
      round(
        Math.max(
          buyScore,
          sellScore
        ),
        1
      ),

    scoreGap:
      round(
        gap,
        1
      ),

    entry:
      round(
        entry
      ),

    stopLoss:
      round(
        stopLoss
      ),

    takeProfit1:
      round(
        takeProfit1
      ),

    takeProfit2:
      round(
        takeProfit2
      ),

    buyReasons,

    sellReasons

  };

}


/* ============================================================
   MAIN
============================================================ */

module.exports =
async function handler(
  req,
  res
) {

  const started =
    Date.now();


  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate"
  );


  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );


  try {

    const [

      ticker,

      trades,

      bookRaw,

      m5,

      h1,

      d1

    ] =
      await Promise.all([

        fetchTicker(),

        fetchTrades(),

        fetchOrderBook(),

        fetchCandles({

          granularity:
            SETTINGS.M5_GRANULARITY,

          count:
            SETTINGS.M5_CANDLES

        }),

        fetchCandles({

          granularity:
            SETTINGS.H1_GRANULARITY,

          count:
            SETTINGS.H1_CANDLES

        }),

        fetchCandles({

          granularity:
            SETTINGS.D1_GRANULARITY,

          count:
            SETTINGS.D1_CANDLES

        })

      ]);


    if (
      m5.length <
      40
    ) {

      throw new Error(
        `Only ${m5.length} M5 candles were returned`
      );

    }


    if (
      h1.length <
      40
    ) {

      throw new Error(
        `Only ${h1.length} H1 candles were returned`
      );

    }


    if (
      d1.length <
      8
    ) {

      throw new Error(
        `Only ${d1.length} daily candles were returned`
      );

    }


    const price =
      num(
        ticker?.price,
        m5.at(-1)?.close
      );


    const m15 =
      resample(
        m5,
        15
      );


    const h4 =
      resample(
        h1,
        240
      );


    const atr =
      calculateATR(
        m5,
        SETTINGS.ATR_PERIOD
      );


    const m5Structure =
      detectStructure(
        m5
      );


    const m15Structure =
      detectStructure(
        m15
      );


    const h1Structure =
      detectStructure(
        h1
      );


    const h4Structure =
      detectStructure(
        h4
      );


    const daily =
      dailyLevels(
        d1
      );


    const weekly =
      weeklyLevels(
        d1
      );


    const sessions =
      sessionLevels(
        m5
      );


    const session =
      currentSession();


    const todayM5 =
      getTodayCandles(
        m5
      );


    const vwap =
      calculateVWAP(
        todayM5
      );


    const swings =
      findSwings(
        m15,
        SETTINGS.SWING_STRENGTH
      );


    const equalLiquidity =
      findEqualLiquidity(
        swings,
        atr
      );


    const roundNumbers =
      roundLevels(
        price
      );


    const flow =
      analyzeTrades(
        trades
      );


    const book =
      analyzeOrderBook(
        bookRaw
      );


    const volume =
      volumeAnalysis(
        m5
      );


    const pools =
      buildLiquidityPools({

        price,

        atr,

        daily,

        weekly,

        sessions,

        equalLiquidity,

        swings,

        roundNumbers

      });


    const primary =
      choosePrimaryLiquidity(
        pools
      );


    const raid =
      analyzeRaid({

        pool:
          primary,

        price,

        atr,

        lastM5:
          m5.at(-1),

        m15Structure,

        h1Structure,

        h4Structure,

        flow,

        book,

        volume

      });


    const rejection =
      candleRejection(
        m5.at(-1)
      );


    const trigger =
      structureTrigger(
        m5
      );


    const signal =
      generateSignal({

        price,

        atr,

        vwap,

        raid,

        m5Structure,

        m15Structure,

        h1Structure,

        h4Structure,

        flow,

        book,

        rejection,

        trigger

      });


    const bullish =
      [

        m15Structure,

        h1Structure,

        h4Structure

      ].filter(
        item =>
          item.bias ===
          "BULLISH"
      ).length;


    const bearish =
      [

        m15Structure,

        h1Structure,

        h4Structure

      ].filter(
        item =>
          item.bias ===
          "BEARISH"
      ).length;


    let macroBias =
      "MIXED";


    if (
      bullish >=
      2
    ) {

      macroBias =
        "BULLISH";

    }


    if (
      bearish >=
      2
    ) {

      macroBias =
        "BEARISH";

    }


    const atrPercent =
      price > 0
        ? atr /
          price *
          100
        : 0;


    let regime =
      "NORMAL";


    if (
      atrPercent <
      0.08
    ) {

      regime =
        "LOW";

    }


    if (
      atrPercent >=
      0.25
    ) {

      regime =
        "HIGH";

    }


    if (
      atrPercent >=
      0.50
    ) {

      regime =
        "EXTREME";

    }


    return res
      .status(200)
      .json({

        ok:
          true,

        engine:
          "MKAYFX BTC LIQUIDITY INTELLIGENCE V2.1",

        source:
          "Coinbase Exchange",

        product:
          PRODUCT,

        timestamp:
          new Date()
            .toISOString(),

        latencyMs:
          Date.now() -
          started,


        market: {

          price:
            round(
              price
            ),

          bid:
            round(
              book.bestBid
            ),

          ask:
            round(
              book.bestAsk
            ),

          spread:
            book.bestBid &&
            book.bestAsk

              ? round(
                book.bestAsk -
                book.bestBid,
                2
              )

              : null

        },


        session,


        sessionLevels: {

          asia:
            sessions.asia
              ? {

                high:
                  round(
                    sessions.asia.high
                  ),

                low:
                  round(
                    sessions.asia.low
                  )

              }
              : null,

          london:
            sessions.london
              ? {

                high:
                  round(
                    sessions.london.high
                  ),

                low:
                  round(
                    sessions.london.low
                  )

              }
              : null,

          newYork:
            sessions.newYork
              ? {

                high:
                  round(
                    sessions.newYork.high
                  ),

                low:
                  round(
                    sessions.newYork.low
                  )

              }
              : null

        },


        macroBias,


        timeframes: {

          M5:
            m5Structure,

          M15:
            m15Structure,

          H1:
            h1Structure,

          H4:
            h4Structure

        },


        volatility: {

          atr5m:
            round(
              atr
            ),

          atrPercent:
            round(
              atrPercent,
              4
            ),

          regime

        },


        vwap: {

          daily:
            round(
              vwap
            ),

          position:
            vwap === null

              ? "UNKNOWN"

              : price >
                vwap

                ? "ABOVE"

                : "BELOW"

        },


        levels: {

          previousDayHigh:
            round(
              daily.previousDayHigh
            ),

          previousDayLow:
            round(
              daily.previousDayLow
            ),

          dailyOpen:
            round(
              daily.dailyOpen
            ),

          previousWeekHigh:
            round(
              weekly.previousWeekHigh
            ),

          previousWeekLow:
            round(
              weekly.previousWeekLow
            ),

          weeklyOpen:
            round(
              weekly.weeklyOpen
            ),

          roundNumberAbove:
            roundNumbers.upper,

          roundNumberBelow:
            roundNumbers.lower,

          majorRoundAbove:
            roundNumbers.majorUpper,

          majorRoundBelow:
            roundNumbers.majorLower

        },


        flow,


        orderBook:
          book,


        volume,


        raid,


        signal,


        confirmation: {

          rejection,

          structureTrigger:
            trigger

        },


        liquidityPools:
          pools
            .slice(
              0,
              15
            )
            .map(
              pool => ({

                name:
                  pool.name,

                level:
                  round(
                    pool.level
                  ),

                side:
                  pool.side,

                type:
                  pool.type,

                distance:
                  round(
                    pool.distance
                  ),

                distanceATR:
                  round(
                    pool.distanceATR,
                    2
                  ),

                score:
                  round(
                    pool.score
                  )

              })
            ),


        candles: {

          M5:
            m5.length,

          M15:
            m15.length,

          H1:
            h1.length,

          H4:
            h4.length,

          D1:
            d1.length

        }

      });

  }

  catch (
    error
  ) {

    const message =
      errorText(
        error
      );


    console.error(
      "BTC ENGINE ERROR:",
      message
    );


    return res
      .status(500)
      .json({

        ok:
          false,

        engine:
          "MKAYFX BTC LIQUIDITY INTELLIGENCE V2.1",

        source:
          "Coinbase Exchange",

        error:
          message,

        timestamp:
          new Date()
            .toISOString(),

        latencyMs:
          Date.now() -
          started

      });

  }

};