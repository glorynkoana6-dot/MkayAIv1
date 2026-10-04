/* =========================================================
   MKAYFX 5M HTF VOLUME SPIKE + IMBALANCE ENGINE
   /api/sr.js

   Based on the user-provided:
   "HTF Volume Spike & Imbalance Projection [LuxAlgo]"
   © LuxAlgo — CC BY-NC-SA 4.0

   5M chart => Auto HTF = 1H, Auto LTF = 1M

   Original indicator mechanics kept:
   - 1M volume SMA(20)
   - spike when volume > SMA20 * 1.2
   - bullish spike when close >= open
   - bearish spike when close < open
   - 40 price rows inside the live 1H anchor
   - stacked imbalance when >= 3 spikes dominate a row
   - volume profile from 1M closes/volume

   Trading rules added for this app:
   BUY  = completed 5M close crosses above a bullish stacked zone
          while the current 1H anchor is bullish/neutral-bullish
   SELL = completed 5M close crosses below a bearish stacked zone
          while the current 1H anchor is bearish/neutral-bearish

   BUY SL  = bottom of signal imbalance zone
   SELL SL = top of signal imbalance zone
   TP      = 3R

   HARD LOCK:
   - one active trade per symbol
   - ignore all later signals until SL or TP

   Vercel env:
   TWELVE_DATA_API_KEY
========================================================= */

const API_KEY = process.env.TWELVE_DATA_API_KEY;
const BASE_URL = "https://api.twelvedata.com";

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
   SETTINGS
========================================================= */

const EXECUTION_MINUTES = 5;
const HTF_MINUTES = 60;

const VOLUME_MA_LENGTH = 20;
const SPIKE_MULTIPLIER = 1.2;

const VP_ROWS = 40;

const MIN_STACKED_SPIKES = 3;

const RISK_REWARD = 3;

const OUTPUT_SIZE = 5000;

const BACKTEST_WARMUP_STATES = 30;

const RECENT_SIGNAL_LIMIT = 20;

const RECENT_BACKTEST_LIMIT = 15;


/* =========================================================
   HELPERS
========================================================= */

function n(value) {

  const out =
    Number(value);

  return Number.isFinite(out)
    ? out
    : null;

}


function round(
  value,
  digits = 2
) {

  const out =
    n(value);

  return out === null
    ? null
    : Number(
        out.toFixed(digits)
      );

}


function errText(value) {

  if (
    value == null
  ) {

    return "";

  }


  if (
    typeof value === "string"
  ) {

    return value;

  }


  if (
    value instanceof Error
  ) {

    return value.message ||
      String(value);

  }


  if (
    typeof value === "object"
  ) {

    if (
      typeof value.message === "string"
    ) {

      return value.message;

    }


    if (
      typeof value.error === "string"
    ) {

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
   TIME
========================================================= */

function parseTime(value) {

  if (
    !value
  ) {

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
  ) * size;

}


function minutesOld(value) {

  const ts =
    parseTime(value);


  return Number.isFinite(ts)

    ? Math.max(
        0,
        (
          Date.now() -
          ts
        )
        /
        60_000
      )

    : null;

}


/* =========================================================
   HTTP
========================================================= */

async function getJSON(
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

          headers: {

            Accept:
              "application/json"

          }

        }

      );


    const raw =
      await response.text();


    let data =
      {};


    if (
      raw
    ) {

      try {

        data =
          JSON.parse(raw);

      } catch {

        throw new Error(

          `Provider returned non-JSON HTTP ${response.status}: ${raw.slice(0, 250)}`

        );

      }

    }


    if (
      !response.ok ||
      data?.status === "error"
    ) {

      throw new Error(

        errText(
          data?.message
        )

        ||

        errText(
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
   FETCH 1M
========================================================= */

async function fetch1m(symbol) {

  if (
    !API_KEY
  ) {

    throw new Error(

      "TWELVE_DATA_API_KEY is missing in Vercel Environment Variables."

    );

  }


  const q =
    new URLSearchParams({

      symbol,

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
        API_KEY

    });


  const data =
    await getJSON(

      `${BASE_URL}/time_series?${q.toString()}`

    );


  if (
    !Array.isArray(
      data.values
    )
  ) {

    throw new Error(

      `${symbol}: no 1-minute candles returned.`

    );

  }


  const bars =

    data.values

      .map(
        v => ({

          time:
            String(
              v.datetime ||
              ""
            ),

          timestamp:
            parseTime(
              v.datetime
            ),

          open:
            Number(
              v.open
            ),

          high:
            Number(
              v.high
            ),

          low:
            Number(
              v.low
            ),

          close:
            Number(
              v.close
            ),

          volume:
            Number(
              v.volume
            )

        })
      )

      .filter(
        b =>

          Number.isFinite(
            b.timestamp
          )

          &&

          Number.isFinite(
            b.open
          )

          &&

          Number.isFinite(
            b.high
          )

          &&

          Number.isFinite(
            b.low
          )

          &&

          Number.isFinite(
            b.close
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

      `${symbol}: not enough 1-minute history.`

    );

  }


  return bars;

}


/* =========================================================
   COMPLETED 1M
========================================================= */

function completed1m(bars) {

  const now =
    Date.now();


  return bars.filter(
    b =>
      b.timestamp +
      60_000 <=
      now
  );

}


/* =========================================================
   VOLUME SMA + SPIKES
========================================================= */

function addVolumeStats(bars) {

  const out =
    [];


  let rolling =
    0;


  let usable =
    0;


  for (
    let i = 0;
    i < bars.length;
    i++
  ) {

    const vol =

      Number.isFinite(
        bars[i].volume
      )

      &&

      bars[i].volume >
      0

        ? bars[i].volume

        : null;


    if (
      vol !== null
    ) {

      usable++;

    }


    rolling +=
      vol ??
      0;


    if (
      i >=
      VOLUME_MA_LENGTH
    ) {

      const old =

        Number.isFinite(
          bars[
            i -
            VOLUME_MA_LENGTH
          ].volume
        )

        &&

        bars[
          i -
          VOLUME_MA_LENGTH
        ].volume >
        0

          ? bars[
              i -
              VOLUME_MA_LENGTH
            ].volume

          : 0;


      rolling -=
        old;

    }


    const volumeMA =

      i >=
      VOLUME_MA_LENGTH -
      1

        ? rolling /
          VOLUME_MA_LENGTH

        : null;


    out.push({

      ...bars[i],

      volumeMA,

      isSpike:

        vol !==
        null

        &&

        volumeMA !==
        null

        &&

        volumeMA >
        0

        &&

        vol >
        volumeMA *
        SPIKE_MULTIPLIER,

      delta:

        bars[i].close >=
        bars[i].open

          ? 1

          : -1

    });

  }


  return {

    bars:
      out,

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

function resample(
  bars,
  minutes
) {

  const map =
    new Map();


  const size =
    minutes *
    60_000;


  for (
    const b
    of bars
  ) {

    const start =
      bucketStart(
        b.timestamp,
        minutes
      );


    let g =
      map.get(
        start
      );


    if (
      !g
    ) {

      g = {

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
          b.open,

        high:
          b.high,

        low:
          b.low,

        close:
          b.close,

        volume:

          Number.isFinite(
            b.volume
          )

            ? b.volume

            : 0

      };


      map.set(
        start,
        g
      );

    } else {

      g.high =
        Math.max(
          g.high,
          b.high
        );


      g.low =
        Math.min(
          g.low,
          b.low
        );


      g.close =
        b.close;


      if (
        Number.isFinite(
          b.volume
        )
      ) {

        g.volume +=
          b.volume;

      }

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
   BUILD 1H ANCHOR
========================================================= */

function buildAnchor(
  oneMinuteBars,
  stateCloseTs
) {

  const start =
    bucketStart(
      stateCloseTs -
      1,
      HTF_MINUTES
    );


  const anchorBars =

    oneMinuteBars.filter(
      b =>
        b.timestamp >=
        start

        &&

        b.timestamp <
        stateCloseTs
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
    const b
    of anchorBars
  ) {

    high =
      Math.max(
        high,
        b.high
      );


    low =
      Math.min(
        low,
        b.low
      );


    close =
      b.close;

  }


  const spikes =

    anchorBars

      .filter(
        b =>
          b.isSpike
      )

      .map(
        b => ({

          time:
            b.time,

          timestamp:
            b.timestamp,

          price:
            b.close,

          volume:
            b.volume,

          volumeMA:
            b.volumeMA,

          delta:
            b.delta

        })
      );


  const bullSpikes =

    spikes.filter(
      s =>
        s.delta >
        0
    ).length;


  const bearSpikes =

    spikes.filter(
      s =>
        s.delta <
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
          i
        ) => ({

          index:
            i,

          low:
            low +
            i *
            step,

          high:
            low +
            (
              i +
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
      const b
      of anchorBars
    ) {

      let idx =
        Math.floor(

          (
            b.close -
            low
          )

          /

          step

        );


      idx =
        Math.max(
          0,
          Math.min(
            VP_ROWS -
            1,
            idx
          )
        );


      if (
        Number.isFinite(
          b.volume
        )

        &&

        b.volume >
        0
      ) {

        bins[idx].volume +=
          b.volume;

      }

    }


    /* SPIKES INTO ROWS */

    for (
      const s
      of spikes
    ) {

      let idx =
        Math.floor(

          (
            s.price -
            low
          )

          /

          step

        );


      idx =
        Math.max(
          0,
          Math.min(
            VP_ROWS -
            1,
            idx
          )
        );


      if (
        s.delta >
        0
      ) {

        bins[idx].bullCount++;

      } else {

        bins[idx].bearCount++;

      }

    }


    let maxProfileVol =
      0;


    for (
      const bin
      of bins
    ) {

      if (
        bin.volume >
        maxProfileVol
      ) {

        maxProfileVol =
          bin.volume;


        poc =

          (
            bin.low +
            bin.high
          )

          /
          2;

      }


      const bull =

        bin.bullCount >=
        MIN_STACKED_SPIKES

        &&

        bin.bullCount >
        bin.bearCount;


      const bear =

        bin.bearCount >=
        MIN_STACKED_SPIKES

        &&

        bin.bearCount >
        bin.bullCount;


      if (
        bull ||
        bear
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

            bull

              ? "BULLISH"

              : "BEARISH",

          strength:

            bull

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

          maxProfileVol >
          0

            ? bin.volume /
              maxProfileVol

            : 0

      });

    }

  }


  const strongestBullish =

    zones

      .filter(
        z =>
          z.direction ===
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

          b.bullCount -
          a.bullCount
      )[0]

    ||

    null;


  const strongestBearish =

    zones

      .filter(
        z =>
          z.direction ===
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

          b.bearCount -
          a.bearCount
      )[0]

    ||

    null;


  return {

    startTime:
      iso(
        start
      ),

    endTime:
      iso(
        stateCloseTs
      ),

    open,

    high,

    low,

    close,

    spikes,

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

    zones,

    strongestBullish,

    strongestBearish,

    profile,

    poc

  };

}


/* =========================================================
   SIGNAL ZONE
========================================================= */

function selectCrossedZone(
  previousClose,
  currentClose,
  anchor
) {

  if (
    !anchor

    ||

    !Number.isFinite(
      previousClose
    )

    ||

    !Number.isFinite(
      currentClose
    )
  ) {

    return null;

  }


  const buyCandidates =

    anchor.zones

      .filter(
        z =>

          z.direction ===
          "BULLISH"

          &&

          previousClose <=
          z.high

          &&

          currentClose >
          z.high
      )

      .sort(
        (
          a,
          b
        ) =>

          b.strength -
          a.strength

          ||

          b.high -
          a.high
      );


  const sellCandidates =

    anchor.zones

      .filter(
        z =>

          z.direction ===
          "BEARISH"

          &&

          previousClose >=
          z.low

          &&

          currentClose <
          z.low
      )

      .sort(
        (
          a,
          b
        ) =>

          b.strength -
          a.strength

          ||

          a.low -
          b.low
      );


  const buyAllowed =

    currentClose >
    previousClose

    &&

    anchor.close >=
    anchor.open;


  const sellAllowed =

    currentClose <
    previousClose

    &&

    anchor.close <=
    anchor.open;


  if (
    buyAllowed

    &&

    buyCandidates.length

    &&

    !sellCandidates.length
  ) {

    return {

      signal:
        "BUY",

      zone:
        buyCandidates[0]

    };

  }


  if (
    sellAllowed

    &&

    sellCandidates.length

    &&

    !buyCandidates.length
  ) {

    return {

      signal:
        "SELL",

      zone:
        sellCandidates[0]

    };

  }


  if (
    buyAllowed

    &&

    buyCandidates.length

    &&

    sellAllowed

    &&

    sellCandidates.length
  ) {

    return (

      buyCandidates[0].strength >=
      sellCandidates[0].strength

        ? {

            signal:
              "BUY",

            zone:
              buyCandidates[0]

          }

        : {

            signal:
              "SELL",

            zone:
              sellCandidates[0]

          }

    );

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
   BUILD ALL 5M STATES
========================================================= */

function buildStates(
  oneMinuteBars,
  fiveMinuteBars
) {

  const states =
    [];


  for (
    let i = 0;
    i < fiveMinuteBars.length;
    i++
  ) {

    const bar =
      fiveMinuteBars[i];


    const anchor =
      buildAnchor(
        oneMinuteBars,
        bar.closeTimestamp
      );


    const previousClose =

      i >
      0

        ? fiveMinuteBars[
            i -
            1
          ].close

        : null;


    const crossed =
      selectCrossedZone(

        previousClose,

        bar.close,

        anchor

      );


    let signal =
      crossed?.signal ||
      "WAIT";


    let zone =
      crossed?.zone ||
      null;


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


      plan =
        buildTradePlan(

          "WAIT",

          bar.close,

          null

        );

    }


    states.push({

      ...bar,

      previousClose,

      anchor,

      signal,

      zone,

      ...plan

    });

  }


  return states;

}


/* =========================================================
   RECENT SIGNALS
========================================================= */

function recentSignals(states) {

  return states

    .filter(
      s =>
        s.signal ===
        "BUY"

        ||

        s.signal ===
        "SELL"
    )

    .slice(
      -RECENT_SIGNAL_LIMIT
    )

    .reverse();

}


/* =========================================================
   SIMULATE TRADE ON 1M DATA
========================================================= */

function simulateTrade1m(
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
    const b
    of oneMinuteBars
  ) {

    if (
      b.timestamp <
      state.closeTimestamp
    ) {

      continue;

    }


    if (
      state.signal ===
      "BUY"
    ) {

      const stopHit =

        b.low <=
        state.stopLoss;


      const targetHit =

        b.high >=
        state.takeProfit;


      /*
         Conservative:
         if TP and SL both hit
         inside same 1M candle,
         SL wins.
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
          b.time;


        exitTimestamp =
          b.timestamp;


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
          b.time;


        exitTimestamp =
          b.timestamp;


        break;

      }

    }


    if (
      state.signal ===
      "SELL"
    ) {

      const stopHit =

        b.high >=
        state.stopLoss;


      const targetHit =

        b.low <=
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
          b.time;


        exitTimestamp =
          b.timestamp;


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
          b.time;


        exitTimestamp =
          b.timestamp;


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


  let i =

    Math.min(

      BACKTEST_WARMUP_STATES,

      Math.max(
        0,
        states.length -
        1
      )

    );


  while (
    i <
    states.length
  ) {

    const state =
      states[i];


    if (
      state.signal ===
      "WAIT"
    ) {

      i++;

      continue;

    }


    const sim =
      simulateTrade1m(

        oneMinuteBars,

        state

      );


    trades.push({

      signal:
        state.signal,

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
        sim.result,

      r:
        sim.r,

      exitPrice:
        sim.exitPrice,

      exitTime:
        sim.exitTime,

      exitTimestamp:
        sim.exitTimestamp,

      holdMinutes:
        sim.holdMinutes

    });


    /*
       Hard lock:
       no other signal while trade active.
    */

    if (
      sim.exitTimestamp ===
      null
    ) {

      break;

    }


    i++;


    while (

      i <
      states.length

      &&

      states[i].closeTimestamp <=
      sim.exitTimestamp

    ) {

      i++;

    }

  }


  const closed =

    trades.filter(
      t =>
        t.result ===
        "WIN"

        ||

        t.result ===
        "LOSS"
    );


  const wins =

    closed.filter(
      t =>
        t.result ===
        "WIN"
    );


  const losses =

    closed.filter(
      t =>
        t.result ===
        "LOSS"
    );


  const grossProfitR =

    wins.reduce(
      (
        s,
        t
      ) =>
        s +
        t.r,
      0
    );


  const grossLossR =

    Math.abs(

      losses.reduce(
        (
          s,
          t
        ) =>
          s +
          t.r,
        0
      )

    );


  const netR =

    closed.reduce(
      (
        s,
        t
      ) =>
        s +
        t.r,
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


  let lossStreak =
    0;


  let maxLossStreak =
    0;


  for (
    const t
    of closed
  ) {

    equity +=
      t.r;


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
      t.result ===
      "LOSS"
    ) {

      lossStreak++;


      maxLossStreak =
        Math.max(

          maxLossStreak,

          lossStreak

        );

    } else {

      lossStreak =
        0;

    }

  }


  const holdValues =

    closed

      .map(
        t =>
          t.holdMinutes
      )

      .filter(
        Number.isFinite
      );


  const avgHoldMinutes =

    holdValues.length

      ? holdValues.reduce(
          (
            s,
            v
          ) =>
            s +
            v,
          0
        )
        /
        holdValues.length

      : 0;


  return {

    mode:
      "HARD LOCK",

    strategy:
      "HTF Volume Spike + Stacked Imbalance",

    tradesTaken:
      trades.length,

    closedTrades:
      closed.length,

    openTrades:

      trades.filter(
        t =>
          t.result ===
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
        avgHoldMinutes,
        1
      ),

    firstCandle:
      states[0]?.time ??
      null,

    lastCandle:
      states.at(-1)?.closeTime ??
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
   LOCK QUERY
========================================================= */

function getRequestedLock(req) {

  const signal =
    String(
      req.query?.lockSignal ||
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
    n(
      req.query?.lockEntry
    );


  const stopLoss =
    n(
      req.query?.lockSL
    );


  const takeProfit =
    n(
      req.query?.lockTP
    );


  const time =
    String(
      req.query?.lockTime ||
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
   CHECK LIVE LOCK
========================================================= */

function checkRequestedLock(
  raw1m,
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


  for (
    const b
    of raw1m
  ) {

    if (
      b.timestamp <
      start
    ) {

      continue;

    }


    if (
      lock.signal ===
      "BUY"
    ) {

      if (
        b.low <=
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
            b.time

        };

      }


      if (
        b.high >=
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
            b.time

        };

      }

    } else {

      if (
        b.high >=
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
            b.time

        };

      }


      if (
        b.low <=
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
            b.time

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
   MAP ZONE
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
      zone.strength

  };

}


/* =========================================================
   MAP SIGNAL
========================================================= */

function mapTradeState(
  state,
  digits
) {

  return {

    signal:
      state.signal,

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
      state.anchor?.bullSpikes ??
      0,

    bearSpikes:
      state.anchor?.bearSpikes ??
      0,

    dominance:
      state.anchor?.dominance ??
      "BALANCED"

  };

}


/* =========================================================
   HANDLER
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


    /* =====================================================
       GET 1M
    ===================================================== */

    const raw1m =
      await fetch1m(
        symbol
      );


    const completed =
      completed1m(
        raw1m
      );


    const volumePacket =
      addVolumeStats(
        completed
      );


    const oneMinuteBars =
      volumePacket.bars;


    /* =====================================================
       BUILD 5M
    ===================================================== */

    const fiveMinuteBars =

      resample(
        oneMinuteBars,
        EXECUTION_MINUTES
      )

        .filter(
          b =>
            b.closeTimestamp <=
            Date.now()
        );


    if (
      fiveMinuteBars.length <
      40
    ) {

      throw new Error(

        `${symbol}: not enough completed 5-minute candles.`

      );

    }


    /* =====================================================
       STATES
    ===================================================== */

    const states =
      buildStates(

        oneMinuteBars,

        fiveMinuteBars

      );


    const current =
      states.at(-1);


    if (
      !current ||
      !current.anchor
    ) {

      throw new Error(

        `${symbol}: could not build current 1H anchor.`

      );

    }


    /* =====================================================
       SIGNAL
    ===================================================== */

    const signal =

      volumePacket.volumeAvailable

        ? current.signal

        : "WAIT";


    /* =====================================================
       BACKTEST
    ===================================================== */

    const bt =

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

          strategy:
            "HTF Volume Spike + Stacked Imbalance",

          unavailable:
            true,

          reason:
            "Provider did not return enough usable 1-minute volume data.",

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
            states[0]?.time ??
            null,

          lastCandle:
            current.closeTime,

          recentTrades:
            []

        };


    /* =====================================================
       LOCK
    ===================================================== */

    const lock =
      getRequestedLock(
        req
      );


    const lockCheck =
      checkRequestedLock(

        raw1m,

        lock

      );


    /* =====================================================
       LIVE PRICE
    ===================================================== */

    const livePrice =

      raw1m.at(-1)?.close

      ??

      current.close;


    /* =====================================================
       REASONS
    ===================================================== */

    const reasons =
      [];


    if (
      !volumePacket.volumeAvailable
    ) {

      reasons.push(

        "1-minute volume is unavailable or too sparse from the current provider."

      );


      reasons.push(

        "The engine stays on WAIT instead of inventing volume data."

      );

    } else if (
      signal ===
      "BUY"
    ) {

      reasons.push(

        "Bullish stacked imbalance detected inside the current 1H anchor."

      );


      reasons.push(

        "The completed 5M candle crossed above that bullish imbalance zone."

      );


      reasons.push(

        "The current 1H anchor is bullish/neutral-bullish."

      );


      reasons.push(

        "SL = bottom of the imbalance zone; TP = 3R."

      );

    } else if (
      signal ===
      "SELL"
    ) {

      reasons.push(

        "Bearish stacked imbalance detected inside the current 1H anchor."

      );


      reasons.push(

        "The completed 5M candle crossed below that bearish imbalance zone."

      );


      reasons.push(

        "The current 1H anchor is bearish/neutral-bearish."

      );


      reasons.push(

        "SL = top of the imbalance zone; TP = 3R."

      );

    } else {

      reasons.push(

        "No fresh 5M cross of a qualified stacked imbalance zone."

      );


      reasons.push(

        `Current 1H spike pressure: ${current.anchor.bullSpikes} bullish vs ${current.anchor.bearSpikes} bearish.`

      );

    }


    /* =====================================================
       SPIKE SCALE
    ===================================================== */

    const maxSpikeVolume =

      Math.max(

        0,

        ...current.anchor.spikes.map(
          s =>
            Number(
              s.volume
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
          "MKAYFX 5M HTF VOLUME IMBALANCE",

        sourceModel:
          "HTF Volume Spike & Imbalance Projection concept",

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

          riskReward:
            RISK_REWARD,

          hardLock:
            true

        },

        volume: {

          available:
            volumePacket.volumeAvailable,

          usableBars:
            volumePacket.usableVolumeBars,

          totalBars:
            oneMinuteBars.length

        },

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

          poc:
            round(
              current.anchor.poc,
              market.digits
            ),

          strongestBullish:
            mapZone(
              current.anchor.strongestBullish,
              market.digits
            ),

          strongestBearish:
            mapZone(
              current.anchor.strongestBearish,
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
              )

              .slice(
                0,
                12
              )

              .map(
                z =>
                  mapZone(
                    z,
                    market.digits
                  )
              ),

          profile:

            current.anchor.profile

              .map(
                p => ({

                  low:
                    round(
                      p.low,
                      market.digits
                    ),

                  high:
                    round(
                      p.high,
                      market.digits
                    ),

                  relative:
                    round(
                      p.relative,
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
                s => ({

                  time:
                    s.time,

                  price:
                    round(
                      s.price,
                      market.digits
                    ),

                  delta:
                    s.delta,

                  volume:
                    round(
                      s.volume,
                      2
                    ),

                  relative:

                    maxSpikeVolume >
                    0

                      ? round(
                          s.volume /
                          maxSpikeVolume,
                          4
                        )

                      : 0

                })
              )

        },

        reasons,

        lockCheck,

        recentSignals:

          volumePacket.volumeAvailable

            ?

            recentSignals(
              states
            )
              .map(
                s =>
                  mapTradeState(
                    s,
                    market.digits
                  )
              )

            :

            [],

        backtest: {

          ...bt,

          recentTrades:

            (
              bt.recentTrades ||
              []
            )

              .map(
                t => ({

                  ...t,

                  entry:
                    round(
                      t.entry,
                      market.digits
                    ),

                  stopLoss:
                    round(
                      t.stopLoss,
                      market.digits
                    ),

                  takeProfit:
                    round(
                      t.takeProfit,
                      market.digits
                    ),

                  risk:
                    round(
                      t.risk,
                      market.digits
                    ),

                  exitPrice:
                    round(
                      t.exitPrice,
                      market.digits
                    ),

                  zone:
                    mapZone(
                      t.zone,
                      market.digits
                    )

                })
              )

        },

        chart:

          fiveMinuteBars

            .slice(
              -180
            )

            .map(
              b => ({

                time:
                  b.time,

                closeTime:
                  b.closeTime,

                open:
                  round(
                    b.open,
                    market.digits
                  ),

                high:
                  round(
                    b.high,
                    market.digits
                  ),

                low:
                  round(
                    b.low,
                    market.digits
                  ),

                close:
                  round(
                    b.close,
                    market.digits
                  )

              })
            )

      });

  } catch (error) {

    console.error(

      "MKAYFX VOLUME IMBALANCE ERROR",

      error

    );


    return res
      .status(500)
      .json({

        success:
          false,

        engine:
          "MKAYFX 5M HTF VOLUME IMBALANCE",

        error:

          errText(
            error
          )

          ||

          "Unknown volume-imbalance engine error."

      });

  }

}