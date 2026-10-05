/* ============================================================
   MKAYFX BTC LIQUIDITY INTELLIGENCE ENGINE V2
   ------------------------------------------------------------
   FILE:
   /api/btc.js

   MARKET:
   BTC-USD

   SOURCE:
   Coinbase Exchange public REST API

   NO TWELVE DATA
   NO API KEY REQUIRED

   ARCHITECTURE
   ------------------------------------------------------------
   M5  = Coinbase 5-minute candles
   M15 = Resampled from M5
   H1  = Coinbase 1-hour candles
   H4  = Resampled from H1
   D1  = Coinbase daily candles

   FEATURES
   ------------------------------------------------------------
   - Live BTC/USD price
   - Bid / ask / spread
   - M5 / M15 / H1 / H4 structure
   - EMA 20 / 50 / 200
   - RSI
   - ATR
   - Daily VWAP
   - Previous Day High / Low
   - Previous Week High / Low
   - Daily Open
   - Weekly Open
   - Asia High / Low
   - London High / Low
   - New York High / Low
   - Equal highs / equal lows
   - Swing liquidity
   - Round-number liquidity
   - Fair Value Gaps
   - Coinbase trade delta
   - CVD proxy
   - Order-book imbalance
   - Relative volume
   - Liquidity ranking
   - Raid scoring
   - Projected sweep zones
   - Rejection confirmation
   - Structure confirmation
   - BUY / SELL / WAIT intelligence

   IMPORTANT
   ------------------------------------------------------------
   Coinbase recent trade "side" is the MAKER side.

   side = sell
   resting seller was hit
   aggressive BUY

   side = buy
   resting buyer was hit
   aggressive SELL

============================================================ */


/* ============================================================
   CONFIG
============================================================ */

const PRODUCT =
  "BTC-USD";


const COINBASE =
  "https://api.exchange.coinbase.com";


const SETTINGS = {

  /* ========================================================
     TIMEFRAMES
  ======================================================== */

  M5_GRANULARITY:
    300,

  H1_GRANULARITY:
    3600,

  D1_GRANULARITY:
    86400,


  /* ========================================================
     DATA
  ======================================================== */

  M5_CANDLES:
    300,

  H1_CANDLES:
    300,

  D1_CANDLES:
    40,


  /* ========================================================
     INDICATORS
  ======================================================== */

  ATR_PERIOD:
    14,

  RSI_PERIOD:
    14,

  EMA_FAST:
    20,

  EMA_MID:
    50,

  EMA_SLOW:
    200,


  /* ========================================================
     LIQUIDITY
  ======================================================== */

  SWING_STRENGTH:
    2,

  EQUAL_LEVEL_ATR_TOLERANCE:
    0.12,

  ROUND_NUMBER_STEP:
    1000,

  MAJOR_ROUND_NUMBER_STEP:
    5000,


  /* ========================================================
     RAID MODEL
  ======================================================== */

  TRACKING_SCORE:
    35,

  ARMED_SCORE:
    55,

  APPROACH_ATR:
    1.5,

  SWEEP_MIN_ATR:
    0.04,

  SWEEP_MAX_ATR:
    0.45,


  /* ========================================================
     SIGNAL
  ======================================================== */

  SIGNAL_SCORE:
    70,

  SIGNAL_GAP:
    7,

  TP1_R:
    1.5,

  TP2_R:
    2.5,

  STOP_ATR:
    0.55,


  /* ========================================================
     FLOW
  ======================================================== */

  ORDER_BOOK_LEVELS:
    30,

  VOLUME_LOOKBACK:
    20

};


/* ============================================================
   BASIC HELPERS
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
    !Number.isFinite(
      Number(value)
    )
  ) {

    return null;

  }


  const p =
    10 ** digits;


  return (
    Math.round(
      Number(value) *
      p
    ) /
    p
  );

}


function clamp(
  value,
  minimum,
  maximum
) {

  return Math.max(
    minimum,
    Math.min(
      maximum,
      value
    )
  );

}


function average(
  values
) {

  if (
    !values.length
  ) {

    return 0;

  }


  return (
    values.reduce(
      (
        total,
        value
      ) =>
        total +
        value,
      0
    ) /
    values.length
  );

}


function sleep(
  ms
) {

  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
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
              "MKAYFX-BTC-V2"

          },

          cache:
            "no-store",

          signal:
            controller.signal

        }
      );


    const rawText =
      await response.text();


    let data;


    try {

      data =
        JSON.parse(
          rawText
        );

    }

    catch {

      throw new Error(
        `Coinbase returned invalid JSON: ${rawText.slice(0, 160)}`
      );

    }


    if (
      !response.ok
    ) {

      throw new Error(
        data?.message ||
        `Coinbase HTTP ${response.status}`
      );

    }


    return data;

  }

  catch (
    error
  ) {

    if (
      error.name ===
      "AbortError"
    ) {

      throw new Error(
        "Coinbase request timed out"
      );

    }


    throw error;

  }

  finally {

    clearTimeout(
      timer
    );

  }

}


/* ============================================================
   COINBASE LIVE DATA
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

  /*
     level=2 gives aggregated order book.

     We only USE the nearest levels even though
     Coinbase can return more.
  */

  return getJSON(
    `${COINBASE}/products/${PRODUCT}/book?level=2`
  );

}


/* ============================================================
   COINBASE CANDLES

   Coinbase candle format:

   [
     time,
     low,
     high,
     open,
     close,
     volume
   ]
============================================================ */

async function fetchCandles({
  granularity,
  count
}) {

  const nowSeconds =
    Math.floor(
      Date.now() /
      1000
    );


  /*
     Coinbase normally supports up to ~300 candles
     per request.

     Leave a small safety margin.
  */

  const safeCount =
    Math.min(
      Math.max(
        10,
        count
      ),
      300
    );


  const end =
    nowSeconds;


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
    !Array.isArray(
      raw
    )
  ) {

    throw new Error(
      "Coinbase candle response was not an array"
    );

  }


  const candles =
    raw
      .map(
        row => ({

          timestamp:
            num(
              row[0]
            ) *
            1000,

          time:
            new Date(
              num(
                row[0]
              ) *
              1000
            ),

          low:
            num(
              row[1]
            ),

          high:
            num(
              row[2]
            ),

          open:
            num(
              row[3]
            ),

          close:
            num(
              row[4]
            ),

          volume:
            num(
              row[5]
            )

        })
      )
      .filter(
        candle =>
          candle.timestamp > 0 &&
          candle.high > 0 &&
          candle.low > 0
      )
      .sort(
        (
          a,
          b
        ) =>
          a.timestamp -
          b.timestamp
      );


  /*
     Remove duplicate timestamps.
  */

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


  const groups =
    new Map();


  for (
    const candle of
    candles
  ) {

    const timestamp =
      Math.floor(
        candle.timestamp /
        interval
      ) *
      interval;


    if (
      !groups.has(
        timestamp
      )
    ) {

      groups.set(
        timestamp,
        {

          timestamp,

          time:
            new Date(
              timestamp
            ),

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

      const group =
        groups.get(
          timestamp
        );


      group.high =
        Math.max(
          group.high,
          candle.high
        );


      group.low =
        Math.min(
          group.low,
          candle.low
        );


      group.close =
        candle.close;


      group.volume +=
        candle.volume;

    }

  }


  return [
    ...groups.values()
  ].sort(
    (
      a,
      b
    ) =>
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

  if (
    !values.length
  ) {

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


  const start =
    closes.length -
    period;


  let gains =
    0;


  let losses =
    0;


  for (
    let i =
      start;
    i <
      closes.length;
    i++
  ) {

    const change =
      closes[i] -
      closes[i - 1];


    if (
      change >
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


  const trueRanges =
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


    trueRanges.push(

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
    trueRanges.slice(
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

    bull +=
      1;

  }

  else {

    bear +=
      1;

  }


  if (
    ema20 >
    ema50
  ) {

    bull +=
      1;

  }

  else {

    bear +=
      1;

  }


  if (
    ema50 >
    ema200
  ) {

    bull +=
      1;

  }

  else {

    bear +=
      1;

  }


  /*
     Recent market structure
  */

  if (
    candles.length >=
    10
  ) {

    const recent =
      candles.slice(
        -10
      );


    const first =
      recent.slice(
        0,
        5
      );


    const second =
      recent.slice(
        5
      );


    const firstHigh =
      Math.max(
        ...first.map(
          c =>
            c.high
        )
      );


    const secondHigh =
      Math.max(
        ...second.map(
          c =>
            c.high
        )
      );


    const firstLow =
      Math.min(
        ...first.map(
          c =>
            c.low
        )
      );


    const secondLow =
      Math.min(
        ...second.map(
          c =>
            c.low
        )
      );


    if (
      secondHigh >
      firstHigh &&
      secondLow >
      firstLow
    ) {

      bull +=
        2;

    }


    if (
      secondHigh <
      firstHigh &&
      secondLow <
      firstLow
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
        (
          a,
          b
        ) =>
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

   Derived from D1 candles.
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
      !weeks.has(
        key
      )
    ) {

      weeks.set(
        key,
        []
      );

    }


    weeks
      .get(
        key
      )
      .push(
        candle
      );

  }


  const keys =
    [
      ...weeks.keys()
    ].sort(
      (
        a,
        b
      ) =>
        a -
        b
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
   SESSION LEVELS

   BTC trades 24/7.

   Windows are UTC:
   Asia      00:00 - 08:00
   London    07:00 - 16:00
   New York  13:00 - 22:00
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
      60 *
      60 *
      1000;


    const end =
      midnight +
      endHour *
      60 *
      60 *
      1000;


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
    SETTINGS
      .SWING_STRENGTH
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
   EQUAL HIGHS / LOWS
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
              2,

            difference

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
   FAIR VALUE GAPS
============================================================ */

function findFVGs(
  candles
) {

  const gaps =
    [];


  for (
    let i = 2;
    i <
      candles.length;
    i++
  ) {

    const first =
      candles[i - 2];


    const third =
      candles[i];


    /*
       Bullish FVG
    */

    if (
      third.low >
      first.high
    ) {

      gaps.push({

        type:
          "BULLISH",

        low:
          first.high,

        high:
          third.low,

        midpoint:
          (
            first.high +
            third.low
          ) /
          2,

        timestamp:
          third.timestamp

      });

    }


    /*
       Bearish FVG
    */

    if (
      third.high <
      first.low
    ) {

      gaps.push({

        type:
          "BEARISH",

        low:
          third.high,

        high:
          first.low,

        midpoint:
          (
            third.high +
            first.low
          ) /
          2,

        timestamp:
          third.timestamp

      });

    }

  }


  return gaps.slice(
    -12
  );

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

  if (
    !m5.length
  ) {

    return {

      current:
        null,

      average:
        null,

      ratio:
        null,

      state:
        "UNKNOWN"

    };

  }


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


  const averageVolume =
    average(
      volumes
    );


  const current =
    m5.at(-1)
      .volume;


  const ratio =
    averageVolume > 0
      ? current /
        averageVolume
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
        averageVolume,
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

   Coinbase returns maker side.

   maker sell = aggressive buyer
   maker buy  = aggressive seller
============================================================ */

function analyzeTrades(
  trades
) {

  if (
    !Array.isArray(
      trades
    )
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
        (
          a,
          b
        ) =>
          new Date(
            a.time
          ) -
          new Date(
            b.time
          )
      );


  let aggressiveBuy =
    0;


  let aggressiveSell =
    0;


  let buyNotional =
    0;


  let sellNotional =
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


    const price =
      num(
        trade.price
      );


    /*
       Coinbase maker SELL
       means market BUY aggression.
    */

    if (
      trade.side ===
      "sell"
    ) {

      aggressiveBuy +=
        size;


      buyNotional +=
        size *
        price;


      cvd +=
        size;

    }


    /*
       Coinbase maker BUY
       means market SELL aggression.
    */

    if (
      trade.side ===
      "buy"
    ) {

      aggressiveSell +=
        size;


      sellNotional +=
        size *
        price;


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

    buyNotionalUSD:
      round(
        buyNotional
      ),

    sellNotionalUSD:
      round(
        sellNotional
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
        SETTINGS
          .ORDER_BOOK_LEVELS
      )
      : [];


  const asks =
    Array.isArray(
      book?.asks
    )
      ? book.asks.slice(
        0,
        SETTINGS
          .ORDER_BOOK_LEVELS
      )
      : [];


  let bidBTC =
    0;


  let askBTC =
    0;


  let bidUSD =
    0;


  let askUSD =
    0;


  for (
    const bid of
    bids
  ) {

    const price =
      num(
        bid[0]
      );


    const size =
      num(
        bid[1]
      );


    bidBTC +=
      size;


    bidUSD +=
      price *
      size;

  }


  for (
    const ask of
    asks
  ) {

    const price =
      num(
        ask[0]
      );


    const size =
      num(
        ask[1]
      );


    askBTC +=
      size;


    askUSD +=
      price *
      size;

  }


  const total =
    bidUSD +
    askUSD;


  const imbalance =
    total > 0
      ? (
        bidUSD -
        askUSD
      ) /
        total *
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

    bidBTC:
      round(
        bidBTC,
        4
      ),

    askBTC:
      round(
        askBTC,
        4
      ),

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
   LIQUIDITY POOLS
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
      Number(
        level
      );


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


    /*
       Do not keep irrelevant levels
       extremely far away.
    */

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


  /* ========================================================
     DAILY
  ======================================================== */

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


  /* ========================================================
     WEEKLY
  ======================================================== */

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


  /* ========================================================
     SESSIONS
  ======================================================== */

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


  /* ========================================================
     EQH / EQL
  ======================================================== */

  for (
    const equalHigh of
    equalLiquidity
      .equalHighs
  ) {

    add(
      "Equal Highs",
      equalHigh.price,
      "BUY_SIDE",
      20,
      "EQH"
    );

  }


  for (
    const equalLow of
    equalLiquidity
      .equalLows
  ) {

    add(
      "Equal Lows",
      equalLow.price,
      "SELL_SIDE",
      20,
      "EQL"
    );

  }


  /* ========================================================
     SWINGS
  ======================================================== */

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


  /* ========================================================
     ROUND NUMBERS
  ======================================================== */

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


  /*
     Remove duplicate levels with exactly
     the same name/price pair.
  */

  const unique =
    new Map();


  for (
    const pool of
    pools
  ) {

    const key =
      `${pool.name}-${round(
        pool.level,
        2
      )}`;


    unique.set(
      key,
      pool
    );

  }


  return [
    ...unique.values()
  ].sort(
    (
      a,
      b
    ) => {

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


/* ============================================================
   FIND PRIMARY RAID TARGET

   Instead of blindly using the #1 weighted pool,
   combine score and proximity.
============================================================ */

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
    (
      a,
      b
    ) => {

      const valueA =
        a.score -
        Math.min(
          a.distanceATR *
          4,
          25
        );


      const valueB =
        b.score -
        Math.min(
          b.distanceATR *
          4,
          25
        );


      return (
        valueB -
        valueA
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

  if (
    !candle
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


  const upperWick =
    candle.high -
    bodyHigh;


  const lowerWick =
    bodyLow -
    candle.low;


  const upperPercent =
    upperWick /
    range *
    100;


  const lowerPercent =
    lowerWick /
    range *
    100;


  return {

    bullish:
      lowerPercent >=
        38 &&
      candle.close >
        candle.open,

    bearish:
      upperPercent >=
        38 &&
      candle.close <
        candle.open,

    upperWickPercent:
      round(
        upperPercent,
        1
      ),

    lowerWickPercent:
      round(
        lowerPercent,
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


  const prior =
    candles.slice(
      -8,
      -1
    );


  const current =
    candles.at(-1);


  const previousHigh =
    Math.max(
      ...prior.map(
        c =>
          c.high
      )
    );


  const previousLow =
    Math.min(
      ...prior.map(
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
   RAID ANALYSIS
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


  /* ========================================================
     PROXIMITY
  ======================================================== */

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
      "Target is inside 0.75 ATR"
    );

  }


  if (
    distanceATR <=
    0.30
  ) {

    score +=
      8;


    reasons.push(
      "Price is extremely close to the liquidity level"
    );

  }


  /* ========================================================
     SWEEP
  ======================================================== */

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
        "Buy-side liquidity has been swept"
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
        "Price closed back below the swept level"
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
        "Order book currently favors asks"
      );

    }


    if (
      m15Structure.bias ===
      "BEARISH"
    ) {

      score +=
        7;


      reasons.push(
        "M15 structure supports a bearish reaction"
      );

    }


    if (
      h1Structure.bias ===
      "BEARISH"
    ) {

      score +=
        5;


      reasons.push(
        "H1 structure supports downside"
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
        "Sell-side liquidity has been swept"
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
        "Price closed back above the swept level"
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
        "Order book currently favors bids"
      );

    }


    if (
      m15Structure.bias ===
      "BULLISH"
    ) {

      score +=
        7;


      reasons.push(
        "M15 structure supports a bullish reaction"
      );

    }


    if (
      h1Structure.bias ===
      "BULLISH"
    ) {

      score +=
        5;


      reasons.push(
        "H1 structure supports upside"
      );

    }

  }


  /* ========================================================
     VOLUME
  ======================================================== */

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


  /* ========================================================
     HTF CONFLICT PENALTY
  ======================================================== */

  if (
    pool.side ===
      "BUY_SIDE" &&
    h4Structure.bias ===
      "BULLISH"
  ) {

    score -=
      5;


    reasons.push(
      "H4 bullish trend reduces bearish reversal confidence"
    );

  }


  if (
    pool.side ===
      "SELL_SIDE" &&
    h4Structure.bias ===
      "BEARISH"
  ) {

    score -=
      5;


    reasons.push(
      "H4 bearish trend reduces bullish reversal confidence"
    );

  }


  score =
    clamp(
      score,
      0,
      95
    );


  /* ========================================================
     STAGE
  ======================================================== */

  let stage =
    "MONITORING";


  if (
    score >=
    SETTINGS
      .TRACKING_SCORE
  ) {

    stage =
      "TRACKING";

  }


  if (
    score >=
    SETTINGS
      .ARMED_SCORE
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


  /* ========================================================
     PROJECTED SWEEP OVERSHOOT
  ======================================================== */

  let minimumOvershoot =
    atr *
    SETTINGS
      .SWEEP_MIN_ATR;


  let maximumOvershoot =
    atr *
    SETTINGS
      .SWEEP_MAX_ATR;


  if (
    volume.state ===
    "HIGH"
  ) {

    maximumOvershoot *=
      1.20;

  }


  if (
    Math.abs(
      flow.deltaPercent
    ) >=
    20
  ) {

    maximumOvershoot *=
      1.15;

  }


  const projectedSweepZone =
    pool.side ===
    "BUY_SIDE"

      ? {

        low:
          level +
          minimumOvershoot,

        high:
          level +
          maximumOvershoot

      }

      : {

        low:
          level -
          maximumOvershoot,

        high:
          level -
          minimumOvershoot

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
          projectedSweepZone.low
        ),

      high:
        round(
          projectedSweepZone.high
        )

    },

    reasons

  };

}


/* ============================================================
   SIGNAL ENGINE
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


  /* ========================================================
     M5
  ======================================================== */

  if (
    m5Structure.bias ===
    "BULLISH"
  ) {

    buyScore +=
      7;


    buyReasons.push(
      "M5 bullish structure"
    );

  }


  if (
    m5Structure.bias ===
    "BEARISH"
  ) {

    sellScore +=
      7;


    sellReasons.push(
      "M5 bearish structure"
    );

  }


  /* ========================================================
     M15
  ======================================================== */

  if (
    m15Structure.bias ===
    "BULLISH"
  ) {

    buyScore +=
      13;


    buyReasons.push(
      "M15 bullish structure"
    );

  }


  if (
    m15Structure.bias ===
    "BEARISH"
  ) {

    sellScore +=
      13;


    sellReasons.push(
      "M15 bearish structure"
    );

  }


  /* ========================================================
     H1
  ======================================================== */

  if (
    h1Structure.bias ===
    "BULLISH"
  ) {

    buyScore +=
      12;


    buyReasons.push(
      "H1 bullish structure"
    );

  }


  if (
    h1Structure.bias ===
    "BEARISH"
  ) {

    sellScore +=
      12;


    sellReasons.push(
      "H1 bearish structure"
    );

  }


  /* ========================================================
     H4
  ======================================================== */

  if (
    h4Structure.bias ===
    "BULLISH"
  ) {

    buyScore +=
      8;


    buyReasons.push(
      "H4 bullish structure"
    );

  }


  if (
    h4Structure.bias ===
    "BEARISH"
  ) {

    sellScore +=
      8;


    sellReasons.push(
      "H4 bearish structure"
    );

  }


  /* ========================================================
     VWAP
  ======================================================== */

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
        "Price above daily VWAP"
      );

    }


    if (
      price <
      vwap
    ) {

      sellScore +=
        5;


      sellReasons.push(
        "Price below daily VWAP"
      );

    }

  }


  /* ========================================================
     DELTA
  ======================================================== */

  if (
    flow.deltaPercent >
    5
  ) {

    buyScore +=
      9;


    buyReasons.push(
      "Positive aggressive trade delta"
    );

  }


  if (
    flow.deltaPercent <
    -5
  ) {

    sellScore +=
      9;


    sellReasons.push(
      "Negative aggressive trade delta"
    );

  }


  /* ========================================================
     ORDER BOOK
  ======================================================== */

  if (
    book.imbalancePercent >
    5
  ) {

    buyScore +=
      6;


    buyReasons.push(
      "Order book favors bids"
    );

  }


  if (
    book.imbalancePercent <
    -5
  ) {

    sellScore +=
      6;


    sellReasons.push(
      "Order book favors asks"
    );

  }


  /* ========================================================
     REJECTION
  ======================================================== */

  if (
    rejection.bullish
  ) {

    buyScore +=
      7;


    buyReasons.push(
      "Bullish M5 rejection candle"
    );

  }


  if (
    rejection.bearish
  ) {

    sellScore +=
      7;


    sellReasons.push(
      "Bearish M5 rejection candle"
    );

  }


  /* ========================================================
     STRUCTURE BREAK
  ======================================================== */

  if (
    trigger.bullish
  ) {

    buyScore +=
      10;


    buyReasons.push(
      "M5 bullish structure break"
    );

  }


  if (
    trigger.bearish
  ) {

    sellScore +=
      10;


    sellReasons.push(
      "M5 bearish structure break"
    );

  }


  /* ========================================================
     LIQUIDITY RAID
  ======================================================== */

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
        "Sell-side liquidity sweep rejected"
      );

    }


    if (
      raid.side ===
      "BUY_SIDE"
    ) {

      sellScore +=
        23;


      sellReasons.push(
        "Buy-side liquidity sweep rejected"
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
      SETTINGS
        .SIGNAL_SCORE &&
    buyScore >
      sellScore &&
    gap >=
      SETTINGS
        .SIGNAL_GAP
  ) {

    signal =
      "BUY";

  }


  if (
    sellScore >=
      SETTINGS
        .SIGNAL_SCORE &&
    sellScore >
      buyScore &&
    gap >=
      SETTINGS
        .SIGNAL_GAP
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


  /* ========================================================
     BUY LEVELS
  ======================================================== */

  if (
    signal ===
    "BUY"
  ) {

    entry =
      price;


    stopLoss =
      price -
      atr *
      SETTINGS
        .STOP_ATR;


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
      SETTINGS
        .TP1_R;


    takeProfit2 =
      entry +
      risk *
      SETTINGS
        .TP2_R;

  }


  /* ========================================================
     SELL LEVELS
  ======================================================== */

  if (
    signal ===
    "SELL"
  ) {

    entry =
      price;


    stopLoss =
      price +
      atr *
      SETTINGS
        .STOP_ATR;


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
      SETTINGS
        .TP1_R;


    takeProfit2 =
      entry -
      risk *
      SETTINGS
        .TP2_R;

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

    riskReward1:
      signal ===
      "WAIT"
        ? null
        : SETTINGS
          .TP1_R,

    riskReward2:
      signal ===
      "WAIT"
        ? null
        : SETTINGS
          .TP2_R,

    buyReasons:
      buyReasons,

    sellReasons:
      sellReasons

  };

}


/* ============================================================
   MAIN API
============================================================ */

module.exports =
async function handler(
  req,
  res
) {

  /* ========================================================
     HEADERS
  ======================================================== */

  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );


  res.setHeader(
    "Pragma",
    "no-cache"
  );


  res.setHeader(
    "Expires",
    "0"
  );


  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );


  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );


  if (
    req.method ===
    "OPTIONS"
  ) {

    res
      .status(200)
      .end();


    return;

  }


  const started =
    Date.now();


  try {

    /* ======================================================
       PRIMARY MARKET REQUESTS

       Only 6 Coinbase calls.

       ticker
       trades
       book
       M5
       H1
       D1
    ====================================================== */

    const [

      ticker,

      trades,

      bookRaw,

      m5,

      h1,

      dailyCandles

    ] =
      await Promise.all([

        fetchTicker(),

        fetchTrades(),

        fetchOrderBook(),

        fetchCandles({

          granularity:
            SETTINGS
              .M5_GRANULARITY,

          count:
            SETTINGS
              .M5_CANDLES

        }),

        fetchCandles({

          granularity:
            SETTINGS
              .H1_GRANULARITY,

          count:
            SETTINGS
              .H1_CANDLES

        }),

        fetchCandles({

          granularity:
            SETTINGS
              .D1_GRANULARITY,

          count:
            SETTINGS
              .D1_CANDLES

        })

      ]);


    /* ======================================================
       VALIDATION
    ====================================================== */

    if (
      m5.length <
      50
    ) {

      throw new Error(
        `Insufficient M5 candles from Coinbase: ${m5.length}`
      );

    }


    if (
      h1.length <
      50
    ) {

      throw new Error(
        `Insufficient H1 candles from Coinbase: ${h1.length}`
      );

    }


    if (
      dailyCandles.length <
      8
    ) {

      throw new Error(
        `Insufficient daily candles from Coinbase: ${dailyCandles.length}`
      );

    }


    /* ======================================================
       PRICE
    ====================================================== */

    const price =
      num(
        ticker.price,
        m5.at(-1)
          .close
      );


    /* ======================================================
       TIMEFRAMES
    ====================================================== */

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


    /* ======================================================
       INDICATORS
    ====================================================== */

    const atr =
      calculateATR(
        m5,
        SETTINGS
          .ATR_PERIOD
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


    /* ======================================================
       DAILY / WEEKLY
    ====================================================== */

    const daily =
      dailyLevels(
        dailyCandles
      );


    const weekly =
      weeklyLevels(
        dailyCandles
      );


    /* ======================================================
       TODAY VWAP
    ====================================================== */

    const todayM5 =
      getTodayCandles(
        m5
      );


    const vwap =
      calculateVWAP(
        todayM5
      );


    /* ======================================================
       SESSION
    ====================================================== */

    const sessions =
      sessionLevels(
        m5
      );


    const session =
      currentSession();


    /* ======================================================
       STRUCTURAL LIQUIDITY
    ====================================================== */

    const swings =
      findSwings(
        m15,
        SETTINGS
          .SWING_STRENGTH
      );


    const equalLiquidity =
      findEqualLiquidity(
        swings,
        atr
      );


    const fvgs =
      findFVGs(
        m15
      );


    const roundNumbers =
      roundLevels(
        price
      );


    /* ======================================================
       FLOW
    ====================================================== */

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


    /* ======================================================
       LIQUIDITY MAP
    ====================================================== */

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


    const primaryPool =
      choosePrimaryLiquidity(
        pools
      );


    /* ======================================================
       RAID
    ====================================================== */

    const raid =
      analyzeRaid({

        pool:
          primaryPool,

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


    /* ======================================================
       CONFIRMATIONS
    ====================================================== */

    const rejection =
      candleRejection(
        m5.at(-1)
      );


    const trigger =
      structureTrigger(
        m5
      );


    /* ======================================================
       SIGNAL
    ====================================================== */

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


    /* ======================================================
       MACRO BIAS
    ====================================================== */

    const structures =
      [

        m15Structure,

        h1Structure,

        h4Structure

      ];


    const bullish =
      structures.filter(
        structure =>
          structure.bias ===
          "BULLISH"
      ).length;


    const bearish =
      structures.filter(
        structure =>
          structure.bias ===
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


    /* ======================================================
       VOLATILITY
    ====================================================== */

    const atrPercent =
      price > 0
        ? atr /
          price *
          100
        : 0;


    let volatilityRegime =
      "NORMAL";


    if (
      atrPercent <
      0.08
    ) {

      volatilityRegime =
        "LOW";

    }


    if (
      atrPercent >=
      0.25
    ) {

      volatilityRegime =
        "HIGH";

    }


    if (
      atrPercent >=
      0.50
    ) {

      volatilityRegime =
        "EXTREME";

    }


    /* ======================================================
       RESPONSE
    ====================================================== */

    return res
      .status(200)
      .json({

        ok:
          true,

        engine:
          "MKAYFX BTC LIQUIDITY INTELLIGENCE V2",

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


        /* ==================================================
           MARKET
        ================================================== */

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


        /* ==================================================
           SESSION
        ================================================== */

        session,


        sessionLevels: {

          asia:
            sessions.asia
              ? {

                high:
                  round(
                    sessions
                      .asia
                      .high
                  ),

                low:
                  round(
                    sessions
                      .asia
                      .low
                  )

              }
              : null,

          london:
            sessions.london
              ? {

                high:
                  round(
                    sessions
                      .london
                      .high
                  ),

                low:
                  round(
                    sessions
                      .london
                      .low
                  )

              }
              : null,

          newYork:
            sessions.newYork
              ? {

                high:
                  round(
                    sessions
                      .newYork
                      .high
                  ),

                low:
                  round(
                    sessions
                      .newYork
                      .low
                  )

              }
              : null

        },


        /* ==================================================
           BIAS
        ================================================== */

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


        /* ==================================================
           VOLATILITY
        ================================================== */

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

          regime:
            volatilityRegime

        },


        /* ==================================================
           VWAP
        ================================================== */

        vwap: {

          daily:
            round(
              vwap
            ),

          position:
            vwap ===
            null

              ? "UNKNOWN"

              : price >
                vwap

                ? "ABOVE"

                : "BELOW"

        },


        /* ==================================================
           LEVELS
        ================================================== */

        levels: {

          previousDayHigh:
            round(
              daily
                .previousDayHigh
            ),

          previousDayLow:
            round(
              daily
                .previousDayLow
            ),

          dailyOpen:
            round(
              daily
                .dailyOpen
            ),

          previousWeekHigh:
            round(
              weekly
                .previousWeekHigh
            ),

          previousWeekLow:
            round(
              weekly
                .previousWeekLow
            ),

          weeklyOpen:
            round(
              weekly
                .weeklyOpen
            ),

          roundNumberAbove:
            roundNumbers
              .upper,

          roundNumberBelow:
            roundNumbers
              .lower,

          majorRoundAbove:
            roundNumbers
              .majorUpper,

          majorRoundBelow:
            roundNumbers
              .majorLower

        },


        /* ==================================================
           FLOW
        ================================================== */

        flow,


        orderBook:
          book,


        volume,


        /* ==================================================
           RAID
        ================================================== */

        raid,


        /* ==================================================
           SIGNAL
        ================================================== */

        signal,


        /* ==================================================
           CONFIRMATION
        ================================================== */

        confirmation: {

          rejection,

          structureTrigger:
            trigger

        },


        /* ==================================================
           LIQUIDITY POOLS
        ================================================== */

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


        /* ==================================================
           FVGs
        ================================================== */

        fairValueGaps:
          fvgs.map(
            gap => ({

              type:
                gap.type,

              low:
                round(
                  gap.low
                ),

              high:
                round(
                  gap.high
                ),

              midpoint:
                round(
                  gap.midpoint
                )

            })
          ),


        /* ==================================================
           DEBUG
        ================================================== */

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
            dailyCandles.length

        }

      });

  }

  catch (
    error
  ) {

    console.error(
      "MKAYFX BTC ERROR:",
      error
    );


    return res
      .status(500)
      .json({

        ok:
          false,

        engine:
          "MKAYFX BTC LIQUIDITY INTELLIGENCE V2",

        source:
          "Coinbase Exchange",

        error:
          error?.message ||
          "Unknown BTC engine error",

        timestamp:
          new Date()
            .toISOString(),

        latencyMs:
          Date.now() -
          started

      });

  }

};