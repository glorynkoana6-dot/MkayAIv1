/* =========================================================
   MKAYFX 5M HTF VOLUME SPIKE + IMBALANCE ENGINE V3
   /api/sr.js

   FOUNDATION
   ----------
   HTF Volume Spike & Imbalance Projection [LuxAlgo]
   © LuxAlgo — CC BY-NC-SA 4.0

   IMPORTANT
   ---------
   This is a custom MKAYFX trading adaptation.

   EXECUTION
   ---------
   5M entries
   1H current context
   1M volume spikes
   3-hour active-zone memory
   3R target
   one hard-locked trade per symbol

   WHY V3 IS LESS RESTRICTIVE
   --------------------------
   - stacked imbalance minimum lowered from 3 spikes to 2
   - qualified zones remain active for 3 hours instead of resetting every hour
   - entry may be a breakout, reclaim, or retest/continuation
   - 1H candle direction is a scoring factor, not a hard blocker
   - current POC and spike pressure add/subtract score
   - best BUY and SELL candidates compete; minimum score decides
========================================================= */

const TWELVE_API_KEY = process.env.TWELVE_DATA_API_KEY;

const TWELVE_BASE = "https://api.twelvedata.com";
const COINBASE_BASE = "https://api.exchange.coinbase.com";
const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

const MARKETS = {
  "XAU/USD": { name: "GOLD", short: "XAU", digits: 2 },
  "BTC/USD": { name: "BITCOIN", short: "BTC", digits: 2 }
};


/* =========================================================
   SETTINGS
========================================================= */

const EXECUTION_MINUTES = 5;
const HTF_MINUTES = 60;

const VOLUME_MA_LENGTH = 20;
const SPIKE_MULTIPLIER = 1.2;
const VP_ROWS = 40;


/*
   OLD = 3
   NEW = 2

   This lets imbalance zones form more often.
*/
const MIN_STACKED_SPIKES = 2;


/*
   Current hour + previous 2 hourly anchors.
*/
const ZONE_LOOKBACK_HOURS = 3;


/*
   Instead of requiring every condition perfectly,
   candidates receive a score.
*/
const MIN_SIGNAL_SCORE = 55;


/*
   If BUY and SELL are both strong,
   one must beat the other by at least this much.
*/
const MIN_SCORE_GAP = 5;


const RISK_REWARD = 3;


/*
   History sizes.
*/
const XAU_OUTPUT_SIZE = 1800;

const COINBASE_TARGET_BARS = 1440;
const COINBASE_CHUNK_BARS = 288;


const RECENT_SIGNAL_LIMIT = 40;
const RECENT_BACKTEST_LIMIT = 60;


/*
   Old was 20 5M states.
   Slightly shorter warmup gives the backtester
   more usable test states.
*/
const BACKTEST_WARMUP_STATES = 12;


/* =========================================================
   BASIC HELPERS
========================================================= */

function num(value) {

  const x =
    Number(value);


  return Number.isFinite(x)
    ? x
    : null;

}


function round(
  value,
  digits = 2
) {

  const x =
    num(value);


  return x === null
    ? null
    : Number(
        x.toFixed(digits)
      );

}


function safeError(value) {

  if (value == null) {
    return "";
  }


  if (typeof value === "string") {
    return value;
  }


  if (value instanceof Error) {

    return (
      value.message ||
      String(value)
    );

  }


  if (typeof value === "object") {

    if (typeof value.message === "string") {
      return value.message;
    }


    if (typeof value.error === "string") {
      return value.error;
    }


    try {

      return JSON.stringify(
        value
      );

    } catch {}

  }


  return String(value);

}


/* =========================================================
   TIME
========================================================= */

function parseTime(value) {

  if (!value) {
    return NaN;
  }


  const text =
    String(value)
      .trim()
      .replace(
        " ",
        "T"
      );


  return new Date(

    /Z$|[+-]\d\d:\d\d$/.test(text)
      ? text
      : `${text}Z`

  ).getTime();

}


function iso(ms) {

  return new Date(ms)
    .toISOString();

}


function bucketStart(
  ts,
  minutes
) {

  const size =
    minutes *
    60_000;


  return Math.floor(
    ts /
    size
  )
  *
  size;

}


function minutesOld(value) {

  const ts =
    parseTime(value);


  if (!Number.isFinite(ts)) {
    return null;
  }


  return Math.max(

    0,

    (
      Date.now() -
      ts
    )

    /

    60_000

  );

}


/* =========================================================
   SYMBOL
========================================================= */

function normalizeSymbol(value) {

  const raw =
    String(
      value ||
      "XAU/USD"
    )
      .trim()
      .toUpperCase();


  const aliases = {

    XAUUSD:
      "XAU/USD",

    XAU:
      "XAU/USD",

    GOLD:
      "XAU/USD",

    BTCUSD:
      "BTC/USD",

    BTC:
      "BTC/USD",

    BITCOIN:
      "BTC/USD"

  };


  const symbol =
    aliases[raw] ||
    raw;


  return MARKETS[symbol]
    ? symbol
    : "XAU/USD";

}


/* =========================================================
   HTTP
========================================================= */

async function getJSON(
  url,
  options = {},
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

          ...options,

          signal:
            controller.signal,

          headers: {

            Accept:
              "application/json",

            "User-Agent":
              "MKAYFX/1.0",

            ...(
              options.headers ||
              {}
            )

          }

        }

      );


    const raw =
      await response.text();


    let data =
      null;


    try {

      data =
        raw
          ? JSON.parse(raw)
          : null;

    } catch {

      throw new Error(

        `Non-JSON response HTTP ${response.status}: ${raw.slice(0,250)}`

      );

    }


    if (!response.ok) {

      throw new Error(

        safeError(
          data?.message
        )

        ||

        safeError(
          data?.error
        )

        ||

        `HTTP ${response.status}`

      );

    }


    return data;

  } catch (error) {

    if (
      error?.name ===
      "AbortError"
    ) {

      throw new Error(
        "Market-data request timed out."
      );

    }


    throw error;

  } finally {

    clearTimeout(
      timer
    );

  }

}


/* =========================================================
   XAU/USD SPOT PRICE — TWELVE DATA
========================================================= */

async function fetchXauSpot1m() {

  if (!TWELVE_API_KEY) {

    throw new Error(

      "TWELVE_DATA_API_KEY is missing in Vercel Environment Variables."

    );

  }


  const query =
    new URLSearchParams({

      symbol:
        "XAU/USD",

      interval:
        "1min",

      outputsize:
        String(
          XAU_OUTPUT_SIZE
        ),

      timezone:
        "UTC",

      format:
        "JSON",

      apikey:
        TWELVE_API_KEY

    });


  const data =
    await getJSON(

      `${TWELVE_BASE}/time_series?${query.toString()}`

    );


  if (
    data?.status ===
    "error"
  ) {

    throw new Error(

      data.message ||
      "Twelve Data XAU/USD error."

    );

  }


  if (
    !Array.isArray(
      data?.values
    )
  ) {

    throw new Error(

      "Twelve Data returned no XAU/USD 1M candles."

    );

  }


  const bars =

    data.values

      .map(
        value => ({

          time:
            String(
              value.datetime ||
              ""
            ),

          timestamp:
            parseTime(
              value.datetime
            ),

          open:
            Number(
              value.open
            ),

          high:
            Number(
              value.high
            ),

          low:
            Number(
              value.low
            ),

          close:
            Number(
              value.close
            ),

          volume:
            null

        })
      )

      .filter(
        bar =>

          Number.isFinite(
            bar.timestamp
          )

          &&

          [
            bar.open,
            bar.high,
            bar.low,
            bar.close
          ]
            .every(
              Number.isFinite
            )
      )

      .sort(
        (
          a,
          b
        ) =>

          a.timestamp -
          b.timestamp
      );


  if (
    bars.length <
    200
  ) {

    throw new Error(

      "Not enough XAU/USD 1M price history."

    );

  }


  return bars;

}


/* =========================================================
   GOLD FUTURES VOLUME PROXY — YAHOO GC=F
========================================================= */

async function fetchGoldFuturesVolume1m() {

  const symbol =
    encodeURIComponent(
      "GC=F"
    );


  const url =

    `${YAHOO_BASE}/${symbol}`

    +

    `?interval=1m&range=5d&includePrePost=true&events=div%2Csplits`;


  const data =
    await getJSON(

      url,

      {

        headers: {

          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1"

        }

      }

    );


  const result =
    data
      ?.chart
      ?.result
      ?.[0];


  const timestamps =
    result
      ?.timestamp;


  const quote =
    result
      ?.indicators
      ?.quote
      ?.[0];


  if (
    !Array.isArray(
      timestamps
    )

    ||

    !quote
  ) {

    throw new Error(

      "Gold futures proxy GC=F returned no usable 1M data."

    );

  }


  const bars =
    [];


  for (
    let i = 0;

    i <
    timestamps.length;

    i++
  ) {

    const timestamp =
      Number(
        timestamps[i]
      )
      *
      1000;


    const volume =
      Number(
        quote.volume?.[i]
      );


    if (
      Number.isFinite(
        timestamp
      )

      &&

      Number.isFinite(
        volume
      )

      &&

      volume >=
      0
    ) {

      bars.push({

        timestamp,

        time:
          iso(
            timestamp
          ),

        volume

      });

    }

  }


  bars.sort(
    (
      a,
      b
    ) =>
      a.timestamp -
      b.timestamp
  );


  if (
    bars.length <
    100
  ) {

    throw new Error(

      "GC=F 1M volume proxy is too sparse."

    );

  }


  return bars;

}


/* =========================================================
   BTC/USD — COINBASE REAL EXCHANGE VOLUME
========================================================= */

async function fetchCoinbaseChunk(
  startMs,
  endMs
) {

  const query =
    new URLSearchParams({

      granularity:
        "60",

      start:
        iso(
          startMs
        ),

      end:
        iso(
          endMs
        )

    });


  const data =
    await getJSON(

      `${COINBASE_BASE}/products/BTC-USD/candles?${query.toString()}`

    );


  if (
    !Array.isArray(
      data
    )
  ) {

    throw new Error(

      "Coinbase BTC-USD candle response was invalid."

    );

  }


  return data

    .map(
      row => {

        const timestamp =
          Number(
            row?.[0]
          )
          *
          1000;


        return {

          timestamp,

          time:

            Number.isFinite(
              timestamp
            )

              ? iso(
                  timestamp
                )

              : "",

          low:
            Number(
              row?.[1]
            ),

          high:
            Number(
              row?.[2]
            ),

          open:
            Number(
              row?.[3]
            ),

          close:
            Number(
              row?.[4]
            ),

          volume:
            Number(
              row?.[5]
            )

        };

      }
    )

    .filter(
      bar =>

        Number.isFinite(
          bar.timestamp
        )

        &&

        [
          bar.open,
          bar.high,
          bar.low,
          bar.close,
          bar.volume
        ]
          .every(
            Number.isFinite
          )
    );

}


async function fetchBtcCoinbase1m() {

  const end =
    bucketStart(
      Date.now(),
      1
    );


  const chunks =
    Math.ceil(

      COINBASE_TARGET_BARS

      /

      COINBASE_CHUNK_BARS

    );


  const all =
    [];


  for (
    let i = 0;

    i <
    chunks;

    i++
  ) {

    const chunkEnd =

      end

      -

      i
      *
      COINBASE_CHUNK_BARS
      *
      60_000;


    const chunkStart =

      chunkEnd

      -

      COINBASE_CHUNK_BARS
      *
      60_000;


    const rows =
      await fetchCoinbaseChunk(

        chunkStart,

        chunkEnd

      );


    all.push(
      ...rows
    );

  }


  const map =
    new Map();


  for (
    const bar
    of all
  ) {

    const minute =
      bucketStart(
        bar.timestamp,
        1
      );


    map.set(

      minute,

      {

        ...bar,

        timestamp:
          minute,

        time:
          iso(
            minute
          )

      }

    );

  }


  const bars =

    [
      ...map.values()
    ]

      .sort(
        (
          a,
          b
        ) =>

          a.timestamp -
          b.timestamp
      )

      .slice(
        -COINBASE_TARGET_BARS
      );


  if (
    bars.length <
    200
  ) {

    throw new Error(

      "Coinbase returned too little BTC-USD 1M history."

    );

  }


  return bars;

}


/* =========================================================
   ALIGN GOLD FUTURES VOLUME TO XAU SPOT
========================================================= */

function attachProxyVolume(
  priceBars,
  proxyBars
) {

  const volumeMap =
    new Map();


  for (
    const proxy
    of proxyBars
  ) {

    const minute =
      bucketStart(
        proxy.timestamp,
        1
      );


    volumeMap.set(

      minute,

      proxy.volume

    );

  }


  return priceBars.map(
    bar => ({

      ...bar,

      volume:

        volumeMap.get(

          bucketStart(
            bar.timestamp,
            1
          )

        )

        ??

        null

    })
  );

}


/* =========================================================
   COMPLETED 1M
========================================================= */

function completedOneMinuteBars(
  bars
) {

  const now =
    Date.now();


  return bars.filter(

    bar =>

      bar.timestamp +
      60_000 <=
      now

  );

}


/* =========================================================
   VOLUME SMA + SPIKES
========================================================= */

function addVolumeSpikeStats(
  bars
) {

  const output =
    [];


  const window =
    [];


  let sum =
    0;


  let usable =
    0;


  for (
    let i = 0;

    i <
    bars.length;

    i++
  ) {

    const volume =

      Number.isFinite(
        bars[i].volume
      )

      &&

      bars[i].volume >=
      0

        ? Number(
            bars[i].volume
          )

        : null;


    if (
      volume !==
      null
    ) {

      usable++;

    }


    window.push(
      volume
    );


    if (
      volume !==
      null
    ) {

      sum +=
        volume;

    }


    if (
      window.length >
      VOLUME_MA_LENGTH
    ) {

      const removed =
        window.shift();


      if (
        removed !==
        null
      ) {

        sum -=
          removed;

      }

    }


    const completeWindow =

      window.length ===
      VOLUME_MA_LENGTH

      &&

      window.every(
        item =>
          item !==
          null
      );


    const volumeMA =

      completeWindow

        ? sum /
          VOLUME_MA_LENGTH

        : null;


    const isSpike =

      volume !==
      null

      &&

      volumeMA !==
      null

      &&

      volumeMA >
      0

      &&

      volume >
      volumeMA *
      SPIKE_MULTIPLIER;


    output.push({

      ...bars[i],

      volume,

      volumeMA,

      isSpike,

      delta:

        bars[i].close >=
        bars[i].open

          ? 1

          : -1

    });

  }


  return {

    bars:
      output,

    usableVolumeBars:
      usable,

    volumeAvailable:

      usable >=
      VOLUME_MA_LENGTH *
      2

  };

}


/* =========================================================
   RESAMPLE 1M -> 5M
========================================================= */

function resamplePrice(
  bars,
  minutes
) {

  const map =
    new Map();


  const size =
    minutes *
    60_000;


  for (
    const bar
    of bars
  ) {

    const start =
      bucketStart(
        bar.timestamp,
        minutes
      );


    let group =
      map.get(
        start
      );


    if (
      !group
    ) {

      group = {

        timestamp:
          start,

        time:
          iso(
            start
          ),

        closeTimestamp:
          start +
          size,

        closeTime:
          iso(
            start +
            size
          ),

        open:
          bar.open,

        high:
          bar.high,

        low:
          bar.low,

        close:
          bar.close

      };


      map.set(
        start,
        group
      );

    } else {

      group.high =
        Math.max(
          group.high,
          bar.high
        );


      group.low =
        Math.min(
          group.low,
          bar.low
        );


      group.close =
        bar.close;

    }

  }


  return [
    ...map.values()
  ]
    .sort(
      (
        a,
        b
      ) =>
        a.timestamp -
        b.timestamp
    );

}


/* =========================================================
   BUILD ONE HOURLY ANCHOR
========================================================= */

function buildAnchor(
  oneMinuteBars,
  stateCloseTimestamp
) {

  const htfStart =
    bucketStart(

      stateCloseTimestamp -
      1,

      HTF_MINUTES

    );


  const anchorBars =

    oneMinuteBars.filter(

      bar =>

        bar.timestamp >=
        htfStart

        &&

        bar.timestamp <
        stateCloseTimestamp

    );


  if (
    !anchorBars.length
  ) {

    return null;

  }


  const open =
    anchorBars[0].open;


  let high =
    -Infinity;


  let low =
    Infinity;


  let close =
    anchorBars.at(-1).close;


  for (
    const bar
    of anchorBars
  ) {

    high =
      Math.max(
        high,
        bar.high
      );


    low =
      Math.min(
        low,
        bar.low
      );


    close =
      bar.close;

  }


  const spikes =

    anchorBars

      .filter(
        bar =>
          bar.isSpike
      )

      .map(
        bar => ({

          time:
            bar.time,

          timestamp:
            bar.timestamp,

          price:
            bar.close,

          volume:
            bar.volume,

          volumeMA:
            bar.volumeMA,

          delta:
            bar.delta

        })
      );


  const bullSpikes =

    spikes.filter(
      spike =>
        spike.delta >
        0
    ).length;


  const bearSpikes =

    spikes.filter(
      spike =>
        spike.delta <
        0
    ).length;


  const zones =
    [];


  const profile =
    [];


  let poc =
    null;


  if (
    high >
    low
  ) {

    const step =

      (
        high -
        low
      )

      /

      VP_ROWS;


    const bins =

      Array.from(

        {
          length:
            VP_ROWS
        },

        (
          _,
          index
        ) => ({

          index,

          low:

            low

            +

            index *
            step,

          high:

            low

            +

            (
              index +
              1
            )

            *
            step,

          bullCount:
            0,

          bearCount:
            0,

          volume:
            0

        })

      );


    /* VOLUME PROFILE */

    for (
      const bar
      of anchorBars
    ) {

      let index =
        Math.floor(

          (
            bar.close -
            low
          )

          /

          step

        );


      index =
        Math.max(

          0,

          Math.min(

            VP_ROWS -
            1,

            index

          )

        );


      if (
        Number.isFinite(
          bar.volume
        )

        &&

        bar.volume >=
        0
      ) {

        bins[index].volume +=
          bar.volume;

      }

    }


    /* SPIKES INTO ROWS */

    for (
      const spike
      of spikes
    ) {

      let index =
        Math.floor(

          (
            spike.price -
            low
          )

          /

          step

        );


      index =
        Math.max(

          0,

          Math.min(

            VP_ROWS -
            1,

            index

          )

        );


      if (
        spike.delta >
        0
      ) {

        bins[index]
          .bullCount++;

      } else {

        bins[index]
          .bearCount++;

      }

    }


    let maxProfileVolume =
      0;


    for (
      const bin
      of bins
    ) {

      if (
        bin.volume >
        maxProfileVolume
      ) {

        maxProfileVolume =
          bin.volume;


        poc =

          (
            bin.low +
            bin.high
          )

          /

          2;

      }


      /*
         V3:
         only 2 same-side spikes needed.
      */

      const bullish =

        bin.bullCount >=
        MIN_STACKED_SPIKES

        &&

        bin.bullCount >
        bin.bearCount;


      const bearish =

        bin.bearCount >=
        MIN_STACKED_SPIKES

        &&

        bin.bearCount >
        bin.bullCount;


      if (
        bullish ||
        bearish
      ) {

        zones.push({

          low:
            bin.low,

          high:
            bin.high,

          bullCount:
            bin.bullCount,

          bearCount:
            bin.bearCount,

          direction:

            bullish

              ? "BULLISH"

              : "BEARISH",

          strength:

            bullish

              ? bin.bullCount -
                bin.bearCount

              : bin.bearCount -
                bin.bullCount

        });

      }

    }


    for (
      const bin
      of bins
    ) {

      profile.push({

        low:
          bin.low,

        high:
          bin.high,

        volume:
          bin.volume,

        relative:

          maxProfileVolume >
          0

            ? bin.volume /
              maxProfileVolume

            : 0

      });

    }

  }


  return {

    startTime:
      iso(
        htfStart
      ),

    endTime:
      iso(
        stateCloseTimestamp
      ),

    open,

    high,

    low,

    close,

    bullSpikes,

    bearSpikes,

    totalSpikes:
      spikes.length,

    dominance:

      bullSpikes >
      bearSpikes

        ? "BULLISH"

        : bearSpikes >
          bullSpikes

          ? "BEARISH"

          : "BALANCED",

    spikes,

    zones,

    profile,

    poc

  };

}


/* =========================================================
   ACTIVE ZONES

   V3 DIFFERENCE:
   Zones do not disappear immediately at the new hour.

   ageHours:
   0 = current hour
   1 = previous hour
   2 = two hours ago
========================================================= */

function activeZonesForState(
  oneMinuteBars,
  stateCloseTimestamp,
  currentAnchor
) {

  const zones =
    [];


  if (
    !currentAnchor
  ) {

    return zones;

  }


  const currentHourStart =
    bucketStart(

      stateCloseTimestamp -
      1,

      HTF_MINUTES

    );


  /*
     CURRENT PARTIAL HOUR
  */

  for (
    const zone
    of currentAnchor.zones
  ) {

    zones.push({

      ...zone,

      ageHours:
        0,

      sourceStartTime:
        currentAnchor.startTime,

      sourceEndTime:
        currentAnchor.endTime

    });

  }


  /*
     PREVIOUS COMPLETED HOURS
  */

  for (
    let age = 1;

    age <
    ZONE_LOOKBACK_HOURS;

    age++
  ) {

    const boundary =

      currentHourStart

      -

      (
        age -
        1
      )

      *
      HTF_MINUTES
      *
      60_000;


    const historicalAnchor =
      buildAnchor(

        oneMinuteBars,

        boundary

      );


    if (
      !historicalAnchor
    ) {

      continue;

    }


    for (
      const zone
      of historicalAnchor.zones
    ) {

      zones.push({

        ...zone,

        ageHours:
          age,

        sourceStartTime:
          historicalAnchor.startTime,

        sourceEndTime:
          historicalAnchor.endTime

      });

    }

  }


  /*
     STRONGER + NEWER ZONES FIRST
  */

  zones.sort(

    (
      a,
      b
    ) =>

      b.strength -
      a.strength

      ||

      a.ageHours -
      b.ageHours

  );


  return zones;

}


/* =========================================================
   BUILD STRATEGY CONTEXT
========================================================= */

function buildStrategyAnchor(
  oneMinuteBars,
  stateCloseTimestamp
) {

  const currentAnchor =
    buildAnchor(

      oneMinuteBars,

      stateCloseTimestamp

    );


  if (
    !currentAnchor
  ) {

    return null;

  }


  const activeZones =
    activeZonesForState(

      oneMinuteBars,

      stateCloseTimestamp,

      currentAnchor

    );


  const strongestBullish =

    activeZones

      .filter(
        zone =>
          zone.direction ===
          "BULLISH"
      )

      .sort(
        (
          a,
          b
        ) =>

          b.strength -
          a.strength

          ||

          a.ageHours -
          b.ageHours
      )[0]

    ||

    null;


  const strongestBearish =

    activeZones

      .filter(
        zone =>
          zone.direction ===
          "BEARISH"
      )

      .sort(
        (
          a,
          b
        ) =>

          b.strength -
          a.strength

          ||

          a.ageHours -
          b.ageHours
      )[0]

    ||

    null;


  return {

    ...currentAnchor,

    /*
       OHLC / pressure / profile remain current 1H.

       Only zones are carried forward.
    */

    zones:
      activeZones,

    strongestBullish,

    strongestBearish,

    zoneLookbackHours:
      ZONE_LOOKBACK_HOURS

  };

}


/* =========================================================
   CANDIDATE SCORE

   This is the main strategy change.

   We no longer require EVERY rule to be perfect.

   A candidate can trigger via:

   1. BREAKOUT
   2. RECLAIM
   3. RETEST / CONTINUATION
========================================================= */

function evaluateCandidate(
  direction,
  zone,
  previousBar,
  currentBar,
  anchor
) {

  if (
    !zone

    ||

    !previousBar

    ||

    !currentBar

    ||

    !anchor
  ) {

    return null;

  }


  const zoneLow =
    Number(
      zone.low
    );


  const zoneHigh =
    Number(
      zone.high
    );


  if (
    !Number.isFinite(
      zoneLow
    )

    ||

    !Number.isFinite(
      zoneHigh
    )

    ||

    zoneHigh <=
    zoneLow
  ) {

    return null;

  }


  const previousClose =
    Number(
      previousBar.close
    );


  const currentOpen =
    Number(
      currentBar.open
    );


  const currentHigh =
    Number(
      currentBar.high
    );


  const currentLow =
    Number(
      currentBar.low
    );


  const currentClose =
    Number(
      currentBar.close
    );


  if (
    ![
      previousClose,
      currentOpen,
      currentHigh,
      currentLow,
      currentClose
    ]
      .every(
        Number.isFinite
      )
  ) {

    return null;

  }


  const zoneWidth =

    Math.max(

      zoneHigh -
      zoneLow,

      1e-9

    );


  const anchorRange =

    Math.max(

      Number(
        anchor.high
      )

      -

      Number(
        anchor.low
      ),

      zoneWidth

    );


  const midpoint =

    (
      zoneLow +
      zoneHigh
    )

    /

    2;


  /*
     Price doesn't need to touch the zone
     to one exact decimal.
  */

  const touchTolerance =

    Math.max(

      zoneWidth *
      0.4,

      anchorRange *
      0.01

    );


  /*
     Do not chase a breakout miles away
     from the source zone.
  */

  const maxChase =

    Math.max(

      zoneWidth *
      2.75,

      anchorRange *
      0.15

    );


  let trigger =
    null;


  /* =======================================================
     BUY INTERACTIONS
  ======================================================= */

  if (
    direction ===
    "BUY"
  ) {

    /*
       Classic breakout.
    */

    const breakout =

      previousClose <=
      zoneHigh +
      touchTolerance

      &&

      currentClose >
      zoneHigh

      &&

      currentClose -
      zoneHigh <=
      maxChase;


    /*
       Candle trades into the zone,
       then closes back through its midpoint.

       This catches bullish rejection/reclaim setups
       that the old engine completely ignored.
    */

    const reclaim =

      currentLow <=
      zoneHigh +
      touchTolerance

      &&

      currentClose >
      midpoint

      &&

      currentClose >
      currentOpen

      &&

      currentClose -
      zoneHigh <=
      maxChase;


    /*
       Price was already above the zone,
       retests it, and closes bullish again.
    */

    const continuation =

      previousClose >
      zoneHigh

      &&

      currentLow <=
      zoneHigh +
      touchTolerance

      &&

      currentClose >
      zoneHigh

      &&

      currentClose >
      currentOpen;


    if (
      breakout
    ) {

      trigger =
        "BREAKOUT";

    } else if (
      reclaim
    ) {

      trigger =
        "RECLAIM";

    } else if (
      continuation
    ) {

      trigger =
        "RETEST";

    }

  }


  /* =======================================================
     SELL INTERACTIONS
  ======================================================= */

  else {

    const breakout =

      previousClose >=
      zoneLow -
      touchTolerance

      &&

      currentClose <
      zoneLow

      &&

      zoneLow -
      currentClose <=
      maxChase;


    const reclaim =

      currentHigh >=
      zoneLow -
      touchTolerance

      &&

      currentClose <
      midpoint

      &&

      currentClose <
      currentOpen

      &&

      zoneLow -
      currentClose <=
      maxChase;


    const continuation =

      previousClose <
      zoneLow

      &&

      currentHigh >=
      zoneLow -
      touchTolerance

      &&

      currentClose <
      zoneLow

      &&

      currentClose <
      currentOpen;


    if (
      breakout
    ) {

      trigger =
        "BREAKOUT";

    } else if (
      reclaim
    ) {

      trigger =
        "RECLAIM";

    } else if (
      continuation
    ) {

      trigger =
        "RETEST";

    }

  }


  if (
    !trigger
  ) {

    return null;

  }


  /* =======================================================
     SCORE
  ======================================================= */

  let score =
    30;


  /*
     Trigger quality
  */

  if (
    trigger ===
    "BREAKOUT"
  ) {

    score +=
      14;

  } else if (
    trigger ===
    "RECLAIM"
  ) {

    score +=
      12;

  } else {

    score +=
      10;

  }


  /*
     Zone strength
  */

  score +=

    Math.min(

      20,

      Number(
        zone.strength ||
        0
      )

      *
      8

    );


  /*
     Same-side spike count
  */

  const sameSideCount =

    direction ===
    "BUY"

      ? Number(
          zone.bullCount ||
          0
        )

      : Number(
          zone.bearCount ||
          0
        );


  score +=

    Math.min(

      10,

      sameSideCount *
      2

    );


  const bullSpikes =
    Number(
      anchor.bullSpikes ||
      0
    );


  const bearSpikes =
    Number(
      anchor.bearSpikes ||
      0
    );


  /* =======================================================
     BUY SCORE
  ======================================================= */

  if (
    direction ===
    "BUY"
  ) {

    if (
      bullSpikes >
      bearSpikes
    ) {

      score +=
        10;

    } else if (
      bullSpikes ===
      bearSpikes
    ) {

      score +=
        5;

    } else {

      /*
         Opposite pressure does NOT block the trade.
         It only reduces the score.
      */

      score -=
        5;

    }


    if (
      currentClose >
      currentOpen
    ) {

      score +=
        8;

    }


    if (
      Number.isFinite(
        anchor.poc
      )

      &&

      currentClose >=
      anchor.poc
    ) {

      score +=
        6;

    }

  }


  /* =======================================================
     SELL SCORE
  ======================================================= */

  else {

    if (
      bearSpikes >
      bullSpikes
    ) {

      score +=
        10;

    } else if (
      bullSpikes ===
      bearSpikes
    ) {

      score +=
        5;

    } else {

      score -=
        5;

    }


    if (
      currentClose <
      currentOpen
    ) {

      score +=
        8;

    }


    if (
      Number.isFinite(
        anchor.poc
      )

      &&

      currentClose <=
      anchor.poc
    ) {

      score +=
        6;

    }

  }


  /*
     Newer zones score slightly higher,
     but old zones are still tradable.
  */

  const ageHours =
    Number(
      zone.ageHours ||
      0
    );


  if (
    ageHours ===
    0
  ) {

    score +=
      8;

  } else if (
    ageHours ===
    1
  ) {

    score +=
      5;

  } else if (
    ageHours ===
    2
  ) {

    score +=
      3;

  }


  return {

    direction,

    zone,

    trigger,

    score:
      Math.round(
        score
      )

  };

}


/* =========================================================
   ENTRY SIGNAL V3
========================================================= */

function selectSignal(
  previousBar,
  currentBar,
  anchor
) {

  if (
    !anchor

    ||

    !previousBar

    ||

    !currentBar
  ) {

    return null;

  }


  const buyCandidates =

    anchor.zones

      .filter(
        zone =>
          zone.direction ===
          "BULLISH"
      )

      .map(
        zone =>
          evaluateCandidate(

            "BUY",

            zone,

            previousBar,

            currentBar,

            anchor

          )
      )

      .filter(
        Boolean
      )

      .sort(
        (
          a,
          b
        ) =>

          b.score -
          a.score

          ||

          b.zone.strength -
          a.zone.strength
      );


  const sellCandidates =

    anchor.zones

      .filter(
        zone =>
          zone.direction ===
          "BEARISH"
      )

      .map(
        zone =>
          evaluateCandidate(

            "SELL",

            zone,

            previousBar,

            currentBar,

            anchor

          )
      )

      .filter(
        Boolean
      )

      .sort(
        (
          a,
          b
        ) =>

          b.score -
          a.score

          ||

          b.zone.strength -
          a.zone.strength
      );


  const bestBuy =
    buyCandidates[0]
    ||
    null;


  const bestSell =
    sellCandidates[0]
    ||
    null;


  const buyQualified =

    bestBuy

    &&

    bestBuy.score >=
    MIN_SIGNAL_SCORE;


  const sellQualified =

    bestSell

    &&

    bestSell.score >=
    MIN_SIGNAL_SCORE;


  /*
     BUY ONLY
  */

  if (
    buyQualified

    &&

    !sellQualified
  ) {

    return {

      signal:
        "BUY",

      zone:
        bestBuy.zone,

      trigger:
        bestBuy.trigger,

      score:
        bestBuy.score

    };

  }


  /*
     SELL ONLY
  */

  if (
    sellQualified

    &&

    !buyQualified
  ) {

    return {

      signal:
        "SELL",

      zone:
        bestSell.zone,

      trigger:
        bestSell.trigger,

      score:
        bestSell.score

    };

  }


  /*
     BOTH SIDES VALID
  */

  if (
    buyQualified

    &&

    sellQualified
  ) {

    const difference =

      Math.abs(

        bestBuy.score -
        bestSell.score

      );


    /*
       If they're basically tied,
       do nothing.
    */

    if (
      difference <
      MIN_SCORE_GAP
    ) {

      return null;

    }


    if (
      bestBuy.score >
      bestSell.score
    ) {

      return {

        signal:
          "BUY",

        zone:
          bestBuy.zone,

        trigger:
          bestBuy.trigger,

        score:
          bestBuy.score

      };

    }


    return {

      signal:
        "SELL",

      zone:
        bestSell.zone,

      trigger:
        bestSell.trigger,

      score:
        bestSell.score

    };

  }


  return null;

}


/* =========================================================
   TRADE PLAN
========================================================= */

function buildTradePlan(
  signal,
  entry,
  zone
) {

  if (
    !zone

    ||

    (
      signal !==
      "BUY"

      &&

      signal !==
      "SELL"
    )
  ) {

    return {

      valid:
        false,

      entry:
        null,

      stopLoss:
        null,

      takeProfit:
        null,

      risk:
        null,

      rr:
        RISK_REWARD

    };

  }


  /*
     Same risk structure as before.
  */

  const stopLoss =

    signal ===
    "BUY"

      ? zone.low

      : zone.high;


  const risk =

    signal ===
    "BUY"

      ? entry -
        stopLoss

      : stopLoss -
        entry;


  if (
    !Number.isFinite(
      risk
    )

    ||

    risk <=
    0
  ) {

    return {

      valid:
        false,

      entry:
        null,

      stopLoss:
        null,

      takeProfit:
        null,

      risk:
        null,

      rr:
        RISK_REWARD

    };

  }


  const takeProfit =

    signal ===
    "BUY"

      ? entry +
        risk *
        RISK_REWARD

      : entry -
        risk *
        RISK_REWARD;


  return {

    valid:
      true,

    entry,

    stopLoss,

    takeProfit,

    risk,

    rr:
      RISK_REWARD

  };

}


/* =========================================================
   BUILD 5M STATES
========================================================= */

function buildStates(
  oneMinuteBars,
  fiveMinuteBars
) {

  const states =
    [];


  for (
    let i = 0;

    i <
    fiveMinuteBars.length;

    i++
  ) {

    const bar =
      fiveMinuteBars[i];


    const anchor =
      buildStrategyAnchor(

        oneMinuteBars,

        bar.closeTimestamp

      );


    const previousBar =

      i >
      0

        ? fiveMinuteBars[
            i -
            1
          ]

        : null;


    const selection =
      selectSignal(

        previousBar,

        bar,

        anchor

      );


    let signal =
      selection?.signal ||
      "WAIT";


    let zone =
      selection?.zone ||
      null;


    let trigger =
      selection?.trigger ||
      null;


    let score =
      selection?.score ||
      0;


    let plan =
      buildTradePlan(

        signal,

        bar.close,

        zone

      );


    if (
      !plan.valid
    ) {

      signal =
        "WAIT";


      zone =
        null;


      trigger =
        null;


      score =
        0;


      plan =
        buildTradePlan(

          "WAIT",

          bar.close,

          null

        );

    }


    states.push({

      ...bar,

      previousClose:

        previousBar?.close
        ??
        null,

      anchor,

      signal,

      zone,

      trigger,

      score,

      ...plan

    });

  }


  return states;

}


/* =========================================================
   TRADE SIMULATION
========================================================= */

function simulateTrade(
  oneMinuteBars,
  state
) {

  let result =
    "OPEN";


  let resultR =
    null;


  let exitPrice =
    null;


  let exitTime =
    null;


  let exitTimestamp =
    null;


  for (
    const bar
    of oneMinuteBars
  ) {

    if (
      bar.timestamp <
      state.closeTimestamp
    ) {

      continue;

    }


    if (
      state.signal ===
      "BUY"
    ) {

      const stopHit =

        bar.low <=
        state.stopLoss;


      const targetHit =

        bar.high >=
        state.takeProfit;


      /*
         Conservative backtest:
         both hit in same 1M bar = LOSS first.
      */

      if (
        stopHit
      ) {

        result =
          "LOSS";


        resultR =
          -1;


        exitPrice =
          state.stopLoss;


        exitTime =
          bar.time;


        exitTimestamp =
          bar.timestamp;


        break;

      }


      if (
        targetHit
      ) {

        result =
          "WIN";


        resultR =
          RISK_REWARD;


        exitPrice =
          state.takeProfit;


        exitTime =
          bar.time;


        exitTimestamp =
          bar.timestamp;


        break;

      }

    }


    if (
      state.signal ===
      "SELL"
    ) {

      const stopHit =

        bar.high >=
        state.stopLoss;


      const targetHit =

        bar.low <=
        state.takeProfit;


      if (
        stopHit
      ) {

        result =
          "LOSS";


        resultR =
          -1;


        exitPrice =
          state.stopLoss;


        exitTime =
          bar.time;


        exitTimestamp =
          bar.timestamp;


        break;

      }


      if (
        targetHit
      ) {

        result =
          "WIN";


        resultR =
          RISK_REWARD;


        exitPrice =
          state.takeProfit;


        exitTime =
          bar.time;


        exitTimestamp =
          bar.timestamp;


        break;

      }

    }

  }


  return {

    result,

    r:
      resultR,

    exitPrice,

    exitTime,

    exitTimestamp,

    holdMinutes:

      exitTimestamp ===
      null

        ? null

        : Math.max(

            0,

            (
              exitTimestamp -
              state.closeTimestamp
            )

            /

            60_000

          )

  };

}


/* =========================================================
   HARD-LOCK BACKTEST
========================================================= */

function backtest(
  oneMinuteBars,
  states
) {

  const trades =
    [];


  let index =

    Math.min(

      BACKTEST_WARMUP_STATES,

      Math.max(
        0,
        states.length -
        1
      )

    );


  while (
    index <
    states.length
  ) {

    const state =
      states[index];


    if (
      state.signal ===
      "WAIT"
    ) {

      index++;

      continue;

    }


    const simulation =
      simulateTrade(

        oneMinuteBars,

        state

      );


    trades.push({

      signal:
        state.signal,

      trigger:
        state.trigger,

      score:
        state.score,

      entryTime:
        state.closeTime,

      entry:
        state.entry,

      stopLoss:
        state.stopLoss,

      takeProfit:
        state.takeProfit,

      risk:
        state.risk,

      rr:
        state.rr,

      zone:
        state.zone,

      bullSpikes:
        state.anchor
          ?.bullSpikes
        ??
        0,

      bearSpikes:
        state.anchor
          ?.bearSpikes
        ??
        0,

      result:
        simulation.result,

      r:
        simulation.r,

      exitPrice:
        simulation.exitPrice,

      exitTime:
        simulation.exitTime,

      exitTimestamp:
        simulation.exitTimestamp,

      holdMinutes:
        simulation.holdMinutes

    });


    if (
      simulation.exitTimestamp ===
      null
    ) {

      break;

    }


    /*
       HARD LOCK:
       all other setups ignored until exit.
    */

    index++;


    while (

      index <
      states.length

      &&

      states[index]
        .closeTimestamp <=
      simulation.exitTimestamp

    ) {

      index++;

    }

  }


  const closed =

    trades.filter(
      trade =>

        trade.result ===
        "WIN"

        ||

        trade.result ===
        "LOSS"
    );


  const wins =

    closed.filter(
      trade =>
        trade.result ===
        "WIN"
    );


  const losses =

    closed.filter(
      trade =>
        trade.result ===
        "LOSS"
    );


  const grossProfitR =

    wins.reduce(
      (
        total,
        trade
      ) =>

        total +
        trade.r,

      0
    );


  const grossLossR =

    Math.abs(

      losses.reduce(
        (
          total,
          trade
        ) =>

          total +
          trade.r,

        0
      )

    );


  const netR =

    closed.reduce(
      (
        total,
        trade
      ) =>

        total +
        trade.r,

      0
    );


  const winRate =

    closed.length

      ? wins.length /
        closed.length *
        100

      : 0;


  const expectancyR =

    closed.length

      ? netR /
        closed.length

      : 0;


  const profitFactor =

    grossLossR >
    0

      ? grossProfitR /
        grossLossR

      : grossProfitR >
        0

        ? 999

        : 0;


  let equity =
    0;


  let peak =
    0;


  let maxDrawdownR =
    0;


  let currentLossStreak =
    0;


  let maxLossStreak =
    0;


  for (
    const trade
    of closed
  ) {

    equity +=
      trade.r;


    peak =
      Math.max(
        peak,
        equity
      );


    maxDrawdownR =
      Math.max(

        maxDrawdownR,

        peak -
        equity

      );


    if (
      trade.result ===
      "LOSS"
    ) {

      currentLossStreak++;


      maxLossStreak =
        Math.max(

          maxLossStreak,

          currentLossStreak

        );

    } else {

      currentLossStreak =
        0;

    }

  }


  const holdValues =

    closed

      .map(
        trade =>
          trade.holdMinutes
      )

      .filter(
        Number.isFinite
      );


  const averageHoldMinutes =

    holdValues.length

      ?

      holdValues.reduce(
        (
          total,
          value
        ) =>

          total +
          value,

        0
      )

      /

      holdValues.length

      :

      0;


  return {

    mode:
      "HARD LOCK",

    targetR:
      RISK_REWARD,

    tradesTaken:
      trades.length,

    closedTrades:
      closed.length,

    openTrades:

      trades.filter(
        trade =>
          trade.result ===
          "OPEN"
      ).length,

    wins:
      wins.length,

    losses:
      losses.length,

    winRate:
      round(
        winRate,
        1
      ),

    profitFactor:

      profitFactor ===
      999

        ? 999

        : round(
            profitFactor,
            2
          ),

    netR:
      round(
        netR,
        2
      ),

    expectancyR:
      round(
        expectancyR,
        3
      ),

    maxDrawdownR:
      round(
        maxDrawdownR,
        2
      ),

    maxLossStreak,

    averageHoldMinutes:
      round(
        averageHoldMinutes,
        1
      ),

    firstCandle:
      states[0]
        ?.time
      ??
      null,

    lastCandle:
      states.at(-1)
        ?.closeTime
      ??
      null,

    recentTrades:

      trades

        .slice(
          -RECENT_BACKTEST_LIMIT
        )

        .reverse()

  };

}


/* =========================================================
   RECENT SIGNALS
========================================================= */

function recentSignals(
  states
) {

  return states

    .filter(
      state =>

        state.signal ===
        "BUY"

        ||

        state.signal ===
        "SELL"
    )

    .slice(
      -RECENT_SIGNAL_LIMIT
    )

    .reverse();

}


/* =========================================================
   HARD LOCK QUERY
========================================================= */

function getRequestedLock(
  req
) {

  const signal =
    String(
      req.query
        ?.lockSignal
      ||
      ""
    )
      .trim()
      .toUpperCase();


  if (
    signal !==
    "BUY"

    &&

    signal !==
    "SELL"
  ) {

    return null;

  }


  const entry =
    num(
      req.query
        ?.lockEntry
    );


  const stopLoss =
    num(
      req.query
        ?.lockSL
    );


  const takeProfit =
    num(
      req.query
        ?.lockTP
    );


  const time =
    String(
      req.query
        ?.lockTime
      ||
      ""
    );


  if (
    entry ===
    null

    ||

    stopLoss ===
    null

    ||

    takeProfit ===
    null

    ||

    !time
  ) {

    return null;

  }


  return {

    signal,

    entry,

    stopLoss,

    takeProfit,

    time

  };

}


/* =========================================================
   CHECK ACTIVE HARD LOCK
========================================================= */

function checkRequestedLock(
  priceBars,
  lock
) {

  if (
    !lock
  ) {

    return null;

  }


  const start =
    parseTime(
      lock.time
    );


  if (
    !Number.isFinite(
      start
    )
  ) {

    return {

      status:
        "ACTIVE"

    };

  }


  /*
     Do NOT assume a trade survived if its creation
     predates the data we currently downloaded.

     Safest behavior = preserve the hard lock.
  */

  if (
    priceBars.length

    &&

    start <
    priceBars[0].timestamp
  ) {

    return {

      status:
        "ACTIVE",

      warning:
        "Lock predates fetched history; preserved as active."

    };

  }


  for (
    const bar
    of priceBars
  ) {

    if (
      bar.timestamp <
      start
    ) {

      continue;

    }


    if (
      lock.signal ===
      "BUY"
    ) {

      if (
        bar.low <=
        lock.stopLoss
      ) {

        return {

          status:
            "LOSS",

          resultR:
            -1,

          exitPrice:
            lock.stopLoss,

          exitTime:
            bar.time

        };

      }


      if (
        bar.high >=
        lock.takeProfit
      ) {

        return {

          status:
            "WIN",

          resultR:
            RISK_REWARD,

          exitPrice:
            lock.takeProfit,

          exitTime:
            bar.time

        };

      }

    }


    else {

      if (
        bar.high >=
        lock.stopLoss
      ) {

        return {

          status:
            "LOSS",

          resultR:
            -1,

          exitPrice:
            lock.stopLoss,

          exitTime:
            bar.time

        };

      }


      if (
        bar.low <=
        lock.takeProfit
      ) {

        return {

          status:
            "WIN",

          resultR:
            RISK_REWARD,

          exitPrice:
            lock.takeProfit,

          exitTime:
            bar.time

        };

      }

    }

  }


  return {

    status:
      "ACTIVE"

  };

}


/* =========================================================
   RESPONSE MAPPERS
========================================================= */

function mapZone(
  zone,
  digits
) {

  if (
    !zone
  ) {

    return null;

  }


  return {

    low:
      round(
        zone.low,
        digits
      ),

    high:
      round(
        zone.high,
        digits
      ),

    bullCount:
      zone.bullCount,

    bearCount:
      zone.bearCount,

    direction:
      zone.direction,

    strength:
      zone.strength,

    ageHours:
      zone.ageHours
      ??
      0,

    sourceStartTime:
      zone.sourceStartTime
      ??
      null,

    sourceEndTime:
      zone.sourceEndTime
      ??
      null

  };

}


function mapSignalState(
  state,
  digits
) {

  return {

    signal:
      state.signal,

    trigger:
      state.trigger,

    score:
      state.score,

    time:
      state.time,

    signalTime:
      state.closeTime,

    entry:
      round(
        state.entry,
        digits
      ),

    stopLoss:
      round(
        state.stopLoss,
        digits
      ),

    takeProfit:
      round(
        state.takeProfit,
        digits
      ),

    risk:
      round(
        state.risk,
        digits
      ),

    rr:
      state.rr,

    zone:
      mapZone(
        state.zone,
        digits
      ),

    bullSpikes:
      state.anchor
        ?.bullSpikes
      ??
      0,

    bearSpikes:
      state.anchor
        ?.bearSpikes
      ??
      0,

    dominance:
      state.anchor
        ?.dominance
      ??
      "BALANCED"

  };

}


/* =========================================================
   LOAD MARKET
========================================================= */

async function loadMarket(
  symbol
) {

  if (
    symbol ===
    "BTC/USD"
  ) {

    const btcBars =
      await fetchBtcCoinbase1m();


    return {

      priceBars:
        btcBars,

      volumeBars:
        btcBars,

      priceSource:
        "Coinbase Exchange BTC-USD",

      volumeSource:
        "Coinbase Exchange BTC-USD traded volume",

      volumeMode:
        "REAL EXCHANGE VOLUME"

    };

  }


  const [
    spotBars,
    futuresVolume
  ] =
    await Promise.all([

      fetchXauSpot1m(),

      fetchGoldFuturesVolume1m()

    ]);


  const aligned =
    attachProxyVolume(

      spotBars,

      futuresVolume

    );


  return {

    priceBars:
      aligned,

    volumeBars:
      futuresVolume,

    priceSource:
      "Twelve Data XAU/USD spot",

    volumeSource:
      "Yahoo Finance GC=F gold-futures volume proxy",

    volumeMode:
      "FUTURES VOLUME PROXY"

  };

}


/* =========================================================
   VERCEL HANDLER
========================================================= */

export default async function handler(
  req,
  res
) {

  res.setHeader(

    "Cache-Control",

    "no-store, no-cache, must-revalidate"

  );


  res.setHeader(

    "Access-Control-Allow-Origin",

    "*"

  );


  res.setHeader(

    "Access-Control-Allow-Methods",

    "GET,OPTIONS"

  );


  res.setHeader(

    "Access-Control-Allow-Headers",

    "Content-Type"

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
    "GET"
  ) {

    return res
      .status(405)
      .json({

        success:
          false,

        error:
          "Use GET."

      });

  }


  try {

    const requested =

      Array.isArray(
        req.query?.symbol
      )

        ? req.query.symbol[0]

        : req.query?.symbol;


    const symbol =
      normalizeSymbol(
        requested
      );


    const market =
      MARKETS[
        symbol
      ];


    const packet =
      await loadMarket(
        symbol
      );


    const completedPrice =
      completedOneMinuteBars(
        packet.priceBars
      );


    const volumePacket =
      addVolumeSpikeStats(
        completedPrice
      );


    const oneMinuteBars =
      volumePacket.bars;


    const fiveMinuteBars =

      resamplePrice(

        oneMinuteBars,

        EXECUTION_MINUTES

      )

        .filter(
          bar =>

            bar.closeTimestamp <=
            Date.now()
        );


    if (
      fiveMinuteBars.length <
      30
    ) {

      throw new Error(

        `${symbol}: not enough completed 5M candles.`

      );

    }


    const states =
      buildStates(

        oneMinuteBars,

        fiveMinuteBars

      );


    const current =
      states.at(-1);


    if (
      !current?.anchor
    ) {

      throw new Error(

        `${symbol}: current 1H anchor could not be built.`

      );

    }


    const signal =

      volumePacket.volumeAvailable

        ? current.signal

        : "WAIT";


    const backtestResult =

      volumePacket.volumeAvailable

        ?

        backtest(

          oneMinuteBars,

          states

        )

        :

        {

          mode:
            "HARD LOCK",

          targetR:
            RISK_REWARD,

          unavailable:
            true,

          reason:
            "Not enough usable 1M volume data.",

          tradesTaken:
            0,

          closedTrades:
            0,

          openTrades:
            0,

          wins:
            0,

          losses:
            0,

          winRate:
            0,

          profitFactor:
            0,

          netR:
            0,

          expectancyR:
            0,

          maxDrawdownR:
            0,

          maxLossStreak:
            0,

          averageHoldMinutes:
            0,

          firstCandle:
            states[0]
              ?.time
            ??
            null,

          lastCandle:
            current.closeTime,

          recentTrades:
            []

        };


    const requestedLock =
      getRequestedLock(
        req
      );


    const lockCheck =
      checkRequestedLock(

        packet.priceBars,

        requestedLock

      );


    const livePrice =

      packet.priceBars.at(-1)
        ?.close

      ??

      current.close;


    const reasons =
      [];


    /* =====================================================
       REASONS
    ===================================================== */

    if (
      !volumePacket.volumeAvailable
    ) {

      reasons.push(

        "Volume source is too sparse for the 20-bar 1M volume average."

      );

    }


    else if (
      signal ===
      "BUY"
    ) {

      reasons.push(

        `BUY ${current.trigger || "SETUP"} scored ${current.score}/${MIN_SIGNAL_SCORE}+ required.`

      );


      reasons.push(

        `Bullish zones remain active for up to ${ZONE_LOOKBACK_HOURS} hours.`

      );


      reasons.push(

        "A breakout, reclaim, or retest of the bullish imbalance can trigger."

      );


      reasons.push(

        "1H volume pressure and POC are scoring factors instead of hard blockers."

      );


      reasons.push(

        "SL is the bottom of the selected bullish imbalance zone."

      );


      reasons.push(

        "TP remains fixed at 3R and the trade hard-locks until SL or TP."

      );

    }


    else if (
      signal ===
      "SELL"
    ) {

      reasons.push(

        `SELL ${current.trigger || "SETUP"} scored ${current.score}/${MIN_SIGNAL_SCORE}+ required.`

      );


      reasons.push(

        `Bearish zones remain active for up to ${ZONE_LOOKBACK_HOURS} hours.`

      );


      reasons.push(

        "A breakdown, reclaim, or retest of the bearish imbalance can trigger."

      );


      reasons.push(

        "1H volume pressure and POC are scoring factors instead of hard blockers."

      );


      reasons.push(

        "SL is the top of the selected bearish imbalance zone."

      );


      reasons.push(

        "TP remains fixed at 3R and the trade hard-locks until SL or TP."

      );

    }


    else {

      reasons.push(

        `No BUY or SELL candidate reached the V3 minimum score of ${MIN_SIGNAL_SCORE}.`

      );


      reasons.push(

        `V3 only needs ${MIN_STACKED_SPIKES} same-side volume spikes to form a zone.`

      );


      reasons.push(

        `Zones stay usable for ${ZONE_LOOKBACK_HOURS} hours instead of resetting every hour.`

      );


      reasons.push(

        `Current 1H pressure: ${current.anchor.bullSpikes} bullish spikes vs ${current.anchor.bearSpikes} bearish spikes.`

      );


      reasons.push(

        `Active current + carried zones: ${current.anchor.zones.length}.`

      );

    }


    const maxSpikeVolume =

      Math.max(

        0,

        ...current.anchor.spikes.map(
          spike =>
            Number(
              spike.volume
            )
            ||
            0
        )

      );


    return res
      .status(200)
      .json({

        success:
          true,

        engine:
          "MKAYFX 5M HTF VOLUME IMBALANCE V3",

        symbol,

        assetName:
          market.name,

        assetShort:
          market.short,

        timeframe:
          "5min",

        generatedAt:
          new Date()
            .toISOString(),

        candleTime:
          current.time,

        signalTime:
          current.closeTime,

        candleAgeMinutes:
          round(
            minutesOld(
              current.closeTime
            ),
            1
          ),

        price:
          round(
            livePrice,
            market.digits
          ),

        signal,


        /*
           NEW V3 FIELDS
        */

        trigger:

          signal ===
          "WAIT"

            ? null

            : current.trigger,


        signalScore:

          signal ===
          "WAIT"

            ? 0

            : current.score,


        entry:

          signal ===
          "WAIT"

            ? null

            : round(
                current.entry,
                market.digits
              ),

        stopLoss:

          signal ===
          "WAIT"

            ? null

            : round(
                current.stopLoss,
                market.digits
              ),

        takeProfit:

          signal ===
          "WAIT"

            ? null

            : round(
                current.takeProfit,
                market.digits
              ),

        risk:

          signal ===
          "WAIT"

            ? null

            : round(
                current.risk,
                market.digits
              ),

        rr:
          RISK_REWARD,


        /* =================================================
           DATA SOURCES
        ================================================= */

        dataSources: {

          price:
            packet.priceSource,

          volume:
            packet.volumeSource,

          volumeMode:
            packet.volumeMode

        },


        /* =================================================
           SETTINGS
        ================================================= */

        settings: {

          executionTimeframe:
            "5min",

          htfAnchor:
            "60min",

          spikeGranularity:
            "1min",

          spikeMultiplier:
            SPIKE_MULTIPLIER,

          volumeMALength:
            VOLUME_MA_LENGTH,

          vpRows:
            VP_ROWS,

          minimumStackedSpikes:
            MIN_STACKED_SPIKES,

          zoneLookbackHours:
            ZONE_LOOKBACK_HOURS,

          minimumSignalScore:
            MIN_SIGNAL_SCORE,

          minimumScoreGap:
            MIN_SCORE_GAP,

          riskReward:
            RISK_REWARD,

          hardLock:
            true

        },


        /* =================================================
           VOLUME HEALTH
        ================================================= */

        volume: {

          available:
            volumePacket.volumeAvailable,

          usableBars:
            volumePacket.usableVolumeBars,

          totalBars:
            oneMinuteBars.length

        },


        /* =================================================
           1H CONTEXT
        ================================================= */

        anchor: {

          startTime:
            current.anchor.startTime,

          endTime:
            current.anchor.endTime,

          open:
            round(
              current.anchor.open,
              market.digits
            ),

          high:
            round(
              current.anchor.high,
              market.digits
            ),

          low:
            round(
              current.anchor.low,
              market.digits
            ),

          close:
            round(
              current.anchor.close,
              market.digits
            ),

          bullSpikes:
            current.anchor.bullSpikes,

          bearSpikes:
            current.anchor.bearSpikes,

          totalSpikes:
            current.anchor.totalSpikes,

          dominance:
            current.anchor.dominance,

          zoneLookbackHours:
            current.anchor.zoneLookbackHours,

          poc:
            round(
              current.anchor.poc,
              market.digits
            ),


          /* ===============================================
             STRONGEST ACTIVE ZONES
          =============================================== */

          strongestBullish:
            mapZone(
              current.anchor
                .strongestBullish,
              market.digits
            ),

          strongestBearish:
            mapZone(
              current.anchor
                .strongestBearish,
              market.digits
            ),


          /*
             Current hour + carried zones.
          */

          imbalances:

            current.anchor.zones

              .slice()

              .sort(
                (
                  a,
                  b
                ) =>

                  b.strength -
                  a.strength

                  ||

                  a.ageHours -
                  b.ageHours
              )

              .slice(
                0,
                16
              )

              .map(
                zone =>
                  mapZone(
                    zone,
                    market.digits
                  )
              ),


          /*
             Volume profile remains the CURRENT 1H profile.
          */

          profile:

            current.anchor.profile

              .map(
                row => ({

                  low:
                    round(
                      row.low,
                      market.digits
                    ),

                  high:
                    round(
                      row.high,
                      market.digits
                    ),

                  relative:
                    round(
                      row.relative,
                      4
                    )

                })
              ),


          /*
             Current 1H spikes.
          */

          spikes:

            current.anchor.spikes

              .slice(
                -120
              )

              .map(
                spike => ({

                  time:
                    spike.time,

                  price:
                    round(
                      spike.price,
                      market.digits
                    ),

                  delta:
                    spike.delta,

                  volume:
                    round(
                      spike.volume,
                      4
                    ),

                  relative:

                    maxSpikeVolume >
                    0

                      ? round(
                          spike.volume /
                          maxSpikeVolume,
                          4
                        )

                      : 0

                })
              )

        },


        reasons,


        /* =================================================
           ACTIVE HARD LOCK CHECK
        ================================================= */

        lockCheck,


        /* =================================================
           RECENT RAW STRATEGY SIGNALS
        ================================================= */

        recentSignals:

          volumePacket.volumeAvailable

            ?

            recentSignals(
              states
            )
              .map(
                state =>
                  mapSignalState(
                    state,
                    market.digits
                  )
              )

            :

            [],


        /* =================================================
           BACKTEST
        ================================================= */

        backtest: {

          ...backtestResult,

          recentTrades:

            (
              backtestResult.recentTrades ||
              []
            )

              .map(
                trade => ({

                  ...trade,

                  entry:
                    round(
                      trade.entry,
                      market.digits
                    ),

                  stopLoss:
                    round(
                      trade.stopLoss,
                      market.digits
                    ),

                  takeProfit:
                    round(
                      trade.takeProfit,
                      market.digits
                    ),

                  risk:
                    round(
                      trade.risk,
                      market.digits
                    ),

                  exitPrice:
                    round(
                      trade.exitPrice,
                      market.digits
                    ),

                  zone:
                    mapZone(
                      trade.zone,
                      market.digits
                    )

                })
              )

        },


        /* =================================================
           CHART
        ================================================= */

        chart:

          fiveMinuteBars

            .slice(
              -180
            )

            .map(
              bar => ({

                time:
                  bar.time,

                closeTime:
                  bar.closeTime,

                open:
                  round(
                    bar.open,
                    market.digits
                  ),

                high:
                  round(
                    bar.high,
                    market.digits
                  ),

                low:
                  round(
                    bar.low,
                    market.digits
                  ),

                close:
                  round(
                    bar.close,
                    market.digits
                  )

              })
            )

      });

  } catch (
    error
  ) {

    console.error(

      "MKAYFX VOLUME ENGINE ERROR",

      error

    );


    return res
      .status(500)
      .json({

        success:
          false,

        engine:
          "MKAYFX 5M HTF VOLUME IMBALANCE V3",

        error:

          safeError(
            error
          )

          ||

          "Unknown volume engine error."

      });

  }

}