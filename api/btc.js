/* ============================================================
   MKAYFX BTC LIQUIDITY INTELLIGENCE ENGINE V1
   ------------------------------------------------------------
   FILE:
   /api/btc.js

   MARKET:
   BTC-USD

   DATA:
   Coinbase Exchange public REST API

   NO TWELVE DATA
   NO API KEY REQUIRED

   PURPOSE
   ------------------------------------------------------------
   This is a BTC/USD market-intelligence engine.

   It analyses:

   - Live BTC price
   - M5 structure
   - M15 structure
   - H1 structure
   - H4 structure
   - Previous Day High / Low
   - Previous Week High / Low
   - Daily Open
   - Weekly Open
   - Session highs/lows
   - Equal highs/lows
   - Swing liquidity
   - Fair Value Gaps
   - ATR
   - RSI
   - EMA trend
   - VWAP
   - Relative volume
   - Coinbase trade delta
   - CVD proxy
   - Delta divergence
   - Order-book imbalance
   - Absorption proxy
   - Round-number liquidity
   - Raid scoring
   - Sweep projection
   - Rejection confirmation
   - Structure confirmation
   - BUY / SELL / WAIT intelligence

   IMPORTANT
   ------------------------------------------------------------
   Coinbase trade "side" represents the MAKER side.

   maker SELL = aggressive BUY
   maker BUY  = aggressive SELL

   We reverse Coinbase's side when calculating taker delta.
============================================================ */


const PRODUCT = "BTC-USD";

const COINBASE =
  "https://api.exchange.coinbase.com";


/* ============================================================
   SETTINGS
============================================================ */

const SETTINGS = {

  /* ---------- candle configuration ---------- */

  M5_GRANULARITY: 300,

  M15_MINUTES: 15,

  H1_MINUTES: 60,

  H4_MINUTES: 240,


  /* ---------- indicators ---------- */

  ATR_PERIOD: 14,

  RSI_PERIOD: 14,

  EMA_FAST: 20,

  EMA_MID: 50,

  EMA_SLOW: 200,


  /* ---------- liquidity ---------- */

  SWING_LOOKBACK: 3,

  EQUAL_LEVEL_ATR_TOLERANCE: 0.12,

  ROUND_NUMBER_STEP: 1000,

  MAJOR_ROUND_NUMBER_STEP: 5000,


  /* ---------- sweep ---------- */

  SWEEP_MIN_ATR: 0.04,

  SWEEP_MAX_ATR: 0.45,

  EXTREME_SWEEP_ATR: 0.80,

  APPROACH_ATR_DISTANCE: 1.50,


  /* ---------- signal scoring ---------- */

  TRACKING_SCORE: 35,

  ARMED_SCORE: 55,

  CONFIRMATION_SCORE: 68,

  SIGNAL_SCORE: 72,

  MIN_SIGNAL_MARGIN: 7,


  /* ---------- risk projection ---------- */

  STOP_ATR_BUFFER: 0.30,

  TP1_R: 1.5,

  TP2_R: 2.5,


  /* ---------- volume ---------- */

  VOLUME_LOOKBACK: 20,

  HIGH_VOLUME_MULTIPLIER: 1.35,

  LOW_VOLUME_MULTIPLIER: 0.70,


  /* ---------- order book ---------- */

  BOOK_LEVELS: 25

};


/* ============================================================
   HELPERS
============================================================ */

function num(v, fallback = 0) {

  const n = Number(v);

  return Number.isFinite(n)
    ? n
    : fallback;

}


function round(v, digits = 2) {

  if (!Number.isFinite(v)) {
    return null;
  }

  const p =
    10 ** digits;

  return (
    Math.round(v * p) / p
  );

}


function clamp(v, min, max) {

  return Math.max(
    min,
    Math.min(
      max,
      v
    )
  );

}


function average(values) {

  if (!values.length) {
    return 0;
  }

  return (
    values.reduce(
      (a, b) => a + b,
      0
    ) / values.length
  );

}


function sum(values) {

  return values.reduce(
    (a, b) => a + b,
    0
  );

}


function median(values) {

  if (!values.length) {
    return 0;
  }

  const s =
    [...values]
      .sort(
        (a, b) => a - b
      );

  const m =
    Math.floor(
      s.length / 2
    );

  return s.length % 2
    ? s[m]
    : (
      s[m - 1] +
      s[m]
    ) / 2;

}


function pct(a, b) {

  if (!b) {
    return 0;
  }

  return (
    (a - b) /
    b
  ) * 100;

}


/* ============================================================
   FETCH
============================================================ */

async function getJSON(
  url,
  timeoutMs = 8000
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
          headers: {
            "Accept":
              "application/json",

            "User-Agent":
              "MKAYFX-BTC-INTELLIGENCE"
          },

          signal:
            controller.signal
        }
      );


    const text =
      await response.text();


    let data;

    try {

      data =
        JSON.parse(text);

    } catch {

      throw new Error(
        `Invalid Coinbase response: ${text.slice(0, 120)}`
      );

    }


    if (!response.ok) {

      throw new Error(
        data?.message ||
        `Coinbase HTTP ${response.status}`
      );

    }


    return data;

  } finally {

    clearTimeout(timer);

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


async function fetchBook() {

  return getJSON(
    `${COINBASE}/products/${PRODUCT}/book?level=2`
  );

}


async function fetchTrades() {

  return getJSON(
    `${COINBASE}/products/${PRODUCT}/trades?limit=1000`
  );

}


/* ============================================================
   COINBASE CANDLES

   Coinbase format:

   [
     time,
     low,
     high,
     open,
     close,
     volume
   ]

   Maximum returned candles can be limited,
   therefore we fetch several windows.
============================================================ */

async function fetchCandlesChunk(
  start,
  end
) {

  const url =
    `${COINBASE}/products/${PRODUCT}/candles` +
    `?granularity=${SETTINGS.M5_GRANULARITY}` +
    `&start=${encodeURIComponent(start.toISOString())}` +
    `&end=${encodeURIComponent(end.toISOString())}`;


  const raw =
    await getJSON(url);


  return raw.map(
    row => ({

      time:
        new Date(
          row[0] * 1000
        ),

      timestamp:
        row[0] * 1000,

      low:
        num(row[1]),

      high:
        num(row[2]),

      open:
        num(row[3]),

      close:
        num(row[4]),

      volume:
        num(row[5])

    })
  );

}


async function fetchM5History(
  days = 9
) {

  const chunks = [];

  const now =
    new Date();

  const chunkHours =
    20;


  for (
    let hoursBack = 0;
    hoursBack < days * 24;
    hoursBack += chunkHours
  ) {

    const end =
      new Date(
        now.getTime() -
        hoursBack *
        60 *
        60 *
        1000
      );


    const start =
      new Date(
        end.getTime() -
        chunkHours *
        60 *
        60 *
        1000
      );


    try {

      const candles =
        await fetchCandlesChunk(
          start,
          end
        );

      chunks.push(
        ...candles
      );

    } catch (err) {

      console.error(
        "Candle chunk failed:",
        err.message
      );

    }


    /* Coinbase courtesy delay */

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          80
        )
    );

  }


  const map =
    new Map();


  for (
    const candle of chunks
  ) {

    map.set(
      candle.timestamp,
      candle
    );

  }


  return [
    ...map.values()
  ].sort(
    (a, b) =>
      a.timestamp -
      b.timestamp
  );

}


/* ============================================================
   RESAMPLING
============================================================ */

function resample(
  candles,
  minutes
) {

  const ms =
    minutes *
    60 *
    1000;


  const buckets =
    new Map();


  for (
    const candle of candles
  ) {

    const key =
      Math.floor(
        candle.timestamp /
        ms
      ) * ms;


    if (
      !buckets.has(key)
    ) {

      buckets.set(
        key,
        {

          timestamp:
            key,

          time:
            new Date(key),

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

    } else {

      const b =
        buckets.get(key);

      b.high =
        Math.max(
          b.high,
          candle.high
        );

      b.low =
        Math.min(
          b.low,
          candle.low
        );

      b.close =
        candle.close;

      b.volume +=
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

function ema(
  values,
  period
) {

  if (!values.length) {
    return [];
  }


  const k =
    2 /
    (
      period +
      1
    );


  const result =
    [];

  let current =
    values[0];


  for (
    const value of values
  ) {

    current =
      value *
      k +
      current *
      (
        1 -
        k
      );

    result.push(
      current
    );

  }


  return result;

}


/* ============================================================
   RSI
============================================================ */

function rsi(
  closes,
  period = 14
) {

  if (
    closes.length <
    period + 1
  ) {

    return 50;

  }


  let gain = 0;

  let loss = 0;


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
      change >= 0
    ) {

      gain +=
        change;

    } else {

      loss +=
        Math.abs(change);

    }

  }


  if (
    loss === 0
  ) {

    return 100;

  }


  const rs =
    gain /
    loss;


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

function atr(
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

    const c =
      candles[i];

    const prev =
      candles[i - 1];


    tr.push(
      Math.max(

        c.high -
        c.low,

        Math.abs(
          c.high -
          prev.close
        ),

        Math.abs(
          c.low -
          prev.close
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
   VWAP
============================================================ */

function calculateVWAP(
  candles
) {

  let pv = 0;

  let volume = 0;


  for (
    const c of candles
  ) {

    const typical =
      (
        c.high +
        c.low +
        c.close
      ) / 3;


    pv +=
      typical *
      c.volume;


    volume +=
      c.volume;

  }


  if (
    volume === 0
  ) {

    return null;

  }


  return (
    pv /
    volume
  );

}


/* ============================================================
   STRUCTURE
============================================================ */

function detectStructure(
  candles
) {

  if (
    candles.length < 20
  ) {

    return {

      bias:
        "NEUTRAL",

      score:
        0,

      trend:
        "UNKNOWN"

    };

  }


  const closes =
    candles.map(
      c => c.close
    );


  const fast =
    ema(
      closes,
      SETTINGS.EMA_FAST
    );


  const mid =
    ema(
      closes,
      SETTINGS.EMA_MID
    );


  const slow =
    ema(
      closes,
      SETTINGS.EMA_SLOW
    );


  const last =
    closes.at(-1);


  const e20 =
    fast.at(-1);


  const e50 =
    mid.at(-1);


  const e200 =
    slow.at(-1);


  let bull = 0;

  let bear = 0;


  if (
    last > e20
  ) bull += 1;


  if (
    last < e20
  ) bear += 1;


  if (
    e20 > e50
  ) bull += 1;


  if (
    e20 < e50
  ) bear += 1;


  if (
    e50 > e200
  ) bull += 1;


  if (
    e50 < e200
  ) bear += 1;


  const recent =
    candles.slice(-8);


  const firstHalf =
    recent.slice(0, 4);


  const secondHalf =
    recent.slice(4);


  const high1 =
    Math.max(
      ...firstHalf.map(
        c => c.high
      )
    );


  const high2 =
    Math.max(
      ...secondHalf.map(
        c => c.high
      )
    );


  const low1 =
    Math.min(
      ...firstHalf.map(
        c => c.low
      )
    );


  const low2 =
    Math.min(
      ...secondHalf.map(
        c => c.low
      )
    );


  if (
    high2 > high1 &&
    low2 > low1
  ) {

    bull += 2;

  }


  if (
    high2 < high1 &&
    low2 < low1
  ) {

    bear += 2;

  }


  let bias =
    "NEUTRAL";


  if (
    bull >
    bear + 1
  ) {

    bias =
      "BULLISH";

  }


  if (
    bear >
    bull + 1
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
      round(last),

    ema20:
      round(e20),

    ema50:
      round(e50),

    ema200:
      round(e200),

    rsi:
      round(
        rsi(
          closes,
          SETTINGS.RSI_PERIOD
        ),
        1
      )

  };

}


/* ============================================================
   SWING HIGH / LOW DETECTION
============================================================ */

function findSwings(
  candles,
  strength =
    SETTINGS.SWING_LOOKBACK
) {

  const highs = [];

  const lows = [];


  for (
    let i = strength;
    i <
      candles.length -
      strength;
    i++
  ) {

    let isHigh = true;

    let isLow = true;


    for (
      let j = 1;
      j <= strength;
      j++
    ) {

      if (
        candles[i].high <=
        candles[i - j].high ||
        candles[i].high <=
        candles[i + j].high
      ) {

        isHigh = false;

      }


      if (
        candles[i].low >=
        candles[i - j].low ||
        candles[i].low >=
        candles[i + j].low
      ) {

        isLow = false;

      }

    }


    if (
      isHigh
    ) {

      highs.push({

        price:
          candles[i].high,

        timestamp:
          candles[i].timestamp,

        time:
          candles[i].time

      });

    }


    if (
      isLow
    ) {

      lows.push({

        price:
          candles[i].low,

        timestamp:
          candles[i].timestamp,

        time:
          candles[i].time

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

function findEqualLevels(
  swings,
  currentATR
) {

  const tolerance =
    currentATR *
    SETTINGS
      .EQUAL_LEVEL_ATR_TOLERANCE;


  const eqh = [];

  const eql = [];


  function process(
    points,
    destination
  ) {

    const recent =
      points.slice(-30);


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

        if (
          Math.abs(
            recent[i].price -
            recent[j].price
          ) <=
          tolerance
        ) {

          destination.push({

            price:
              (
                recent[i].price +
                recent[j].price
              ) / 2,

            touches:
              2,

            firstTime:
              recent[i].timestamp,

            secondTime:
              recent[j].timestamp

          });

        }

      }

    }

  }


  process(
    swings.highs,
    eqh
  );


  process(
    swings.lows,
    eql
  );


  return {

    equalHighs:
      eqh.slice(-5),

    equalLows:
      eql.slice(-5)

  };

}


/* ============================================================
   FVG DETECTION
============================================================ */

function detectFVGs(
  candles
) {

  const fvgs = [];


  for (
    let i = 2;
    i <
      candles.length;
    i++
  ) {

    const a =
      candles[i - 2];

    const c =
      candles[i];


    /*
      Bullish imbalance:

      candle 3 low >
      candle 1 high
    */

    if (
      c.low >
      a.high
    ) {

      fvgs.push({

        type:
          "BULLISH",

        low:
          a.high,

        high:
          c.low,

        midpoint:
          (
            a.high +
            c.low
          ) / 2,

        timestamp:
          c.timestamp

      });

    }


    /*
      Bearish imbalance:

      candle 3 high <
      candle 1 low
    */

    if (
      c.high <
      a.low
    ) {

      fvgs.push({

        type:
          "BEARISH",

        low:
          c.high,

        high:
          a.low,

        midpoint:
          (
            c.high +
            a.low
          ) / 2,

        timestamp:
          c.timestamp

      });

    }

  }


  return fvgs.slice(-12);

}


/* ============================================================
   DAILY / WEEKLY LEVELS
============================================================ */

function dateKeyUTC(
  timestamp
) {

  const d =
    new Date(timestamp);

  return (
    `${d.getUTCFullYear()}-` +
    `${String(
      d.getUTCMonth() + 1
    ).padStart(2, "0")}-` +
    `${String(
      d.getUTCDate()
    ).padStart(2, "0")}`
  );

}


function previousDayLevels(
  candles
) {

  const groups =
    new Map();


  for (
    const c of candles
  ) {

    const key =
      dateKeyUTC(
        c.timestamp
      );


    if (
      !groups.has(key)
    ) {

      groups.set(
        key,
        []
      );

    }


    groups.get(key)
      .push(c);

  }


  const dates =
    [...groups.keys()]
      .sort();


  if (
    dates.length < 2
  ) {

    return null;

  }


  const current =
    dates.at(-1);


  const previous =
    dates.at(-2);


  const prevBars =
    groups.get(previous);


  const todayBars =
    groups.get(current);


  return {

    previousDate:
      previous,

    high:
      Math.max(
        ...prevBars.map(
          c => c.high
        )
      ),

    low:
      Math.min(
        ...prevBars.map(
          c => c.low
        )
      ),

    close:
      prevBars.at(-1).close,

    dailyOpen:
      todayBars[0].open

  };

}


/* ============================================================
   WEEK NUMBER
============================================================ */

function startOfUTCWeek(
  timestamp
) {

  const d =
    new Date(timestamp);


  const day =
    d.getUTCDay();


  const diff =
    day === 0
      ? 6
      : day - 1;


  const result =
    new Date(
      Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate() -
        diff
      )
    );


  return result.getTime();

}


function previousWeekLevels(
  candles
) {

  const groups =
    new Map();


  for (
    const c of candles
  ) {

    const key =
      startOfUTCWeek(
        c.timestamp
      );


    if (
      !groups.has(key)
    ) {

      groups.set(
        key,
        []
      );

    }


    groups.get(key)
      .push(c);

  }


  const keys =
    [...groups.keys()]
      .sort(
        (a, b) =>
          a - b
      );


  if (
    keys.length < 2
  ) {

    return null;

  }


  const currentKey =
    keys.at(-1);


  const previousKey =
    keys.at(-2);


  const current =
    groups.get(
      currentKey
    );


  const previous =
    groups.get(
      previousKey
    );


  return {

    high:
      Math.max(
        ...previous.map(
          c => c.high
        )
      ),

    low:
      Math.min(
        ...previous.map(
          c => c.low
        )
      ),

    weeklyOpen:
      current[0].open

  };

}


/* ============================================================
   SESSIONS

   UTC windows

   Asia:
   00:00 - 08:00

   London:
   07:00 - 16:00

   New York:
   13:00 - 22:00

   Crypto never closes.
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


  const today =
    candles.filter(
      c =>
        c.timestamp >=
        midnight
    );


  function getWindow(
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
      today.filter(
        c =>
          c.timestamp >= start &&
          c.timestamp < end
      );


    if (!bars.length) {

      return null;

    }


    return {

      high:
        Math.max(
          ...bars.map(
            c => c.high
          )
        ),

      low:
        Math.min(
          ...bars.map(
            c => c.low
          )
        ),

      open:
        bars[0].open,

      close:
        bars.at(-1).close

    };

  }


  return {

    asia:
      getWindow(
        0,
        8
      ),

    london:
      getWindow(
        7,
        16
      ),

    newYork:
      getWindow(
        13,
        22
      )

  };

}


/* ============================================================
   CURRENT SESSION
============================================================ */

function activeSession() {

  const now =
    new Date();

  const h =
    now.getUTCHours();

  const day =
    now.getUTCDay();


  const sessions = [];


  if (
    h >= 0 &&
    h < 8
  ) {

    sessions.push(
      "ASIA"
    );

  }


  if (
    h >= 7 &&
    h < 16
  ) {

    sessions.push(
      "LONDON"
    );

  }


  if (
    h >= 13 &&
    h < 22
  ) {

    sessions.push(
      "NEW YORK"
    );

  }


  return {

    active:
      sessions.length
        ? sessions
        : [
          "CRYPTO 24/7"
        ],

    utcHour:
      h,

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
   VOLUME ANALYSIS
============================================================ */

function volumeAnalysis(
  candles
) {

  const recent =
    candles.slice(
      -SETTINGS
        .VOLUME_LOOKBACK
    );


  const volumes =
    recent.map(
      c => c.volume
    );


  const avg =
    average(volumes);


  const current =
    candles.at(-1)?.volume ||
    0;


  const ratio =
    avg
      ? current / avg
      : 1;


  let state =
    "NORMAL";


  if (
    ratio >=
    SETTINGS
      .HIGH_VOLUME_MULTIPLIER
  ) {

    state =
      "HIGH";

  }


  if (
    ratio <=
    SETTINGS
      .LOW_VOLUME_MULTIPLIER
  ) {

    state =
      "LOW";

  }


  return {

    current:
      round(
        current,
        4
      ),

    average:
      round(
        avg,
        4
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
   TRADE DELTA / CVD

   Coinbase side = maker side.

   Coinbase side SELL:
   resting sell order was hit by aggressive buyer.

   Coinbase side BUY:
   resting buy order was hit by aggressive seller.
============================================================ */

function tradeFlow(
  trades
) {

  let aggressiveBuyVolume =
    0;

  let aggressiveSellVolume =
    0;

  let buyNotional =
    0;

  let sellNotional =
    0;


  const sorted =
    [...trades]
      .sort(
        (a, b) =>
          new Date(a.time) -
          new Date(b.time)
      );


  const cvdSeries =
    [];

  let cvd =
    0;


  for (
    const trade of sorted
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
       maker side SELL
       =
       aggressive buyer
    */

    if (
      trade.side ===
      "sell"
    ) {

      aggressiveBuyVolume +=
        size;

      buyNotional +=
        size *
        price;

      cvd +=
        size;

    }


    /*
       maker side BUY
       =
       aggressive seller
    */

    if (
      trade.side ===
      "buy"
    ) {

      aggressiveSellVolume +=
        size;

      sellNotional +=
        size *
        price;

      cvd -=
        size;

    }


    cvdSeries.push(
      cvd
    );

  }


  const total =
    aggressiveBuyVolume +
    aggressiveSellVolume;


  const delta =
    aggressiveBuyVolume -
    aggressiveSellVolume;


  const deltaPct =
    total
      ? (
        delta /
        total
      ) * 100
      : 0;


  let pressure =
    "BALANCED";


  if (
    deltaPct > 8
  ) {

    pressure =
      "AGGRESSIVE BUYING";

  }


  if (
    deltaPct < -8
  ) {

    pressure =
      "AGGRESSIVE SELLING";

  }


  return {

    trades:
      trades.length,

    aggressiveBuyBTC:
      round(
        aggressiveBuyVolume,
        5
      ),

    aggressiveSellBTC:
      round(
        aggressiveSellVolume,
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
        deltaPct,
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
   ORDER BOOK ANALYSIS
============================================================ */

function analyzeBook(
  book
) {

  const bids =
    (
      book?.bids ||
      []
    )
      .slice(
        0,
        SETTINGS
          .BOOK_LEVELS
      );


  const asks =
    (
      book?.asks ||
      []
    )
      .slice(
        0,
        SETTINGS
          .BOOK_LEVELS
      );


  let bidBTC = 0;

  let askBTC = 0;

  let bidUSD = 0;

  let askUSD = 0;


  for (
    const row of bids
  ) {

    const price =
      num(row[0]);

    const size =
      num(row[1]);


    bidBTC +=
      size;

    bidUSD +=
      price *
      size;

  }


  for (
    const row of asks
  ) {

    const price =
      num(row[0]);

    const size =
      num(row[1]);


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
    total
      ? (
        (
          bidUSD -
          askUSD
        ) /
        total
      ) * 100
      : 0;


  let pressure =
    "BALANCED";


  if (
    imbalance > 8
  ) {

    pressure =
      "BID HEAVY";

  }


  if (
    imbalance < -8
  ) {

    pressure =
      "ASK HEAVY";

  }


  return {

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

    pressure,

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
        : null

  };

}


/* ============================================================
   ROUND NUMBERS
============================================================ */

function roundNumberLiquidity(
  price
) {

  const step =
    SETTINGS
      .ROUND_NUMBER_STEP;


  const majorStep =
    SETTINGS
      .MAJOR_ROUND_NUMBER_STEP;


  const lower =
    Math.floor(
      price /
      step
    ) *
    step;


  const upper =
    Math.ceil(
      price /
      step
    ) *
    step;


  const majorLower =
    Math.floor(
      price /
      majorStep
    ) *
    majorStep;


  const majorUpper =
    Math.ceil(
      price /
      majorStep
    ) *
    majorStep;


  return {

    lower,

    upper,

    majorLower,

    majorUpper

  };

}


/* ============================================================
   BUILD LIQUIDITY POOL LIST
============================================================ */

function buildLiquidityPools({
  price,
  atrValue,
  previousDay,
  previousWeek,
  sessions,
  equalLevels,
  swings,
  roundNumbers
}) {

  const pools = [];


  function add(
    name,
    level,
    side,
    weight,
    type
  ) {

    if (
      !Number.isFinite(level)
    ) {

      return;

    }


    const distance =
      Math.abs(
        price -
        level
      );


    pools.push({

      name,

      level,

      side,

      type,

      baseWeight:
        weight,

      distance,

      distanceATR:
        atrValue
          ? distance /
            atrValue
          : null

    });

  }


  if (
    previousDay
  ) {

    add(
      "Previous Day High",
      previousDay.high,
      "BUY_SIDE",
      23,
      "PDH"
    );

    add(
      "Previous Day Low",
      previousDay.low,
      "SELL_SIDE",
      23,
      "PDL"
    );

  }


  if (
    previousWeek
  ) {

    add(
      "Previous Week High",
      previousWeek.high,
      "BUY_SIDE",
      25,
      "PWH"
    );

    add(
      "Previous Week Low",
      previousWeek.low,
      "SELL_SIDE",
      25,
      "PWL"
    );

  }


  if (
    sessions.asia
  ) {

    add(
      "Asia High",
      sessions.asia.high,
      "BUY_SIDE",
      13,
      "SESSION"
    );

    add(
      "Asia Low",
      sessions.asia.low,
      "SELL_SIDE",
      13,
      "SESSION"
    );

  }


  if (
    sessions.london
  ) {

    add(
      "London High",
      sessions.london.high,
      "BUY_SIDE",
      14,
      "SESSION"
    );

    add(
      "London Low",
      sessions.london.low,
      "SELL_SIDE",
      14,
      "SESSION"
    );

  }


  if (
    sessions.newYork
  ) {

    add(
      "New York High",
      sessions.newYork.high,
      "BUY_SIDE",
      14,
      "SESSION"
    );

    add(
      "New York Low",
      sessions.newYork.low,
      "SELL_SIDE",
      14,
      "SESSION"
    );

  }


  for (
    const x of
    equalLevels
      .equalHighs
  ) {

    add(
      "Equal Highs",
      x.price,
      "BUY_SIDE",
      19,
      "EQH"
    );

  }


  for (
    const x of
    equalLevels
      .equalLows
  ) {

    add(
      "Equal Lows",
      x.price,
      "SELL_SIDE",
      19,
      "EQL"
    );

  }


  for (
    const x of
    swings.highs
      .slice(-4)
  ) {

    add(
      "M15 Swing High",
      x.price,
      "BUY_SIDE",
      14,
      "SWING"
    );

  }


  for (
    const x of
    swings.lows
      .slice(-4)
  ) {

    add(
      "M15 Swing Low",
      x.price,
      "SELL_SIDE",
      14,
      "SWING"
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
      16,
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
      16,
      "MAJOR_ROUND"
    );

  }


  for (
    const pool of pools
  ) {

    let proximity = 0;


    if (
      pool.distanceATR <=
      0.25
    ) {

      proximity =
        30;

    } else if (
      pool.distanceATR <=
      0.50
    ) {

      proximity =
        25;

    } else if (
      pool.distanceATR <=
      1.00
    ) {

      proximity =
        18;

    } else if (
      pool.distanceATR <=
      1.50
    ) {

      proximity =
        10;

    }


    pool.score =
      clamp(
        pool.baseWeight +
        proximity,
        0,
        60
      );

  }


  return pools
    .filter(
      p =>
        p.distanceATR === null ||
        p.distanceATR <
        8
    )
    .sort(
      (a, b) =>
        b.score -
        a.score ||
        a.distance -
        b.distance
    );

}


/* ============================================================
   RAID STATE
============================================================ */

function analyzeRaid({
  pool,
  price,
  atrValue,
  m5,
  m15Structure,
  h1Structure,
  h4Structure,
  flow,
  book,
  volume
}) {

  if (!pool) {

    return null;

  }


  const level =
    pool.level;


  const distance =
    price -
    level;


  const absDistance =
    Math.abs(
      distance
    );


  const distanceATR =
    atrValue
      ? absDistance /
        atrValue
      : 999;


  const last =
    m5.at(-1);


  const previous =
    m5.at(-2);


  let score =
    pool.baseWeight;


  const reasons = [];


  /* ---------- proximity ---------- */

  if (
    distanceATR <=
    1.5
  ) {

    score += 10;

    reasons.push(
      "Price is approaching the liquidity level"
    );

  }


  if (
    distanceATR <=
    0.75
  ) {

    score += 8;

    reasons.push(
      "Liquidity target is within 0.75 ATR"
    );

  }


  if (
    distanceATR <=
    0.30
  ) {

    score += 7;

    reasons.push(
      "Price is very close to the liquidity target"
    );

  }


  /* ---------- sweep detection ---------- */

  let swept = false;

  let rejected = false;


  if (
    pool.side ===
    "BUY_SIDE"
  ) {

    if (
      last.high >
      level
    ) {

      swept = true;

      score += 12;

      reasons.push(
        "Buy-side liquidity has been traded through"
      );

    }


    if (
      swept &&
      last.close <
      level
    ) {

      rejected = true;

      score += 13;

      reasons.push(
        "Price closed back below the swept liquidity"
      );

    }


    if (
      flow.deltaPercent <
      -5
    ) {

      score += 7;

      reasons.push(
        "Aggressive trade flow is turning bearish"
      );

    }


    if (
      book.imbalancePercent <
      -5
    ) {

      score += 5;

      reasons.push(
        "Order book is ask-heavy"
      );

    }


    if (
      m15Structure.bias ===
      "BEARISH"
    ) {

      score += 7;

      reasons.push(
        "M15 structure supports downside"
      );

    }


    if (
      h1Structure.bias ===
      "BEARISH"
    ) {

      score += 5;

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
      last.low <
      level
    ) {

      swept = true;

      score += 12;

      reasons.push(
        "Sell-side liquidity has been traded through"
      );

    }


    if (
      swept &&
      last.close >
      level
    ) {

      rejected = true;

      score += 13;

      reasons.push(
        "Price closed back above the swept liquidity"
      );

    }


    if (
      flow.deltaPercent >
      5
    ) {

      score += 7;

      reasons.push(
        "Aggressive trade flow is turning bullish"
      );

    }


    if (
      book.imbalancePercent >
      5
    ) {

      score += 5;

      reasons.push(
        "Order book is bid-heavy"
      );

    }


    if (
      m15Structure.bias ===
      "BULLISH"
    ) {

      score += 7;

      reasons.push(
        "M15 structure supports upside"
      );

    }


    if (
      h1Structure.bias ===
      "BULLISH"
    ) {

      score += 5;

      reasons.push(
        "H1 structure supports upside"
      );

    }

  }


  /* ---------- volume ---------- */

  if (
    volume.state ===
    "HIGH"
  ) {

    score += 4;

    reasons.push(
      "Current M5 volume is elevated"
    );

  }


  /* ---------- H4 penalty ---------- */

  if (
    pool.side ===
      "BUY_SIDE" &&
    h4Structure.bias ===
      "BULLISH"
  ) {

    score -= 5;

  }


  if (
    pool.side ===
      "SELL_SIDE" &&
    h4Structure.bias ===
      "BEARISH"
  ) {

    score -= 5;

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


  /* ---------- overshoot projection ---------- */

  const minOvershoot =
    atrValue *
    SETTINGS
      .SWEEP_MIN_ATR;


  let maxOvershoot =
    atrValue *
    SETTINGS
      .SWEEP_MAX_ATR;


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


  const projectedSweepZone =
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
      round(level),

    livePrice:
      round(price),

    distance:
      round(
        absDistance
      ),

    distanceATR:
      round(
        distanceATR,
        2
      ),

    score:
      round(score),

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
   STRUCTURE BREAK / CHOCH PROXY
============================================================ */

function structureTrigger(
  candles
) {

  if (
    candles.length < 10
  ) {

    return {

      bullish:
        false,

      bearish:
        false

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
        c => c.high
      )
    );


  const previousLow =
    Math.min(
      ...previous.map(
        c => c.low
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
   CANDLE REJECTION
============================================================ */

function candleRejection(
  candle
) {

  const range =
    candle.high -
    candle.low;


  if (
    range <= 0
  ) {

    return {

      bullish:
        false,

      bearish:
        false

    };

  }


  const bodyTop =
    Math.max(
      candle.open,
      candle.close
    );


  const bodyBottom =
    Math.min(
      candle.open,
      candle.close
    );


  const upperWick =
    candle.high -
    bodyTop;


  const lowerWick =
    bodyBottom -
    candle.low;


  return {

    bullish:
      lowerWick /
      range >
      0.40 &&
      candle.close >
      candle.open,

    bearish:
      upperWick /
      range >
      0.40 &&
      candle.close <
      candle.open,

    upperWickPercent:
      round(
        upperWick /
        range *
        100,
        1
      ),

    lowerWickPercent:
      round(
        lowerWick /
        range *
        100,
        1
      )

  };

}


/* ============================================================
   BUY / SELL INTELLIGENCE
============================================================ */

function generateSignal({
  price,
  atrValue,
  raid,
  m5Structure,
  m15Structure,
  h1Structure,
  h4Structure,
  flow,
  book,
  rejection,
  trigger,
  vwap
}) {

  let buyScore = 0;

  let sellScore = 0;


  const buyReasons = [];

  const sellReasons = [];


  /* ---------- structures ---------- */

  if (
    m5Structure.bias ===
    "BULLISH"
  ) {

    buyScore += 8;

    buyReasons.push(
      "M5 bullish"
    );

  }


  if (
    m5Structure.bias ===
    "BEARISH"
  ) {

    sellScore += 8;

    sellReasons.push(
      "M5 bearish"
    );

  }


  if (
    m15Structure.bias ===
    "BULLISH"
  ) {

    buyScore += 13;

    buyReasons.push(
      "M15 bullish"
    );

  }


  if (
    m15Structure.bias ===
    "BEARISH"
  ) {

    sellScore += 13;

    sellReasons.push(
      "M15 bearish"
    );

  }


  if (
    h1Structure.bias ===
    "BULLISH"
  ) {

    buyScore += 12;

    buyReasons.push(
      "H1 bullish"
    );

  }


  if (
    h1Structure.bias ===
    "BEARISH"
  ) {

    sellScore += 12;

    sellReasons.push(
      "H1 bearish"
    );

  }


  if (
    h4Structure.bias ===
    "BULLISH"
  ) {

    buyScore += 8;

    buyReasons.push(
      "H4 bullish"
    );

  }


  if (
    h4Structure.bias ===
    "BEARISH"
  ) {

    sellScore += 8;

    sellReasons.push(
      "H4 bearish"
    );

  }


  /* ---------- VWAP ---------- */

  if (
    vwap
  ) {

    if (
      price >
      vwap
    ) {

      buyScore += 5;

      buyReasons.push(
        "Price above daily VWAP"
      );

    } else {

      sellScore += 5;

      sellReasons.push(
        "Price below daily VWAP"
      );

    }

  }


  /* ---------- delta ---------- */

  if (
    flow.deltaPercent >
    5
  ) {

    buyScore += 9;

    buyReasons.push(
      "Positive aggressive delta"
    );

  }


  if (
    flow.deltaPercent <
    -5
  ) {

    sellScore += 9;

    sellReasons.push(
      "Negative aggressive delta"
    );

  }


  /* ---------- book ---------- */

  if (
    book.imbalancePercent >
    5
  ) {

    buyScore += 6;

    buyReasons.push(
      "Bid-side order-book imbalance"
    );

  }


  if (
    book.imbalancePercent <
    -5
  ) {

    sellScore += 6;

    sellReasons.push(
      "Ask-side order-book imbalance"
    );

  }


  /* ---------- rejection ---------- */

  if (
    rejection.bullish
  ) {

    buyScore += 7;

    buyReasons.push(
      "Bullish rejection candle"
    );

  }


  if (
    rejection.bearish
  ) {

    sellScore += 7;

    sellReasons.push(
      "Bearish rejection candle"
    );

  }


  /* ---------- structure trigger ---------- */

  if (
    trigger.bullish
  ) {

    buyScore += 10;

    buyReasons.push(
      "M5 bullish structure break"
    );

  }


  if (
    trigger.bearish
  ) {

    sellScore += 10;

    sellReasons.push(
      "M5 bearish structure break"
    );

  }


  /* ---------- liquidity raid ---------- */

  if (
    raid?.swept &&
    raid?.rejected
  ) {

    if (
      raid.side ===
      "SELL_SIDE"
    ) {

      buyScore += 22;

      buyReasons.push(
        "Sell-side liquidity sweep rejected"
      );

    }


    if (
      raid.side ===
      "BUY_SIDE"
    ) {

      sellScore += 22;

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


  let signal =
    "WAIT";


  let confidence =
    Math.max(
      buyScore,
      sellScore
    );


  const margin =
    Math.abs(
      buyScore -
      sellScore
    );


  /*
     Reversal trades require a real liquidity sweep.

     Trend continuation can still score,
     but we avoid forcing a trade.
  */


  if (
    buyScore >=
      SETTINGS.SIGNAL_SCORE &&
    buyScore >
      sellScore &&
    margin >=
      SETTINGS.MIN_SIGNAL_MARGIN
  ) {

    signal =
      "BUY";

  }


  if (
    sellScore >=
      SETTINGS.SIGNAL_SCORE &&
    sellScore >
      buyScore &&
    margin >=
      SETTINGS.MIN_SIGNAL_MARGIN
  ) {

    signal =
      "SELL";

  }


  let entry = null;

  let stopLoss = null;

  let takeProfit1 = null;

  let takeProfit2 = null;


  if (
    signal ===
    "BUY"
  ) {

    entry =
      price;


    let candidateStop =
      price -
      atrValue *
      SETTINGS
        .STOP_ATR_BUFFER;


    if (
      raid?.side ===
      "SELL_SIDE"
  ) {

      candidateStop =
        Math.min(
          candidateStop,
          raid.projectedSweepZone.low -
          atrValue *
          0.10
        );

    }


    stopLoss =
      candidateStop;


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


    let candidateStop =
      price +
      atrValue *
      SETTINGS
        .STOP_ATR_BUFFER;


    if (
      raid?.side ===
      "BUY_SIDE"
    ) {

      candidateStop =
        Math.max(
          candidateStop,
          raid.projectedSweepZone.high +
          atrValue *
          0.10
        );

    }


    stopLoss =
      candidateStop;


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
        confidence,
        1
      ),

    scoreGap:
      round(
        margin,
        1
      ),

    entry:
      round(entry),

    stopLoss:
      round(stopLoss),

    takeProfit1:
      round(takeProfit1),

    takeProfit2:
      round(takeProfit2),

    riskReward1:
      signal === "WAIT"
        ? null
        : SETTINGS.TP1_R,

    riskReward2:
      signal === "WAIT"
        ? null
        : SETTINGS.TP2_R,

    buyReasons:
      buyReasons.slice(
        0,
        12
      ),

    sellReasons:
      sellReasons.slice(
        0,
        12
      )

  };

}


/* ============================================================
   MAIN HANDLER
============================================================ */

module.exports =
async function handler(
  req,
  res
) {

  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0"
  );


  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );


  if (
    req.method ===
    "OPTIONS"
  ) {

    res.status(200)
      .end();

    return;

  }


  try {

    const started =
      Date.now();


    /* ========================================================
       FETCH DATA
    ======================================================== */

    const [
      ticker,
      bookRaw,
      trades,
      m5
    ] =
      await Promise.all([

        fetchTicker(),

        fetchBook(),

        fetchTrades(),

        fetchM5History(9)

      ]);


    if (
      !m5 ||
      m5.length < 300
    ) {

      throw new Error(
        "Insufficient Coinbase candle history"
      );

    }


    const price =
      num(
        ticker.price,
        m5.at(-1).close
      );


    /* ========================================================
       TIMEFRAMES
    ======================================================== */

    const m15 =
      resample(
        m5,
        SETTINGS.M15_MINUTES
      );


    const h1 =
      resample(
        m5,
        SETTINGS.H1_MINUTES
      );


    const h4 =
      resample(
        m5,
        SETTINGS.H4_MINUTES
      );


    /* ========================================================
       INDICATORS
    ======================================================== */

    const currentATR =
      atr(
        m5,
        SETTINGS.ATR_PERIOD
      );


    const m5Structure =
      detectStructure(m5);


    const m15Structure =
      detectStructure(m15);


    const h1Structure =
      detectStructure(h1);


    const h4Structure =
      detectStructure(h4);


    /* ========================================================
       IMPORTANT LEVELS
    ======================================================== */

    const pd =
      previousDayLevels(m5);


    const pw =
      previousWeekLevels(m5);


    const sessions =
      sessionLevels(m5);


    const active =
      activeSession();


    const swings =
      findSwings(
        m15,
        2
      );


    const equalLevels =
      findEqualLevels(
        swings,
        currentATR
      );


    const fvgs =
      detectFVGs(m15);


    const roundNumbers =
      roundNumberLiquidity(
        price
      );


    /* ========================================================
       VWAP
    ======================================================== */

    const todayKey =
      dateKeyUTC(
        Date.now()
      );


    const todayBars =
      m5.filter(
        c =>
          dateKeyUTC(
            c.timestamp
          ) ===
          todayKey
      );


    const vwap =
      calculateVWAP(
        todayBars
      );


    /* ========================================================
       VOLUME / FLOW
    ======================================================== */

    const volume =
      volumeAnalysis(m5);


    const flow =
      tradeFlow(trades);


    const book =
      analyzeBook(bookRaw);


    /* ========================================================
       LIQUIDITY
    ======================================================== */

    const pools =
      buildLiquidityPools({

        price,

        atrValue:
          currentATR,

        previousDay:
          pd,

        previousWeek:
          pw,

        sessions,

        equalLevels,

        swings,

        roundNumbers

      });


    /*
       Find most relevant liquidity target.

       Prefer liquidity on the side price is approaching.
    */

    const nearestPools =
      [...pools]
        .sort(
          (a, b) =>
            a.distance -
            b.distance
        );


    const primary =
      nearestPools[0] ||
      pools[0];


    const raid =
      analyzeRaid({

        pool:
          primary,

        price,

        atrValue:
          currentATR,

        m5,

        m15Structure,

        h1Structure,

        h4Structure,

        flow,

        book,

        volume

      });


    /* ========================================================
       REVERSAL CONFIRMATIONS
    ======================================================== */

    const rejection =
      candleRejection(
        m5.at(-1)
      );


    const trigger =
      structureTrigger(m5);


    /* ========================================================
       SIGNAL
    ======================================================== */

    const signal =
      generateSignal({

        price,

        atrValue:
          currentATR,

        raid,

        m5Structure,

        m15Structure,

        h1Structure,

        h4Structure,

        flow,

        book,

        rejection,

        trigger,

        vwap

      });


    /* ========================================================
       VOLATILITY
    ======================================================== */

    const atrPercent =
      price
        ? (
          currentATR /
          price
        ) *
        100
        : 0;


    let volatility =
      "NORMAL";


    if (
      atrPercent >
      0.60
    ) {

      volatility =
        "EXTREME";

    } else if (
      atrPercent >
      0.35
    ) {

      volatility =
        "HIGH";

    } else if (
      atrPercent <
      0.10
    ) {

      volatility =
        "LOW";

    }


    /* ========================================================
       MARKET BIAS
    ======================================================== */

    let macroBias =
      "MIXED";


    const bullishCount =
      [

        m15Structure,
        h1Structure,
        h4Structure

      ].filter(
        x =>
          x.bias ===
          "BULLISH"
      ).length;


    const bearishCount =
      [

        m15Structure,
        h1Structure,
        h4Structure

      ].filter(
        x =>
          x.bias ===
          "BEARISH"
      ).length;


    if (
      bullishCount >= 2
    ) {

      macroBias =
        "BULLISH";

    }


    if (
      bearishCount >= 2
    ) {

      macroBias =
        "BEARISH";

    }


    /* ========================================================
       RESPONSE
    ======================================================== */

    res.status(200)
      .json({

        ok:
          true,

        engine:
          "MKAYFX BTC LIQUIDITY INTELLIGENCE V1",

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


        /* ---------- PRICE ---------- */

        market: {

          price:
            round(price),

          bid:
            book.bestBid,

          ask:
            book.bestAsk,

          spread:
            book.bestAsk &&
            book.bestBid

              ? round(
                book.bestAsk -
                book.bestBid,
                2
              )

              : null,

          change24hPercent:
            ticker.open
              ? round(
                pct(
                  price,
                  num(
                    ticker.open
                  )
                ),
                2
              )
              : null,

          volume24h:
            ticker.volume
              ? round(
                num(
                  ticker.volume
                ),
                4
              )
              : null

        },


        /* ---------- SESSION ---------- */

        session:
          active,


        /* ---------- BIAS ---------- */

        macroBias,


        /* ---------- TIMEFRAMES ---------- */

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


        /* ---------- VOLATILITY ---------- */

        volatility: {

          atr5m:
            round(
              currentATR
            ),

          atrPercent:
            round(
              atrPercent,
              3
            ),

          regime:
            volatility

        },


        /* ---------- VWAP ---------- */

        vwap: {

          daily:
            round(vwap),

          position:
            vwap

              ? (
                price >
                vwap
                  ? "ABOVE"
                  : "BELOW"
              )

              : "UNKNOWN"

        },


        /* ---------- KEY LEVELS ---------- */

        levels: {

          previousDayHigh:
            round(
              pd?.high
            ),

          previousDayLow:
            round(
              pd?.low
            ),

          dailyOpen:
            round(
              pd?.dailyOpen
            ),

          previousWeekHigh:
            round(
              pw?.high
            ),

          previousWeekLow:
            round(
              pw?.low
            ),

          weeklyOpen:
            round(
              pw?.weeklyOpen
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


        /* ---------- SESSIONS ---------- */

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


        /* ---------- FLOW ---------- */

        flow,


        /* ---------- BOOK ---------- */

        orderBook:
          book,


        /* ---------- VOLUME ---------- */

        volume,


        /* ---------- CURRENT RAID ---------- */

        raid,


        /* ---------- SIGNAL ---------- */

        signal,


        /* ---------- CONFIRMATION ---------- */

        confirmation: {

          rejection,

          structureTrigger:
            trigger

        },


        /* ---------- LIQUIDITY POOLS ---------- */

        liquidityPools:
          pools
            .slice(
              0,
              15
            )
            .map(
              p => ({

                name:
                  p.name,

                level:
                  round(
                    p.level
                  ),

                side:
                  p.side,

                type:
                  p.type,

                distance:
                  round(
                    p.distance
                  ),

                distanceATR:
                  round(
                    p.distanceATR,
                    2
                  ),

                score:
                  round(
                    p.score
                  )

              })
            ),


        /* ---------- FVG ---------- */

        fairValueGaps:
          fvgs.map(
            f => ({

              type:
                f.type,

              low:
                round(
                  f.low
                ),

              high:
                round(
                  f.high
                ),

              midpoint:
                round(
                  f.midpoint
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
            h4.length

        }

      });


  } catch (error) {

    console.error(
      "BTC ENGINE ERROR",
      error
    );


    res.status(500)
      .json({

        ok:
          false,

        error:
          error.message,

        timestamp:
          new Date()
            .toISOString()

      });

  }

};