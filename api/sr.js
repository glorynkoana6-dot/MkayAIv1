/* =========================================================
   MKAYFX TOTT 5M ENGINE
   /api/sr.js

   SIGNAL ENGINE
   -------------
   Based on:
   Twin Optimized Trend Tracker (TOTT)

   Pine defaults used:
   Source                = close
   OTT Period            = 40
   Optimization Constant = 1.0
   Twin OTT Coefficient  = 0.001
   Moving Average Type   = VAR

   MARKETS
   -------
   XAU/USD
   BTC/USD

   TIMEFRAME
   ---------
   5 minutes

   SIGNALS
   -------
   BUY:
   MAvg crosses above OTTup[2]

   SELL:
   MAvg crosses below OTTdn[2]

   CUSTOM TRADE MANAGEMENT
   -----------------------
   BUY SL  = opposite TOTT lower band
   SELL SL = opposite TOTT upper band
   TP      = 3R

   HARD LOCK
   ---------
   Once a trade is active:
   - opposite signals are ignored
   - WAIT is ignored
   - trade stays locked until SL or TP

   BACKTEST
   --------
   One trade at a time.
   No overlapping trades.
   SL wins if TP + SL are both touched in one candle.

   ENV
   ---
   TWELVE_DATA_API_KEY
========================================================= */


const API_KEY =
  process.env.TWELVE_DATA_API_KEY;


const BASE_URL =
  "https://api.twelvedata.com";


/* =========================================================
   MARKETS
========================================================= */

const MARKETS = {

  "XAU/USD": {

    name:
      "GOLD",

    short:
      "XAU",

    digits:
      2

  },

  "BTC/USD": {

    name:
      "BITCOIN",

    short:
      "BTC",

    digits:
      2

  }

};


/* =========================================================
   TOTT SETTINGS
========================================================= */

const INTERVAL =
  "5min";


const OTT_PERIOD =
  40;


const OPTIMIZATION_PERCENT =
  1.0;


const TWIN_COEFFICIENT =
  0.001;


const MA_TYPE =
  "VAR";


const OTT_SHIFT =
  2;


/* =========================================================
   TRADE SETTINGS
========================================================= */

const RISK_REWARD =
  3;


const OUTPUT_SIZE =
  5000;


const WARMUP_BARS =
  100;


const RECENT_SIGNAL_LIMIT =
  20;


const RECENT_BACKTEST_LIMIT =
  15;


/* =========================================================
   HELPERS
========================================================= */

function num(
  value
) {

  const n =
    Number(
      value
    );


  return Number.isFinite(
    n
  )
    ? n
    : null;

}


function round(
  value,
  digits = 2
) {

  const n =
    num(
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


function safeError(
  value
) {

  if (
    value == null
  ) {

    return "";

  }


  if (
    typeof value ===
    "string"
  ) {

    return value;

  }


  if (
    value instanceof Error
  ) {

    return (
      value.message ||
      String(
        value
      )
    );

  }


  if (
    typeof value ===
    "object"
  ) {

    const nested =

      value.message

      ??

      value.error

      ??

      value.detail;


    if (
      nested !== undefined &&
      nested !== value
    ) {

      return safeError(
        nested
      );

    }


    try {

      return JSON.stringify(
        value
      );

    } catch {

      return String(
        value
      );

    }

  }


  return String(
    value
  );

}


/* =========================================================
   SYMBOL
========================================================= */

function normalizeSymbol(
  value
) {

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
    aliases[
      raw
    ]
    ||
    raw;


  return MARKETS[
    symbol
  ]
    ? symbol
    : "XAU/USD";

}


/* =========================================================
   TIME
========================================================= */

function parseTime(
  value
) {

  if (
    !value
  ) {

    return NaN;

  }


  const text =
    String(
      value
    )
      .trim()
      .replace(
        " ",
        "T"
      );


  return new Date(

    /Z$|[+-]\d\d:\d\d$/.test(
      text
    )

      ? text

      : `${text}Z`

  ).getTime();

}


function minutesOld(
  value
) {

  const timestamp =
    parseTime(
      value
    );


  if (
    !Number.isFinite(
      timestamp
    )
  ) {

    return null;

  }


  return Math.max(

    0,

    (
      Date.now() -
      timestamp
    )
    /
    60000

  );

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
          JSON.parse(
            raw
          );

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

  } catch (
    error
  ) {

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
   FETCH 5M CANDLES
========================================================= */

async function fetch5m(
  symbol
) {

  if (
    !API_KEY
  ) {

    throw new Error(

      "TWELVE_DATA_API_KEY is missing in Vercel Environment Variables."

    );

  }


  const query =
    new URLSearchParams({

      symbol,

      interval:
        INTERVAL,

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

      `${BASE_URL}/time_series?${query.toString()}`

    );


  if (
    !Array.isArray(
      data.values
    )
  ) {

    throw new Error(

      `${symbol}: no 5-minute candles returned.`

    );

  }


  const bars =

    data.values

      .map(
        item => ({

          time:
            String(
              item.datetime ||
              ""
            ),

          open:
            Number(
              item.open
            ),

          high:
            Number(
              item.high
            ),

          low:
            Number(
              item.low
            ),

          close:
            Number(
              item.close
            )

        })
      )

      .filter(
        bar =>

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

          parseTime(
            a.time
          )

          -

          parseTime(
            b.time
          )
      );


  if (
    bars.length <
    150
  ) {

    throw new Error(

      `${symbol}: not enough 5-minute candles returned.`

    );

  }


  return bars;

}


/* =========================================================
   COMPLETED CANDLES

   TOTT signals should be generated from finished 5M bars.
========================================================= */

function completedBars(
  bars
) {

  const now =
    Date.now();


  return bars.filter(
    bar => {

      const start =
        parseTime(
          bar.time
        );


      if (
        !Number.isFinite(
          start
        )
      ) {

        return false;

      }


      return (

        start +
        5 * 60 * 1000

      )
      <=
      now;

    }
  );

}


/* =========================================================
   VAR MOVING AVERAGE

   Pine:

   valpha = 2 / (length + 1)

   vud1 =
       src > src[1]
       ? src - src[1]
       : 0

   vdd1 =
       src < src[1]
       ? src[1] - src
       : 0

   vUD = math.sum(vud1, 9)
   vDD = math.sum(vdd1, 9)

   vCMO =
       nz(
         (vUD - vDD)
         /
         (vUD + vDD)
       )

   VAR :=
       valpha
       * abs(vCMO)
       * src

       +

       (
         1 -
         valpha
         * abs(vCMO)
       )
       * nz(VAR[1])
========================================================= */

function varSeries(
  values,
  length
) {

  const result =
    new Array(
      values.length
    ).fill(
      0
    );


  const ups =
    new Array(
      values.length
    ).fill(
      0
    );


  const downs =
    new Array(
      values.length
    ).fill(
      0
    );


  const alpha =
    2 /
    (
      length +
      1
    );


  let sumUp =
    0;


  let sumDown =
    0;


  for (
    let i = 0;

    i <
      values.length;

    i++
  ) {

    if (
      i >
      0
    ) {

      const difference =

        values[i]

        -

        values[
          i - 1
        ];


      if (
        difference >
        0
      ) {

        ups[i] =
          difference;

      } else if (
        difference <
        0
      ) {

        downs[i] =
          Math.abs(
            difference
          );

      }

    }


    sumUp +=
      ups[i];


    sumDown +=
      downs[i];


    if (
      i >=
      9
    ) {

      sumUp -=
        ups[
          i - 9
        ];


      sumDown -=
        downs[
          i - 9
        ];

    }


    let cmo =
      0;


    /*
       math.sum(..., 9) effectively
       requires a 9-value window.
    */

    if (
      i >=
      8
    ) {

      const denominator =
        sumUp +
        sumDown;


      if (
        denominator !==
        0
      ) {

        cmo =

          (
            sumUp -
            sumDown
          )

          /

          denominator;

      }

    }


    const weighting =

      alpha

      *

      Math.abs(
        cmo
      );


    const previous =

      i >
      0

        ? result[
            i - 1
          ]

        : 0;


    result[i] =

      weighting *
      values[i]

      +

      (
        1 -
        weighting
      )
      *
      previous;

  }


  return result;

}


/* =========================================================
   BUILD TOTT SERIES
========================================================= */

function buildTottStates(
  bars
) {

  const source =
    bars.map(
      bar =>
        bar.close
    );


  const mavg =
    varSeries(
      source,
      OTT_PERIOD
    );


  const longStop =
    new Array(
      bars.length
    ).fill(
      null
    );


  const shortStop =
    new Array(
      bars.length
    ).fill(
      null
    );


  const direction =
    new Array(
      bars.length
    ).fill(
      1
    );


  const ott =
    new Array(
      bars.length
    ).fill(
      null
    );


  const ottUp =
    new Array(
      bars.length
    ).fill(
      null
    );


  const ottDown =
    new Array(
      bars.length
    ).fill(
      null
    );


  const states =
    [];


  for (
    let i = 0;

    i <
      bars.length;

    i++
  ) {

    const ma =
      mavg[i];


    /*
       fark =
         MAvg
         * percent
         * 0.01
    */

    const difference =

      ma

      *

      OPTIMIZATION_PERCENT

      *

      0.01;


    const rawLongStop =
      ma -
      difference;


    const rawShortStop =
      ma +
      difference;


    /*
       longStopPrev =
         nz(
           longStop[1],
           longStop
         )
    */

    const longStopPrevious =

      i >
      0

        ? longStop[
            i - 1
          ]

        : rawLongStop;


    /*
       longStop :=
         MAvg > longStopPrev
         ? max(longStop, longStopPrev)
         : longStop
    */

    longStop[i] =

      ma >
      longStopPrevious

        ? Math.max(
            rawLongStop,
            longStopPrevious
          )

        : rawLongStop;


    const shortStopPrevious =

      i >
      0

        ? shortStop[
            i - 1
          ]

        : rawShortStop;


    shortStop[i] =

      ma <
      shortStopPrevious

        ? Math.min(
            rawShortStop,
            shortStopPrevious
          )

        : rawShortStop;


    const previousDirection =

      i >
      0

        ? direction[
            i - 1
          ]

        : 1;


    let currentDirection =
      previousDirection;


    if (

      previousDirection ===
      -1

      &&

      ma >
      shortStopPrevious

    ) {

      currentDirection =
        1;

    } else if (

      previousDirection ===
      1

      &&

      ma <
      longStopPrevious

    ) {

      currentDirection =
        -1;

    }


    direction[i] =
      currentDirection;


    const mt =

      currentDirection ===
      1

        ? longStop[i]

        : shortStop[i];


    /*
       OTT =
         MAvg > MT
         ? MT * (200 + percent) / 200
         : MT * (200 - percent) / 200
    */

    ott[i] =

      ma >
      mt

        ?

        mt

        *

        (
          200 +
          OPTIMIZATION_PERCENT
        )

        /

        200

        :

        mt

        *

        (
          200 -
          OPTIMIZATION_PERCENT
        )

        /

        200;


    ottUp[i] =

      ott[i]

      *

      (
        1 +
        TWIN_COEFFICIENT
      );


    ottDown[i] =

      ott[i]

      *

      (
        1 -
        TWIN_COEFFICIENT
      );


    /*
       Pine plots and signals use:
       OTTup[2]
       OTTdn[2]
    */

    const shiftedUpper =

      i >=
      OTT_SHIFT

        ? ottUp[
            i -
            OTT_SHIFT
          ]

        : null;


    const shiftedLower =

      i >=
      OTT_SHIFT

        ? ottDown[
            i -
            OTT_SHIFT
          ]

        : null;


    let buySignal =
      false;


    let sellSignal =
      false;


    /*
       ta.crossover(
         MAvg,
         OTTup[2]
       )

       Current:
       MAvg > OTTup[2]

       Previous:
       MAvg[1] <= OTTup[3]
    */

    if (
      i >=
      OTT_SHIFT + 1
    ) {

      const previousMA =
        mavg[
          i - 1
        ];


      const previousShiftedUpper =

        ottUp[
          i -
          OTT_SHIFT -
          1
        ];


      const previousShiftedLower =

        ottDown[
          i -
          OTT_SHIFT -
          1
        ];


      buySignal =

        ma >
        shiftedUpper

        &&

        previousMA <=
        previousShiftedUpper;


      sellSignal =

        ma <
        shiftedLower

        &&

        previousMA >=
        previousShiftedLower;

    }


    states.push({

      index:
        i,

      time:
        bars[i].time,

      open:
        bars[i].open,

      high:
        bars[i].high,

      low:
        bars[i].low,

      close:
        bars[i].close,

      mavg:
        ma,

      longStop:
        longStop[i],

      shortStop:
        shortStop[i],

      direction:
        currentDirection,

      ott:
        ott[i],

      ottUpper:
        shiftedUpper,

      ottLower:
        shiftedLower,

      buySignal,

      sellSignal,

      signal:

        buySignal

          ? "BUY"

          : sellSignal

            ? "SELL"

            : "WAIT"

    });

  }


  return states;

}


/* =========================================================
   CUSTOM TRADE PLAN

   We use the OPPOSITE Twin OTT band as the stop.

   BUY:
     Entry = signal close
     SL    = OTT lower
     TP    = Entry + 3R

   SELL:
     Entry = signal close
     SL    = OTT upper
     TP    = Entry - 3R
========================================================= */

function tradePlan(
  state
) {

  if (
    !state
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


  const signal =
    state.signal;


  let entry =
    null;


  let stopLoss =
    null;


  let takeProfit =
    null;


  let risk =
    null;


  if (
    signal ===
    "BUY"
  ) {

    entry =
      state.close;


    stopLoss =
      state.ottLower;


    if (
      Number.isFinite(
        entry
      )

      &&

      Number.isFinite(
        stopLoss
      )
    ) {

      risk =
        entry -
        stopLoss;


      if (
        risk >
        0
      ) {

        takeProfit =

          entry

          +

          risk *
          RISK_REWARD;

      }

    }

  }


  if (
    signal ===
    "SELL"
  ) {

    entry =
      state.close;


    stopLoss =
      state.ottUpper;


    if (
      Number.isFinite(
        entry
      )

      &&

      Number.isFinite(
        stopLoss
      )
    ) {

      risk =
        stopLoss -
        entry;


      if (
        risk >
        0
      ) {

        takeProfit =

          entry

          -

          risk *
          RISK_REWARD;

      }

    }

  }


  const valid =

    signal !==
    "WAIT"

    &&

    Number.isFinite(
      entry
    )

    &&

    Number.isFinite(
      stopLoss
    )

    &&

    Number.isFinite(
      takeProfit
    )

    &&

    Number.isFinite(
      risk
    )

    &&

    risk >
    0;


  return {

    valid,

    entry:
      valid
        ? entry
        : null,

    stopLoss:
      valid
        ? stopLoss
        : null,

    takeProfit:
      valid
        ? takeProfit
        : null,

    risk:
      valid
        ? risk
        : null,

    rr:
      RISK_REWARD

  };

}


/* =========================================================
   CURRENT ANALYSIS
========================================================= */

function analyse(
  bars
) {

  const states =
    buildTottStates(
      bars
    );


  const current =
    states.at(-1);


  const plan =
    tradePlan(
      current
    );


  return {

    ...current,

    ...plan,

    states

  };

}


/* =========================================================
   RECENT SIGNALS
========================================================= */

function recentSignals(
  states,
  limit =
    RECENT_SIGNAL_LIMIT
) {

  const signals =
    [];


  for (
    let i =
      WARMUP_BARS;

    i <
      states.length;

    i++
  ) {

    const state =
      states[i];


    if (
      state.signal ===
      "WAIT"
    ) {

      continue;

    }


    const plan =
      tradePlan(
        state
      );


    if (
      !plan.valid
    ) {

      continue;

    }


    signals.push({

      signal:
        state.signal,

      time:
        state.time,

      entry:
        plan.entry,

      stopLoss:
        plan.stopLoss,

      takeProfit:
        plan.takeProfit,

      risk:
        plan.risk,

      rr:
        plan.rr,

      mavg:
        state.mavg,

      ottUpper:
        state.ottUpper,

      ottLower:
        state.ottLower

    });

  }


  return signals
    .slice(
      -limit
    )
    .reverse();

}


/* =========================================================
   SIMULATE LOCKED TRADE
========================================================= */

function simulateTrade(
  bars,
  signalIndex,
  signal,
  plan
) {

  let result =
    "OPEN";


  let resultR =
    null;


  let exitPrice =
    null;


  let exitTime =
    null;


  let exitIndex =
    null;


  /*
     Entry occurs at signal candle close.

     Therefore TP/SL testing starts
     on the NEXT candle.
  */

  for (
    let i =
      signalIndex +
      1;

    i <
      bars.length;

    i++
  ) {

    const candle =
      bars[i];


    if (
      signal ===
      "BUY"
    ) {

      const stopHit =

        candle.low <=
        plan.stopLoss;


      const targetHit =

        candle.high >=
        plan.takeProfit;


      /*
         Conservative rule:
         if both TP and SL occurred
         inside one candle, count SL.
      */

      if (
        stopHit
      ) {

        result =
          "LOSS";


        resultR =
          -1;


        exitPrice =
          plan.stopLoss;


        exitTime =
          candle.time;


        exitIndex =
          i;


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
          plan.takeProfit;


        exitTime =
          candle.time;


        exitIndex =
          i;


        break;

      }

    }


    if (
      signal ===
      "SELL"
    ) {

      const stopHit =

        candle.high >=
        plan.stopLoss;


      const targetHit =

        candle.low <=
        plan.takeProfit;


      if (
        stopHit
      ) {

        result =
          "LOSS";


        resultR =
          -1;


        exitPrice =
          plan.stopLoss;


        exitTime =
          candle.time;


        exitIndex =
          i;


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
          plan.takeProfit;


        exitTime =
          candle.time;


        exitIndex =
          i;


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

    exitIndex,

    holdBars:

      exitIndex ===
      null

        ? bars.length -
          1 -
          signalIndex

        : exitIndex -
          signalIndex

  };

}


/* =========================================================
   HARD-LOCK BACKTEST
========================================================= */

function backtest(
  bars,
  states
) {

  const trades =
    [];


  let index =
    Math.max(
      WARMUP_BARS,
      OTT_PERIOD + 20
    );


  while (
    index <
    states.length -
    1
  ) {

    const state =
      states[
        index
      ];


    if (
      state.signal ===
      "WAIT"
    ) {

      index++;

      continue;

    }


    const plan =
      tradePlan(
        state
      );


    if (
      !plan.valid
    ) {

      index++;

      continue;

    }


    const simulation =
      simulateTrade(

        bars,

        index,

        state.signal,

        plan

      );


    trades.push({

      signal:
        state.signal,

      entryTime:
        state.time,

      entry:
        plan.entry,

      stopLoss:
        plan.stopLoss,

      takeProfit:
        plan.takeProfit,

      risk:
        plan.risk,

      rr:
        plan.rr,

      result:
        simulation.result,

      r:
        simulation.r,

      exitPrice:
        simulation.exitPrice,

      exitTime:
        simulation.exitTime,

      exitIndex:
        simulation.exitIndex,

      holdBars:
        simulation.holdBars

    });


    /*
       HARD LOCK.

       No new BUY / SELL signal is taken
       while this trade is active.
    */

    if (
      simulation.exitIndex !==
      null
    ) {

      index =
        simulation.exitIndex +
        1;

    } else {

      break;

    }

  }


  const closedTrades =

    trades.filter(
      trade =>
        trade.result ===
        "WIN"

        ||

        trade.result ===
        "LOSS"
    );


  const openTrades =

    trades.filter(
      trade =>
        trade.result ===
        "OPEN"
    );


  const wins =

    closedTrades.filter(
      trade =>
        trade.result ===
        "WIN"
    );


  const losses =

    closedTrades.filter(
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

    closedTrades.reduce(
      (
        total,
        trade
      ) =>
        total +
        trade.r,
      0
    );


  const winRate =

    closedTrades.length

      ?

      wins.length /
      closedTrades.length *
      100

      :

      0;


  const expectancyR =

    closedTrades.length

      ?

      netR /
      closedTrades.length

      :

      0;


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


  let maxDrawdown =
    0;


  let currentLossStreak =
    0;


  let maxLossStreak =
    0;


  for (
    const trade
    of closedTrades
  ) {

    equity +=
      trade.r;


    peak =
      Math.max(
        peak,
        equity
      );


    maxDrawdown =
      Math.max(

        maxDrawdown,

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


  const averageHoldBars =

    closedTrades.length

      ?

      closedTrades.reduce(
        (
          total,
          trade
        ) =>
          total +
          trade.holdBars,
        0
      )

      /

      closedTrades.length

      :

      0;


  return {

    mode:
      "HARD LOCK",

    strategy:
      "TOTT",

    timeframe:
      "5min",

    maType:
      MA_TYPE,

    period:
      OTT_PERIOD,

    percent:
      OPTIMIZATION_PERCENT,

    coefficient:
      TWIN_COEFFICIENT,

    targetR:
      RISK_REWARD,

    barsTested:
      bars.length,

    firstCandle:
      bars[0]?.time ??
      null,

    lastCandle:
      bars.at(-1)?.time ??
      null,

    signalsTaken:
      trades.length,

    closedTrades:
      closedTrades.length,

    openTrades:
      openTrades.length,

    wins:
      wins.length,

    losses:
      losses.length,

    winRate:
      round(
        winRate,
        1
      ),

    grossProfitR:
      round(
        grossProfitR,
        2
      ),

    grossLossR:
      round(
        grossLossR,
        2
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
        maxDrawdown,
        2
      ),

    maxLossStreak,

    averageHoldBars:
      round(
        averageHoldBars,
        1
      ),

    averageHoldMinutes:
      round(
        averageHoldBars *
        5,
        1
      ),

    recentTrades:

      trades
        .slice(
          -RECENT_BACKTEST_LIMIT
        )
        .reverse()

  };

}


/* =========================================================
   OPTIONAL FRONTEND HARD LOCK CHECK

   Frontend sends:
   lockSignal
   lockEntry
   lockSL
   lockTP
   lockTime

   This allows the server to check the full fetched
   history instead of only the chart window.
========================================================= */

function getRequestedLock(
  req
) {

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
      req.query?.lockTime ||
      ""
    );


  if (
    entry === null ||
    stopLoss === null ||
    takeProfit === null ||
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
   CHECK LIVE HARD LOCK
========================================================= */

function checkRequestedLock(
  bars,
  lock
) {

  if (
    !lock
  ) {

    return null;

  }


  const startTime =
    parseTime(
      lock.time
    );


  if (
    !Number.isFinite(
      startTime
    )
  ) {

    return {

      status:
        "ACTIVE"

    };

  }


  for (
    const candle
    of bars
  ) {

    const candleTime =
      parseTime(
        candle.time
      );


    /*
       Entry occurs at signal candle close,
       so never test that same candle.
    */

    if (
      !Number.isFinite(
        candleTime
      )

      ||

      candleTime <=
      startTime
    ) {

      continue;

    }


    if (
      lock.signal ===
      "BUY"
    ) {

      const stopHit =

        candle.low <=
        lock.stopLoss;


      const targetHit =

        candle.high >=
        lock.takeProfit;


      if (
        stopHit
      ) {

        return {

          status:
            "LOSS",

          resultR:
            -1,

          exitPrice:
            lock.stopLoss,

          exitTime:
            candle.time

        };

      }


      if (
        targetHit
      ) {

        return {

          status:
            "WIN",

          resultR:
            RISK_REWARD,

          exitPrice:
            lock.takeProfit,

          exitTime:
            candle.time

        };

      }

    }


    if (
      lock.signal ===
      "SELL"
    ) {

      const stopHit =

        candle.high >=
        lock.stopLoss;


      const targetHit =

        candle.low <=
        lock.takeProfit;


      if (
        stopHit
      ) {

        return {

          status:
            "LOSS",

          resultR:
            -1,

          exitPrice:
            lock.stopLoss,

          exitTime:
            candle.time

        };

      }


      if (
        targetHit
      ) {

        return {

          status:
            "WIN",

          resultR:
            RISK_REWARD,

          exitPrice:
            lock.takeProfit,

          exitTime:
            candle.time

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
   API HANDLER
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


    /*
       Raw bars include the current
       forming candle.

       They are useful for checking
       TP / SL intrabar.
    */

    const rawBars =
      await fetch5m(
        symbol
      );


    /*
       TOTT signals only use
       completed 5M candles.
    */

    const bars =
      completedBars(
        rawBars
      );


    if (
      bars.length <
      150
    ) {

      throw new Error(

        `${symbol}: not enough completed 5M candles.`

      );

    }


    const analysis =
      analyse(
        bars
      );


    const recent =
      recentSignals(
        analysis.states
      );


    const bt =
      backtest(
        bars,
        analysis.states
      );


    const requestedLock =
      getRequestedLock(
        req
      );


    const lockCheck =
      checkRequestedLock(

        rawBars,

        requestedLock

      );


    /*
       Latest raw close is used as
       current market price.

       Signal itself still comes from
       completed candle.
    */

    const liveBar =
      rawBars.at(-1);


    const currentPrice =
      liveBar?.close ??
      analysis.close;


    const candleAge =
      minutesOld(
        analysis.time
      );


    return res
      .status(200)
      .json({

        success:
          true,

        engine:
          "MKAYFX TOTT 5M HARD LOCK",

        strategy:
          "Twin Optimized Trend Tracker",

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

        settings: {

          source:
            "close",

          maType:
            MA_TYPE,

          ottPeriod:
            OTT_PERIOD,

          optimizationConstant:
            OPTIMIZATION_PERCENT,

          twinCoefficient:
            TWIN_COEFFICIENT,

          ottShift:
            OTT_SHIFT,

          riskReward:
            RISK_REWARD,

          hardLock:
            true

        },

        signal:
          analysis.signal,

        signalTime:
          analysis.time,

        candleTime:
          analysis.time,

        candleAgeMinutes:
          round(
            candleAge,
            1
          ),

        price:
          round(
            currentPrice,
            market.digits
          ),

        signalClose:
          round(
            analysis.close,
            market.digits
          ),

        direction:

          analysis.direction ===
          1

            ? "UP"

            : "DOWN",

        mavg:
          round(
            analysis.mavg,
            market.digits
          ),

        ott:
          round(
            analysis.ott,
            market.digits
          ),

        ottUpper:
          round(
            analysis.ottUpper,
            market.digits
          ),

        ottLower:
          round(
            analysis.ottLower,
            market.digits
          ),

        entry:
          round(
            analysis.entry,
            market.digits
          ),

        stopLoss:
          round(
            analysis.stopLoss,
            market.digits
          ),

        takeProfit:
          round(
            analysis.takeProfit,
            market.digits
          ),

        risk:
          round(
            analysis.risk,
            market.digits
          ),

        rr:
          analysis.rr,

        lockCheck,

        reasons:

          analysis.signal ===
          "BUY"

            ? [

                "VAR crossed above the shifted upper TOTT line.",
                "BUY signal generated from the TOTT strategy.",
                "Stop Loss uses the opposite lower TOTT band.",
                "Take Profit is stretched to 3R.",
                "Once locked, later WAIT or SELL signals are ignored until exit."

              ]

            : analysis.signal ===
              "SELL"

              ? [

                  "VAR crossed below the shifted lower TOTT line.",
                  "SELL signal generated from the TOTT strategy.",
                  "Stop Loss uses the opposite upper TOTT band.",
                  "Take Profit is stretched to 3R.",
                  "Once locked, later WAIT or BUY signals are ignored until exit."

                ]

              : [

                  "No new TOTT crossover on the latest completed 5M candle."

                ],

        recentSignals:

          recent.map(
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

              mavg:
                round(
                  trade.mavg,
                  market.digits
                ),

              ottUpper:
                round(
                  trade.ottUpper,
                  market.digits
                ),

              ottLower:
                round(
                  trade.ottLower,
                  market.digits
                )

            })
          ),

        backtest: {

          ...bt,

          recentTrades:

            bt.recentTrades.map(
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
                  )

              })
            )

        },

        chart:

          analysis.states
            .slice(
              -180
            )
            .map(
              state => ({

                time:
                  state.time,

                open:
                  round(
                    state.open,
                    market.digits
                  ),

                high:
                  round(
                    state.high,
                    market.digits
                  ),

                low:
                  round(
                    state.low,
                    market.digits
                  ),

                close:
                  round(
                    state.close,
                    market.digits
                  ),

                mavg:
                  round(
                    state.mavg,
                    market.digits
                  ),

                ottUpper:
                  round(
                    state.ottUpper,
                    market.digits
                  ),

                ottLower:
                  round(
                    state.ottLower,
                    market.digits
                  ),

                signal:
                  state.signal

              })
            )

      });

  } catch (
    error
  ) {

    console.error(

      "MKAYFX TOTT ERROR",

      error

    );


    return res
      .status(500)
      .json({

        success:
          false,

        engine:
          "MKAYFX TOTT 5M HARD LOCK",

        error:

          safeError(
            error
          )

          ||

          "Unknown TOTT engine error."

      });

  }

}