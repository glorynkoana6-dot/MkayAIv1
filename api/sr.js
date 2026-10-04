/* =========================================================
   MKAYFX MULTI-ASSET 5M S&R ENGINE V3
   /api/sr.js

   MARKETS
   -------
   XAU/USD
   BTC/USD

   STRATEGY
   --------
   Timeframe         = 5M
   Pivot Lookback    = 9
   Max Active Levels = 5

   BUY
   ---
   Close crosses ABOVE newest confirmed pivot support.

   SELL
   ----
   Close crosses BELOW newest confirmed pivot resistance.

   TRADE PLAN
   ----------
   Entry = signal candle close

   BUY:
   SL = newest support
   TP = 3R

   SELL:
   SL = newest resistance
   TP = 3R

   HARD-LOCK BACKTEST
   ------------------
   - One trade at a time
   - Ignore all new signals while a trade is active
   - Trade remains active until SL or TP
   - Next signal can only be taken after exit
   - If SL + TP touch same candle, SL wins conservatively

   NO EXTRA INDICATORS
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
   SETTINGS
========================================================= */

const INTERVAL =
  "15min";


const LENGTH =
  11;


const MAX_LEVELS =
  5;


const SHOW_ZONES =
  true;


/*
   TP STRETCHED FROM 2R TO 3R
*/
const RISK_REWARD =
  3;


const OUTPUT_SIZE =
  5000;


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
    LENGTH * 2 + 10
  ) {

    throw new Error(

      `${symbol}: not enough 5-minute candles returned.`

    );

  }


  return bars;

}


/* =========================================================
   PIVOT LOW
========================================================= */

function isPivotLow(
  bars,
  center,
  length
) {

  if (
    center - length < 0 ||
    center + length >= bars.length
  ) {

    return false;

  }


  const price =
    bars[
      center
    ].low;


  for (
    let i =
      center - length;

    i <=
      center + length;

    i++
  ) {

    if (
      i === center
    ) {

      continue;

    }


    if (
      bars[i].low <
      price
    ) {

      return false;

    }

  }


  return true;

}


/* =========================================================
   PIVOT HIGH
========================================================= */

function isPivotHigh(
  bars,
  center,
  length
) {

  if (
    center - length < 0 ||
    center + length >= bars.length
  ) {

    return false;

  }


  const price =
    bars[
      center
    ].high;


  for (
    let i =
      center - length;

    i <=
      center + length;

    i++
  ) {

    if (
      i === center
    ) {

      continue;

    }


    if (
      bars[i].high >
      price
    ) {

      return false;

    }

  }


  return true;

}


/* =========================================================
   BUILD S&R STATES
========================================================= */

function buildStates(
  bars
) {

  const supports =
    [];


  const resistances =
    [];


  const states =
    [];


  for (
    let currentIndex = 0;

    currentIndex <
      bars.length;

    currentIndex++
  ) {

    const center =
      currentIndex -
      LENGTH;


    /* RESISTANCE */

    if (
      center >= LENGTH &&
      isPivotHigh(
        bars,
        center,
        LENGTH
      )
    ) {

      resistances.unshift(

        bars[
          center
        ].high

      );


      if (
        resistances.length >
        MAX_LEVELS
      ) {

        resistances.pop();

      }

    }


    /* SUPPORT */

    if (
      center >= LENGTH &&
      isPivotLow(
        bars,
        center,
        LENGTH
      )
    ) {

      supports.unshift(

        bars[
          center
        ].low

      );


      if (
        supports.length >
        MAX_LEVELS
      ) {

        supports.pop();

      }

    }


    const nearestSupport =

      supports.length

        ? supports[0]

        : null;


    const nearestResistance =

      resistances.length

        ? resistances[0]

        : null;


    states.push({

      index:
        currentIndex,

      time:
        bars[
          currentIndex
        ].time,

      close:
        bars[
          currentIndex
        ].close,

      nearestSupport,

      nearestResistance,

      supports:
        [
          ...supports
        ],

      resistances:
        [
          ...resistances
        ]

    });

  }


  return states;

}


/* =========================================================
   BUY CROSSOVER
========================================================= */

function supportCrossover(
  previous,
  current
) {

  if (
    !previous ||
    !current
  ) {

    return false;

  }


  if (
    previous.nearestSupport === null ||
    current.nearestSupport === null
  ) {

    return false;

  }


  return (

    current.close >
    current.nearestSupport

    &&

    previous.close <=
    previous.nearestSupport

  );

}


/* =========================================================
   SELL CROSSUNDER
========================================================= */

function resistanceCrossunder(
  previous,
  current
) {

  if (
    !previous ||
    !current
  ) {

    return false;

  }


  if (
    previous.nearestResistance === null ||
    current.nearestResistance === null
  ) {

    return false;

  }


  return (

    current.close <
    current.nearestResistance

    &&

    previous.close >=
    previous.nearestResistance

  );

}


/* =========================================================
   SIGNAL
========================================================= */

function signalAt(
  previous,
  current
) {

  if (
    supportCrossover(
      previous,
      current
    )
  ) {

    return "BUY";

  }


  if (
    resistanceCrossunder(
      previous,
      current
    )
  ) {

    return "SELL";

  }


  return "WAIT";

}


/* =========================================================
   ENTRY / SL / STRETCHED TP
========================================================= */

function tradePlan(
  signal,
  state
) {

  let entry =
    null;


  let stopLoss =
    null;


  let takeProfit =
    null;


  let risk =
    null;


  if (
    signal === "BUY" &&
    state.nearestSupport !== null
  ) {

    entry =
      state.close;


    stopLoss =
      state.nearestSupport;


    risk =
      entry -
      stopLoss;


    if (
      risk > 0
    ) {

      takeProfit =

        entry

        +

        risk *
        RISK_REWARD;

    }

  }


  if (
    signal === "SELL" &&
    state.nearestResistance !== null
  ) {

    entry =
      state.close;


    stopLoss =
      state.nearestResistance;


    risk =
      stopLoss -
      entry;


    if (
      risk > 0
    ) {

      takeProfit =

        entry

        -

        risk *
        RISK_REWARD;

    }

  }


  const valid =

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
    buildStates(
      bars
    );


  const current =
    states.at(-1);


  const previous =
    states.at(-2);


  const signal =
    signalAt(
      previous,
      current
    );


  const plan =
    tradePlan(
      signal,
      current
    );


  return {

    signal,

    buySignal:
      signal === "BUY",

    sellSignal:
      signal === "SELL",

    ...plan,

    nearestSupport:
      current.nearestSupport,

    nearestResistance:
      current.nearestResistance,

    supports:
      current.supports,

    resistances:
      current.resistances,

    currentClose:
      current.close,

    previousClose:
      previous?.close ??
      null,

    currentTime:
      current.time

  };

}


/* =========================================================
   RECENT SIGNALS
========================================================= */

function recentSignals(
  bars,
  limit =
    RECENT_SIGNAL_LIMIT
) {

  const states =
    buildStates(
      bars
    );


  const signals =
    [];


  for (
    let i = 1;

    i <
      states.length;

    i++
  ) {

    const previous =
      states[
        i - 1
      ];


    const current =
      states[
        i
      ];


    const signal =
      signalAt(
        previous,
        current
      );


    if (
      signal === "WAIT"
    ) {

      continue;

    }


    const plan =
      tradePlan(
        signal,
        current
      );


    if (
      !plan.valid
    ) {

      continue;

    }


    signals.push({

      signal,

      time:
        current.time,

      price:
        current.close,

      level:

        signal === "BUY"

          ? current.nearestSupport

          : current.nearestResistance,

      entry:
        plan.entry,

      stopLoss:
        plan.stopLoss,

      takeProfit:
        plan.takeProfit,

      risk:
        plan.risk,

      rr:
        plan.rr

    });

  }


  return signals
    .slice(
      -limit
    )
    .reverse();

}


/* =========================================================
   SIMULATE HARD-LOCKED TRADE
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
     Signal entry happens at signal candle close.
     Therefore exit checking begins on NEXT candle.
  */

  for (
    let j =
      signalIndex + 1;

    j <
      bars.length;

    j++
  ) {

    const candle =
      bars[
        j
      ];


    if (
      signal === "BUY"
    ) {

      const stopHit =

        candle.low <=
        plan.stopLoss;


      const targetHit =

        candle.high >=
        plan.takeProfit;


      /*
         Conservative:
         if both touched in same candle,
         stop counts first.
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
          j;


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
          j;


        break;

      }

    }


    if (
      signal === "SELL"
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
          j;


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
          j;


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

      exitIndex === null

        ? bars.length -
          1 -
          signalIndex

        : exitIndex -
          signalIndex

  };

}


/* =========================================================
   HARD-LOCK BACKTESTER

   IMPORTANT:
   Only ONE trade can exist at a time.

   When BUY/SELL opens:
   all signals are ignored until exit.
========================================================= */

function backtest(
  bars
) {

  const states =
    buildStates(
      bars
    );


  const trades =
    [];


  let i =
    1;


  while (
    i <
    states.length -
    1
  ) {

    const previous =
      states[
        i - 1
      ];


    const current =
      states[
        i
      ];


    const signal =
      signalAt(
        previous,
        current
      );


    if (
      signal === "WAIT"
    ) {

      i++;

      continue;

    }


    const plan =
      tradePlan(
        signal,
        current
      );


    if (
      !plan.valid
    ) {

      i++;

      continue;

    }


    const simulation =
      simulateTrade(

        bars,

        i,

        signal,

        plan

      );


    trades.push({

      signal,

      entryTime:
        current.time,

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
       HARD LOCK:

       If trade closed, jump directly to
       the candle AFTER exit.

       This prevents overlapping entries.
    */

    if (
      simulation.exitIndex !== null
    ) {

      i =
        simulation.exitIndex +
        1;

    } else {

      /*
         Trade is still open at end of data.
         No later signal can be taken.
      */

      break;

    }

  }


  const closedTrades =

    trades.filter(
      trade =>
        trade.result === "WIN" ||
        trade.result === "LOSS"
    );


  const openTrades =

    trades.filter(
      trade =>
        trade.result === "OPEN"
    );


  const wins =

    closedTrades.filter(
      trade =>
        trade.result === "WIN"
    );


  const losses =

    closedTrades.filter(
      trade =>
        trade.result === "LOSS"
    );


  const grossProfit =

    wins.reduce(
      (
        total,
        trade
      ) =>
        total +
        trade.r,
      0
    );


  const grossLoss =

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


  const expectancyR =

    closedTrades.length

      ? netR /
        closedTrades.length

      : 0;


  const winRate =

    closedTrades.length

      ? wins.length /
        closedTrades.length *
        100

      : 0;


  const profitFactor =

    grossLoss >
    0

      ? grossProfit /
        grossLoss

      : grossProfit >
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

    timeframe:
      "5min",

    pivotLength:
      LENGTH,

    maxLevels:
      MAX_LEVELS,

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
        grossProfit,
        2
      ),

    grossLossR:
      round(
        grossLoss,
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


    const bars =
      await fetch5m(
        symbol
      );


    const analysis =
      analyse(
        bars
      );


    const signals =
      recentSignals(
        bars
      );


    const bt =
      backtest(
        bars
      );


    const candleAge =
      minutesOld(
        analysis.currentTime
      );


    return res
      .status(200)
      .json({

        success:
          true,

        engine:
          "MKAYFX 5M S&R HARD LOCK V3",

        strategy:
          "5M PIVOT S&R CROSSOVER",

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
          analysis.currentTime,

        candleAgeMinutes:
          round(
            candleAge,
            1
          ),

        settings: {

          timeframe:
            "5min",

          pivotLookbackLength:
            LENGTH,

          maxActiveLevels:
            MAX_LEVELS,

          showSRLines:
            SHOW_ZONES,

          riskReward:
            RISK_REWARD,

          hardLock:
            true

        },

        signal:
          analysis.signal,

        buySignal:
          analysis.buySignal,

        sellSignal:
          analysis.sellSignal,

        price:
          round(
            analysis.currentClose,
            market.digits
          ),

        previousClose:
          round(
            analysis.previousClose,
            market.digits
          ),

        support:
          round(
            analysis.nearestSupport,
            market.digits
          ),

        resistance:
          round(
            analysis.nearestResistance,
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

        levels: {

          supports:

            analysis.supports.map(
              value =>
                round(
                  value,
                  market.digits
                )
            ),

          resistances:

            analysis.resistances.map(
              value =>
                round(
                  value,
                  market.digits
                )
            )

        },

        reasons:

          analysis.signal ===
          "BUY"

            ? [

                "5M close crossed above newest confirmed support.",
                "This signal can be hard-locked by the frontend.",
                "Stop Loss uses the confirmed support.",
                "Take Profit is stretched to 3R."

              ]

            : analysis.signal ===
              "SELL"

              ? [

                  "5M close crossed below newest confirmed resistance.",
                  "This signal can be hard-locked by the frontend.",
                  "Stop Loss uses the confirmed resistance.",
                  "Take Profit is stretched to 3R."

                ]

              : [

                  "Waiting for a new 5M S&R crossover."

                ],

        recentSignals:

          signals.map(
            item => ({

              ...item,

              price:
                round(
                  item.price,
                  market.digits
                ),

              level:
                round(
                  item.level,
                  market.digits
                ),

              entry:
                round(
                  item.entry,
                  market.digits
                ),

              stopLoss:
                round(
                  item.stopLoss,
                  market.digits
                ),

              takeProfit:
                round(
                  item.takeProfit,
                  market.digits
                ),

              risk:
                round(
                  item.risk,
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

          bars
            .slice(
              -180
            )
            .map(
              bar => ({

                time:
                  bar.time,

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

      "MKAYFX 5M S&R ERROR",

      error

    );


    return res
      .status(500)
      .json({

        success:
          false,

        engine:
          "MKAYFX 5M S&R HARD LOCK V3",

        error:

          safeError(
            error
          )

          ||

          "Unknown S&R engine error."

      });

  }

}