/* =========================================================
   MKAYFX MULTI-ASSET 5M S&R ENGINE
   /api/sr.js

   MARKETS
   -------
   XAU/USD
   BTC/USD

   TIMEFRAME
   ---------
   5 MINUTES

   STRATEGY
   --------
   Pivot Lookback = 9
   Max Active Levels = 5

   BUY:
   close crosses ABOVE newest confirmed support

   SELL:
   close crosses BELOW newest confirmed resistance

   TRADE PLAN
   ----------
   BUY:
   Entry = signal close
   SL    = newest support
   TP    = 2R

   SELL:
   Entry = signal close
   SL    = newest resistance
   TP    = 2R

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

const INTERVAL =
  "5min";

const LENGTH =
  9;

const MAX_LEVELS =
  5;

const SHOW_ZONES =
  true;

const RISK_REWARD =
  2;

const OUTPUT_SIZE =
  500;


/* =========================================================
   HELPERS
========================================================= */

function num(value) {

  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : null;

}


function round(
  value,
  digits = 2
) {

  const n =
    num(value);

  if (
    n === null
  ) {

    return null;

  }

  return Number(
    n.toFixed(digits)
  );

}


function safeError(value) {

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

    return (
      value.message ||
      String(value)
    );

  }

  if (
    typeof value === "object"
  ) {

    try {

      return JSON.stringify(value);

    } catch {

      return String(value);

    }

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


function minutesOld(value) {

  const timestamp =
    parseTime(value);


  if (
    !Number.isFinite(timestamp)
  ) {

    return null;

  }


  return Math.max(

    0,

    (
      Date.now() -
      timestamp
    ) / 60000

  );

}


/* =========================================================
   HTTP
========================================================= */

async function getJSON(
  url,
  timeout = 18000
) {

  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () => controller.abort(),
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

        data?.message ||
        data?.error ||
        `HTTP ${response.status}`

      );

    }


    return data;

  } catch (error) {

    if (
      error?.name === "AbortError"
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
   FETCH 5M CANDLES
========================================================= */

async function fetch5m(symbol) {

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
        String(OUTPUT_SIZE),

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
    !Array.isArray(data.values)
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
            Number(item.open),

          high:
            Number(item.high),

          low:
            Number(item.low),

          close:
            Number(item.close)

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
            .every(Number.isFinite)
      )

      .sort(
        (
          a,
          b
        ) =>

          parseTime(a.time) -
          parseTime(b.time)
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

   Same logic as:
   ta.pivotlow(low, length, length)
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
    bars[center].low;


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

   Same logic as:
   ta.pivothigh(high, length, length)
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
    bars[center].high;


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

function buildStates(bars) {

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

    /*
       A pivot is confirmed after
       LENGTH candles appear to its right.
    */

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
        bars[center].high
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
        bars[center].low
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
        bars[currentIndex].time,

      close:
        bars[currentIndex].close,

      nearestSupport,

      nearestResistance,

      supports:
        [...supports],

      resistances:
        [...resistances]

    });

  }


  return states;

}


/* =========================================================
   BUY CROSSOVER

   Pine:
   ta.crossover(close, nearestSupport)
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

   Pine:
   ta.crossunder(close, nearestResistance)
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
   ENTRY / SL / TP

   Uses ONLY price + S&R.
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


  /* BUY */

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

    } else {

      entry =
        null;

      stopLoss =
        null;

      takeProfit =
        null;

      risk =
        null;

    }

  }


  /* SELL */

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

    } else {

      entry =
        null;

      stopLoss =
        null;

      takeProfit =
        null;

      risk =
        null;

    }

  }


  return {

    entry,

    stopLoss,

    takeProfit,

    risk,

    rr:
      RISK_REWARD

  };

}


/* =========================================================
   CURRENT ANALYSIS
========================================================= */

function analyse(bars) {

  const states =
    buildStates(bars);


  const current =
    states.at(-1);


  const previous =
    states.at(-2);


  const buySignal =
    supportCrossover(
      previous,
      current
    );


  const sellSignal =
    resistanceCrossunder(
      previous,
      current
    );


  let signal =
    "WAIT";


  if (
    buySignal
  ) {

    signal =
      "BUY";

  } else if (
    sellSignal
  ) {

    signal =
      "SELL";

  }


  const plan =
    tradePlan(
      signal,
      current
    );


  return {

    signal,

    buySignal,

    sellSignal,

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
  limit = 20
) {

  const states =
    buildStates(bars);


  const signals =
    [];


  for (
    let i = 1;

    i < states.length;

    i++
  ) {

    const previous =
      states[i - 1];


    const current =
      states[i];


    let signal =
      null;


    if (
      supportCrossover(
        previous,
        current
      )
    ) {

      signal =
        "BUY";

    } else if (
      resistanceCrossunder(
        previous,
        current
      )
    ) {

      signal =
        "SELL";

    }


    if (
      !signal
    ) {

      continue;

    }


    const plan =
      tradePlan(
        signal,
        current
      );


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
    .slice(-limit)
    .reverse();

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
    req.method === "OPTIONS"
  ) {

    return res
      .status(204)
      .end();

  }


  if (
    req.method !== "GET"
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
        bars,
        20
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
          "MKAYFX 5M S&R",

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
            RISK_REWARD

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

          analysis.signal === "BUY"

            ? [

                "5M close crossed above newest confirmed support.",
                "Stop Loss uses the confirmed support.",
                "Take Profit is 2R from entry."

              ]

            : analysis.signal === "SELL"

              ? [

                  "5M close crossed below newest confirmed resistance.",
                  "Stop Loss uses the confirmed resistance.",
                  "Take Profit is 2R from entry."

                ]

              : [

                  "Waiting for a 5M close to cross newest support or resistance."

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

        chart:

          bars
            .slice(-180)
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

  } catch (error) {

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
          "MKAYFX 5M S&R",

        error:
          safeError(error) ||
          "Unknown S&R engine error."

      });

  }

}