/* =========================================================
   MKAYFX 15M / 1H / 4H VOLUME IMBALANCE ENGINE V4.0
   /api/sr.js

   MULTI-TIMEFRAME STRUCTURE
   -------------------------
   15M = Entry / execution
   1H  = Imbalance zones + confirmation
   4H  = Macro directional bias

   STRATEGY
   --------
   Spike source: 1M
   Zone memory: 3 x 1H
   RR: 1:2
   Trade mode: HARD LOCK

   ENTRY TYPES
   -----------
   BREAKOUT
   RECLAIM
   RETEST

   SNIPER FILTERS
   --------------
   15M candle confirmation
   1H volume imbalance
   4H directional confirmation
   Anti-chase filter
   Candle-close-position filter
========================================================= */


const TWELVE_API_KEY =
  process.env.TWELVE_DATA_API_KEY;


const TWELVE_BASE =
  "https://api.twelvedata.com";


const COINBASE_BASE =
  "https://api.exchange.coinbase.com";


const YAHOO_BASE =
  "https://query1.finance.yahoo.com/v8/finance/chart";


const MARKETS = {

  "XAU/USD": {

    name: "GOLD",
    short: "XAU",
    digits: 2

  },

  "BTC/USD": {

    name: "BITCOIN",
    short: "BTC",
    digits: 2

  }

};


/* =========================================================
   TIMEFRAMES
========================================================= */


const EXECUTION_MINUTES =
  1;


const CONFIRMATION_MINUTES =
  15;


const MACRO_MINUTES =
  15;


/* =========================================================
   VOLUME SETTINGS
========================================================= */


const VOLUME_MA_LENGTH =
  10;


const SPIKE_MULTIPLIER =
  2.0;


const VP_ROWS =
  40;


const MIN_STACKED_SPIKES =
  2;


/*
   Current 1H + previous 2 x 1H.
*/
const ZONE_LOOKBACK_HOURS =
  3;


/* =========================================================
   SIGNAL SETTINGS
========================================================= */


const MIN_SIGNAL_SCORE =
  52;


const MIN_SCORE_GAP =
  4;


const OPPOSITE_PRESSURE_PENALTY =
  1;


/*
   4H alignment.

   Correct 4H direction gets a bonus.

   Opposite 4H direction does not completely
   block the trade, but heavily reduces score.
*/
const MACRO_ALIGNMENT_BONUS =
  8;


const MACRO_BALANCED_BONUS =
  3;


const MACRO_OPPOSITE_PENALTY =
  8;


const MACRO_POC_BONUS =
  4;


/* =========================================================
   ZONE INTERACTION
========================================================= */


const TOUCH_ZONE_MULTIPLIER =
  0.55;


const TOUCH_RANGE_MULTIPLIER =
  0.017;


const MAX_CHASE_ZONE_MULTIPLIER =
  2.7;


const MAX_CHASE_RANGE_MULTIPLIER =
  0.17;


/* =========================================================
   15M CANDLE QUALITY
========================================================= */


const BREAKOUT_MIN_BODY_RATIO =
  0.50;


const RECLAIM_MIN_BODY_RATIO =
  0.42;


const RETEST_MIN_BODY_RATIO =
  0.38;


/* =========================================================
   TRADE MANAGEMENT
========================================================= */


const RISK_REWARD =
  2;


/* =========================================================
   HISTORY
========================================================= */


const XAU_OUTPUT_SIZE =
  3000;


const COINBASE_TARGET_BARS =
  2500;


const COINBASE_CHUNK_BARS =
  295;


const RECENT_SIGNAL_LIMIT =
  40;


const RECENT_BACKTEST_LIMIT =
  60;


const BACKTEST_WARMUP_STATES =
  12;


/* =========================================================
   HELPERS
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

    return value.message
      || String(value);

  }


  if (typeof value === "object") {

    if (
      typeof value.message ===
      "string"
    ) {

      return value.message;

    }


    if (
      typeof value.error ===
      "string"
    ) {

      return value.error;

    }


    try {

      return JSON.stringify(value);

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


  return (
    Math.floor(
      ts /
      size
    )
    *
    size
  );

}


function minutesOld(value) {

  const ts =
    parseTime(value);


  if (
    !Number.isFinite(ts)
  ) {

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

    XAUUSD: "XAU/USD",
    XAU: "XAU/USD",
    GOLD: "XAU/USD",

    BTCUSD: "BTC/USD",
    BTC: "BTC/USD",
    BITCOIN: "BTC/USD"

  };


  const symbol =
    aliases[raw]
    ||
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
              "MKAYFX/4.0",

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

        `Non-JSON response HTTP ${response.status}: ${raw.slice(0, 250)}`

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

    clearTimeout(timer);

  }

}


/* =========================================================
   XAU/USD PRICE
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

      data.message
      ||
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
          ].every(
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
    300
  ) {

    throw new Error(

      "Not enough XAU/USD 1M history."

    );

  }


  return bars;

}


/* =========================================================
   GOLD FUTURES VOLUME
========================================================= */


async function fetchGoldFuturesVolume1m() {

  const symbol =
    encodeURIComponent(
      "GC=F"
    );


  const url =

    `${YAHOO_BASE}/${symbol}`

    +

    "?interval=1m&range=5d&includePrePost=true&events=div%2Csplits";


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
    result?.timestamp;


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

      "Gold futures GC=F returned no usable 1M data."

    );

  }


  const bars =
    [];


  for (
    let i = 0;
    i < timestamps.length;
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

      volume >= 0

    ) {

      bars.push({

        timestamp,

        time:
          iso(timestamp),

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
   BTC
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
        iso(startMs),

      end:
        iso(endMs)

    });


  const data =
    await getJSON(

      `${COINBASE_BASE}/products/BTC-USD/candles?${query.toString()}`

    );


  if (
    !Array.isArray(data)
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
            Number.isFinite(timestamp)
              ? iso(timestamp)
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
        ].every(
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
    i < chunks;
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
          iso(minute)

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
    300
  ) {

    throw new Error(

      "Coinbase returned too little BTC-USD history."

    );

  }


  return bars;

}


/* =========================================================
   VOLUME ALIGNMENT
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
   VOLUME SPIKES
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
    i < bars.length;
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
      volume !== null
    ) {

      usable++;

    }


    window.push(
      volume
    );


    if (
      volume !== null
    ) {

      sum += volume;

    }


    if (
      window.length >
      VOLUME_MA_LENGTH
    ) {

      const removed =
        window.shift();


      if (
        removed !== null
      ) {

        sum -= removed;

      }

    }


    const completeWindow =

      window.length ===
      VOLUME_MA_LENGTH

      &&

      window.every(
        item =>
          item !== null
      );


    const volumeMA =

      completeWindow

        ? sum /
          VOLUME_MA_LENGTH

        : null;


    const isSpike =

      volume !== null

      &&

      volumeMA !== null

      &&

      volumeMA > 0

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
   RESAMPLE
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
      map.get(start);


    if (!group) {

      group = {

        timestamp:
          start,

        time:
          iso(start),

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
   BUILD GENERIC HTF ANCHOR
========================================================= */


function buildAnchor(
  oneMinuteBars,
  stateCloseTimestamp,
  anchorMinutes
) {

  const anchorStart =
    bucketStart(

      stateCloseTimestamp -
      1,

      anchorMinutes

    );


  const anchorBars =
    oneMinuteBars.filter(

      bar =>

        bar.timestamp >=
        anchorStart

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
        spike.delta > 0
    ).length;


  const bearSpikes =
    spikes.filter(
      spike =>
        spike.delta < 0
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
            low +
            index *
            step,

          high:
            low +
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


    /*
       Volume profile.
    */

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

        bar.volume >= 0
      ) {

        bins[index].volume +=
          bar.volume;

      }

    }


    /*
       Spike distribution.
    */

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

          maxProfileVolume > 0

            ? bin.volume /
              maxProfileVolume

            : 0

      });

    }

  }


  return {

    timeframeMinutes:
      anchorMinutes,

    startTime:
      iso(
        anchorStart
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
   ACTIVE 1H ZONES
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

      CONFIRMATION_MINUTES

    );


  /*
     Current 1H.
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
     Previous 1H zones.
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
      CONFIRMATION_MINUTES
      *
      60_000;


    const historicalAnchor =
      buildAnchor(

        oneMinuteBars,

        boundary,

        CONFIRMATION_MINUTES

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
   BUILD MTF CONTEXT
========================================================= */


function buildStrategyAnchor(
  oneMinuteBars,
  stateCloseTimestamp
) {

  /*
     1H confirmation.
  */

  const confirmation =
    buildAnchor(

      oneMinuteBars,

      stateCloseTimestamp,

      CONFIRMATION_MINUTES

    );


  if (
    !confirmation
  ) {

    return null;

  }


  /*
     4H macro.
  */

  const macro =
    buildAnchor(

      oneMinuteBars,

      stateCloseTimestamp,

      MACRO_MINUTES

    );


  const activeZones =
    activeZonesForState(

      oneMinuteBars,

      stateCloseTimestamp,

      confirmation

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

    ...confirmation,

    zones:
      activeZones,

    strongestBullish,

    strongestBearish,

    zoneLookbackHours:
      ZONE_LOOKBACK_HOURS,

    macro

  };

}


/* =========================================================
   15M / 1H / 4H ENTRY CANDIDATE
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
    ].every(
      Number.isFinite
    )
  ) {

    return null;

  }


  /* =======================================================
     15M CANDLE QUALITY
  ======================================================= */


  const candleRange =
    Math.max(

      currentHigh -
      currentLow,

      1e-9

    );


  const candleBody =
    Math.abs(

      currentClose -
      currentOpen

    );


  const bodyRatio =
    candleBody /
    candleRange;


  /*
     0 = candle closes at low
     1 = candle closes at high
  */

  const closePosition =

    (
      currentClose -
      currentLow
    )

    /

    candleRange;


  /* =======================================================
     ZONE DISTANCE
  ======================================================= */


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


  const touchTolerance =
    Math.max(

      zoneWidth *
      TOUCH_ZONE_MULTIPLIER,

      anchorRange *
      TOUCH_RANGE_MULTIPLIER

    );


  const maxChase =
    Math.max(

      zoneWidth *
      MAX_CHASE_ZONE_MULTIPLIER,

      anchorRange *
      MAX_CHASE_RANGE_MULTIPLIER

    );


  let trigger =
    null;


  /* =======================================================
     BUY ENTRY
  ======================================================= */


  if (
    direction ===
    "BUY"
  ) {

    const breakout =

      previousClose <=
      zoneHigh +
      touchTolerance

      &&

      currentClose >
      zoneHigh

      &&

      currentClose >
      currentOpen

      &&

      bodyRatio >=
      BREAKOUT_MIN_BODY_RATIO

      &&

      closePosition >=
      0.60

      &&

      currentClose -
      zoneHigh <=
      maxChase;


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

      bodyRatio >=
      RECLAIM_MIN_BODY_RATIO

      &&

      closePosition >=
      0.55

      &&

      currentClose -
      zoneHigh <=
      maxChase;


    const retest =

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
      currentOpen

      &&

      bodyRatio >=
      RETEST_MIN_BODY_RATIO

      &&

      closePosition >=
      0.55

      &&

      currentClose -
      zoneHigh <=
      maxChase;


    if (breakout) {

      trigger =
        "BREAKOUT";

    } else if (reclaim) {

      trigger =
        "RECLAIM";

    } else if (retest) {

      trigger =
        "RETEST";

    }

  }


  /* =======================================================
     SELL ENTRY
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

      currentClose <
      currentOpen

      &&

      bodyRatio >=
      BREAKOUT_MIN_BODY_RATIO

      &&

      closePosition <=
      0.40

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

      bodyRatio >=
      RECLAIM_MIN_BODY_RATIO

      &&

      closePosition <=
      0.45

      &&

      zoneLow -
      currentClose <=
      maxChase;


    const retest =

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
      currentOpen

      &&

      bodyRatio >=
      RETEST_MIN_BODY_RATIO

      &&

      closePosition <=
      0.45

      &&

      zoneLow -
      currentClose <=
      maxChase;


    if (breakout) {

      trigger =
        "BREAKOUT";

    } else if (reclaim) {

      trigger =
        "RECLAIM";

    } else if (retest) {

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
     BASE SCORE
  ======================================================= */


  let score =
    30;


  if (
    trigger ===
    "BREAKOUT"
  ) {

    score +=
      14;

  }

  else if (
    trigger ===
    "RECLAIM"
  ) {

    score +=
      13;

  }

  else {

    score +=
      11;

  }


  /* =======================================================
     1H ZONE STRENGTH
  ======================================================= */


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


  /* =======================================================
     15M CANDLE QUALITY BONUS
  ======================================================= */


  if (
    bodyRatio >=
    0.70
  ) {

    score +=
      5;

  }

  else if (
    bodyRatio >=
    0.55
  ) {

    score +=
      3;

  }

  else if (
    bodyRatio >=
    0.45
  ) {

    score +=
      1;

  }


  /* =======================================================
     1H VOLUME PRESSURE
  ======================================================= */


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

    }

    else if (
      bullSpikes ===
      bearSpikes
    ) {

      score +=
        5;

    }

    else {

      score -=
        OPPOSITE_PRESSURE_PENALTY;

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


  else {

    if (
      bearSpikes >
      bullSpikes
    ) {

      score +=
        10;

    }

    else if (
      bullSpikes ===
      bearSpikes
    ) {

      score +=
        5;

    }

    else {

      score -=
        OPPOSITE_PRESSURE_PENALTY;

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


  /* =======================================================
     4H MACRO CONFIRMATION
  ======================================================= */


  const macro =
    anchor.macro;


  if (macro) {

    if (
      direction ===
      "BUY"
    ) {

      if (
        macro.dominance ===
        "BULLISH"
      ) {

        score +=
          MACRO_ALIGNMENT_BONUS;

      }

      else if (
        macro.dominance ===
        "BALANCED"
      ) {

        score +=
          MACRO_BALANCED_BONUS;

      }

      else {

        score -=
          MACRO_OPPOSITE_PENALTY;

      }


      if (
        Number.isFinite(
          macro.poc
        )

        &&

        currentClose >=
        macro.poc
      ) {

        score +=
          MACRO_POC_BONUS;

      }

    }


    else {

      if (
        macro.dominance ===
        "BEARISH"
      ) {

        score +=
          MACRO_ALIGNMENT_BONUS;

      }

      else if (
        macro.dominance ===
        "BALANCED"
      ) {

        score +=
          MACRO_BALANCED_BONUS;

      }

      else {

        score -=
          MACRO_OPPOSITE_PENALTY;

      }


      if (
        Number.isFinite(
          macro.poc
        )

        &&

        currentClose <=
        macro.poc
      ) {

        score +=
          MACRO_POC_BONUS;

      }

    }

  }


  /* =======================================================
     ZONE AGE
  ======================================================= */


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

  }

  else if (
    ageHours ===
    1
  ) {

    score +=
      5;

  }

  else if (
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

    bodyRatio:
      round(
        bodyRatio,
        3
      ),

    score:
      Math.round(
        score
      ),

    oneHourBias:
      anchor.dominance,

    fourHourBias:
      macro?.dominance
      ??
      "BALANCED"

  };

}


/* =========================================================
   SELECT SIGNAL
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

      .filter(Boolean)

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

      .filter(Boolean)

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


  if (
    buyQualified

    &&

    !sellQualified
  ) {

    return {

      signal:
        "BUY",

      ...bestBuy

    };

  }


  if (
    sellQualified

    &&

    !buyQualified
  ) {

    return {

      signal:
        "SELL",

      ...bestSell

    };

  }


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

        ...bestBuy

      };

    }


    return {

      signal:
        "SELL",

      ...bestSell

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

      valid: false,

      entry: null,

      stopLoss: null,

      takeProfit: null,

      risk: null,

      rr:
        RISK_REWARD

    };

  }


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

    risk <= 0

  ) {

    return {

      valid: false,

      entry: null,

      stopLoss: null,

      takeProfit: null,

      risk: null,

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
   BUILD 15M STATES
========================================================= */


function buildStates(
  oneMinuteBars,
  executionBars
) {

  const states =
    [];


  for (
    let i = 0;
    i < executionBars.length;
    i++
  ) {

    const bar =
      executionBars[i];


    const anchor =
      buildStrategyAnchor(

        oneMinuteBars,

        bar.closeTimestamp

      );


    const previousBar =

      i > 0

        ? executionBars[
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
      selection?.signal
      ||
      "WAIT";


    let zone =
      selection?.zone
      ||
      null;


    let trigger =
      selection?.trigger
      ||
      null;


    let bodyRatio =
      selection?.bodyRatio
      ??
      null;


    let score =
      selection?.score
      ||
      0;


    let oneHourBias =
      selection?.oneHourBias
      ||
      anchor?.dominance
      ||
      "BALANCED";


    let fourHourBias =
      selection?.fourHourBias
      ||
      anchor?.macro?.dominance
      ||
      "BALANCED";


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


      bodyRatio =
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

      bodyRatio,

      score,

      oneHourBias,

      fourHourBias,

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
         Conservative:
         SL wins if SL + TP hit
         during same 1M candle.
      */

      if (stopHit) {

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


      if (targetHit) {

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


      if (stopHit) {

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


      if (targetHit) {

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
   HARD LOCK BACKTEST
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

      bodyRatio:
        state.bodyRatio,

      oneHourBias:
        state.oneHourBias,

      fourHourBias:
        state.fourHourBias,

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


    index++;


    /*
       Hard lock:
       skip every potential entry
       until existing trade closes.
    */

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

    grossLossR > 0

      ? grossProfitR /
        grossLossR

      : grossProfitR > 0

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

    execution:
      "15M",

    confirmation:
      "1H",

    macro:
      "4H",

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
   REQUESTED HARD LOCK
========================================================= */


function getRequestedLock(req) {

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
      req.query?.lockEntry
    );


  const stopLoss =
    num(
      req.query?.lockSL
    );


  const takeProfit =
    num(
      req.query?.lockTP
    );


  const time =
    String(
      req.query?.lockTime
      ||
      ""
    );


  if (

    entry === null

    ||

    stopLoss === null

    ||

    takeProfit === null

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
   CHECK HARD LOCK
========================================================= */


function checkRequestedLock(
  priceBars,
  lock
) {

  if (!lock) {
    return null;
  }


  const start =
    parseTime(
      lock.time
    );


  if (
    !Number.isFinite(start)
  ) {

    return {

      status:
        "ACTIVE"

    };

  }


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

  if (!zone) {
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

    bodyRatio:
      state.bodyRatio,

    oneHourBias:
      state.oneHourBias,

    fourHourBias:
      state.fourHourBias,

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
      )

  };

}


/* =========================================================
   LOAD MARKET
========================================================= */


async function loadMarket(symbol) {

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
        "Coinbase BTC-USD traded volume",

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
      MARKETS[symbol];


    /* =====================================================
       LOAD
    ===================================================== */


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


    /* =====================================================
       BUILD 15M EXECUTION
    ===================================================== */


    const executionBars =
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
      executionBars.length <
      20
    ) {

      throw new Error(

        `${symbol}: not enough completed 15M candles.`

      );

    }


    /* =====================================================
       STATES
    ===================================================== */


    const states =
      buildStates(

        oneMinuteBars,

        executionBars

      );


    const current =
      states.at(-1);


    if (
      !current?.anchor
    ) {

      throw new Error(

        `${symbol}: current 1H confirmation anchor could not be built.`

      );

    }


    const signal =

      volumePacket.volumeAvailable

        ? current.signal

        : "WAIT";


    /* =====================================================
       BACKTEST
    ===================================================== */


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

          execution:
            "15M",

          confirmation:
            "1H",

          macro:
            "4H",

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

          recentTrades:
            []

        };


    /* =====================================================
       LOCK
    ===================================================== */


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


    /* =====================================================
       REASONS
    ===================================================== */


    const reasons =
      [];


    const oneHourBias =
      current.anchor
        ?.dominance
      ??
      "BALANCED";


    const fourHourBias =
      current.anchor
        ?.macro
        ?.dominance
      ??
      "BALANCED";


    if (
      !volumePacket.volumeAvailable
    ) {

      reasons.push(

        "Volume data is currently too sparse."

      );

    }


    else if (
      signal ===
      "BUY"
    ) {

      reasons.push(

        `15M BUY ${current.trigger} scored ${current.score}.`

      );


      reasons.push(

        `15M entry candle body: ${round((current.bodyRatio || 0) * 100, 1)}%.`

      );


      reasons.push(

        `1H confirmation bias: ${oneHourBias}.`

      );


      reasons.push(

        `4H macro bias: ${fourHourBias}.`

      );


      reasons.push(

        "Bullish 1H imbalance interaction confirmed."

      );


      reasons.push(

        "15M candle confirmation passed."

      );


      reasons.push(

        `Target is ${RISK_REWARD}R.`

      );

    }


    else if (
      signal ===
      "SELL"
    ) {

      reasons.push(

        `15M SELL ${current.trigger} scored ${current.score}.`

      );


      reasons.push(

        `15M entry candle body: ${round((current.bodyRatio || 0) * 100, 1)}%.`

      );


      reasons.push(

        `1H confirmation bias: ${oneHourBias}.`

      );


      reasons.push(

        `4H macro bias: ${fourHourBias}.`

      );


      reasons.push(

        "Bearish 1H imbalance interaction confirmed."

      );


      reasons.push(

        "15M candle confirmation passed."

      );


      reasons.push(

        `Target is ${RISK_REWARD}R.`

      );

    }


    else {

      reasons.push(

        "No 15M sniper entry qualified."

      );


      reasons.push(

        `Minimum score is ${MIN_SIGNAL_SCORE}.`

      );


      reasons.push(

        `1H bias: ${oneHourBias}.`

      );


      reasons.push(

        `4H bias: ${fourHourBias}.`

      );


      reasons.push(

        `1H bullish spikes: ${current.anchor.bullSpikes}.`

      );


      reasons.push(

        `1H bearish spikes: ${current.anchor.bearSpikes}.`

      );


      reasons.push(

        `Active 1H imbalance zones: ${current.anchor.zones.length}.`

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


    /* =====================================================
       RESPONSE
    ===================================================== */


    return res
      .status(200)
      .json({

        success:
          true,

        engine:
          "MKAYFX MTF VOLUME IMBALANCE V4.0",

        strategyMode:
          "15M SNIPER / 1H CONFIRMATION / 4H MACRO",

        symbol,

        assetName:
          market.name,

        assetShort:
          market.short,

        timeframe:
          "15min",

        confirmationTimeframe:
          "1h",

        macroTimeframe:
          "4h",

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

        bodyRatio:

          signal ===
          "WAIT"

            ? null

            : current.bodyRatio,

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
           TIMEFRAME BIAS
        ================================================= */


        timeframeBias: {

          M15:

            signal ===
            "WAIT"

              ? "WAIT"

              : signal,

          H1:
            oneHourBias,

          H4:
            fourHourBias

        },


        /* =================================================
           SOURCES
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
            "15min",

          confirmationTimeframe:
            "60min",

          macroTimeframe:
            "240min",

          spikeGranularity:
            "1min",

          spikeMultiplier:
            SPIKE_MULTIPLIER,

          volumeMALength:
            VOLUME_MA_LENGTH,

          minimumStackedSpikes:
            MIN_STACKED_SPIKES,

          zoneLookbackHours:
            ZONE_LOOKBACK_HOURS,

          minimumSignalScore:
            MIN_SIGNAL_SCORE,

          minimumScoreGap:
            MIN_SCORE_GAP,

          macroAlignmentBonus:
            MACRO_ALIGNMENT_BONUS,

          macroBalancedBonus:
            MACRO_BALANCED_BONUS,

          macroOppositePenalty:
            MACRO_OPPOSITE_PENALTY,

          macroPocBonus:
            MACRO_POC_BONUS,

          breakoutMinBodyRatio:
            BREAKOUT_MIN_BODY_RATIO,

          reclaimMinBodyRatio:
            RECLAIM_MIN_BODY_RATIO,

          retestMinBodyRatio:
            RETEST_MIN_BODY_RATIO,

          riskReward:
            RISK_REWARD,

          hardLock:
            true

        },


        /* =================================================
           VOLUME
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
           1H CONFIRMATION
        ================================================= */


        anchor: {

          timeframe:
            "1H",

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

          poc:
            round(
              current.anchor.poc,
              market.digits
            ),

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

                    maxSpikeVolume > 0

                      ? round(

                          spike.volume /
                          maxSpikeVolume,

                          4

                        )

                      : 0

                })
              )

        },


        /* =================================================
           4H MACRO
        ================================================= */


        macro: current.anchor.macro

          ? {

              timeframe:
                "4H",

              startTime:
                current.anchor
                  .macro
                  .startTime,

              endTime:
                current.anchor
                  .macro
                  .endTime,

              open:
                round(

                  current.anchor
                    .macro
                    .open,

                  market.digits

                ),

              high:
                round(

                  current.anchor
                    .macro
                    .high,

                  market.digits

                ),

              low:
                round(

                  current.anchor
                    .macro
                    .low,

                  market.digits

                ),

              close:
                round(

                  current.anchor
                    .macro
                    .close,

                  market.digits

                ),

              bullSpikes:
                current.anchor
                  .macro
                  .bullSpikes,

              bearSpikes:
                current.anchor
                  .macro
                  .bearSpikes,

              totalSpikes:
                current.anchor
                  .macro
                  .totalSpikes,

              dominance:
                current.anchor
                  .macro
                  .dominance,

              poc:
                round(

                  current.anchor
                    .macro
                    .poc,

                  market.digits

                )

            }

          : null,


        reasons,


        lockCheck,


        /* =================================================
           RECENT SIGNALS
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
              backtestResult.recentTrades
              ||
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
           15M CHART
        ================================================= */


        chart:
          executionBars

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

  } catch (error) {

    console.error(

      "MKAYFX MTF ENGINE ERROR",

      error

    );


    return res
      .status(500)
      .json({

        success:
          false,

        engine:
          "MKAYFX MTF VOLUME IMBALANCE V4.0",

        error:

          safeError(
            error
          )

          ||

          "Unknown MTF engine error."

      });

  }

}