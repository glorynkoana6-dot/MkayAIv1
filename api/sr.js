/* =========================================================
   MKAYFX 1-MIN GOLD SUPPORT & RESISTANCE SIGNALS
   /api/sr.js

   DIRECT JAVASCRIPT VERSION OF:

   "1-Min Gold Support & Resistance Signals"

   LOGIC ONLY
   ----------
   - 1 minute XAU/USD
   - Pivot highs
   - Pivot lows
   - Maximum 5 active support levels
   - Maximum 5 active resistance levels
   - BUY when close crosses ABOVE newest support
   - SELL when close crosses BELOW newest resistance

   NO OTHER INDICATORS
   NO EMA
   NO RSI
   NO ATR
   NO M5
   NO M15
   NO SCORING
   NO LIQUIDITY FILTERS
========================================================= */


const API_KEY =
  process.env.TWELVE_DATA_API_KEY;


const BASE_URL =
  "https://api.twelvedata.com";


const SYMBOL =
  "XAU/USD";


/* =========================================================
   SETTINGS

   TradingView:
   Pivot Lookback Length = 9
   Max Active Levels     = 5
   Show S&R Lines        = true
========================================================= */

const LENGTH =
  9;


const MAX_LEVELS =
  5;


const SHOW_ZONES =
  true;


/*
   Enough candles to calculate and display
   recent S&R structure.
*/
const OUTPUT_SIZE =
  500;


/* =========================================================
   HELPERS
========================================================= */

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
      String(value)
    );
  }


  if (
    typeof value ===
    "object"
  ) {

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
    String(value)
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
          JSON.parse(
            raw
          );

      } catch {

        throw new Error(

          `Provider returned invalid JSON. HTTP ${response.status}`

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
   FETCH XAU/USD 1M CANDLES
========================================================= */

async function fetchM1() {

  if (
    !API_KEY
  ) {

    throw new Error(

      "TWELVE_DATA_API_KEY is missing in Vercel Environment Variables."

    );

  }


  const query =
    new URLSearchParams({

      symbol:
        SYMBOL,

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

      `${BASE_URL}/time_series?${query.toString()}`

    );


  if (
    !Array.isArray(
      data.values
    )
  ) {

    throw new Error(
      "No XAU/USD 1-minute candles returned."
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

          Number.isFinite(
            bar.open
          )

          &&

          Number.isFinite(
            bar.high
          )

          &&

          Number.isFinite(
            bar.low
          )

          &&

          Number.isFinite(
            bar.close
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

      `Not enough M1 candles. Received ${bars.length}.`

    );

  }


  return bars;

}


/* =========================================================
   PINE:

   ta.pivotlow(
       low,
       length,
       length
   )
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


  const pivotPrice =
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
      pivotPrice
    ) {

      return false;

    }

  }


  return true;

}


/* =========================================================
   PINE:

   ta.pivothigh(
       high,
       length,
       length
   )
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


  const pivotPrice =
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
      pivotPrice
    ) {

      return false;

    }

  }


  return true;

}


/* =========================================================
   EXACT PINE-STYLE ENGINE

   Pine performs this on every bar:

   if not na(f_top)
       array.unshift(resistances, f_top)

   if not na(f_bot)
       array.unshift(supports, f_bot)

   max = 5
========================================================= */

function buildSignalState(
  bars
) {

  const supports =
    [];


  const resistances =
    [];


  const history =
    [];


  /*
     A pivot centered at:

         currentIndex - LENGTH

     becomes confirmed on the current bar because it now
     has LENGTH candles to its right.
  */

  for (
    let currentIndex = 0;

    currentIndex < bars.length;

    currentIndex++
  ) {

    const center =
      currentIndex -
      LENGTH;


    /* ================================================
       f_top = ta.pivothigh(...)
    ================================================= */

    if (
      center >= LENGTH &&
      isPivotHigh(
        bars,
        center,
        LENGTH
      )
    ) {

      const pivot =
        bars[
          center
        ].high;


      /*
         Pine:
         array.unshift(resistances, f_top)
      */

      resistances.unshift(
        pivot
      );


      /*
         Pine:
         if array.size(resistances) > maxLevels
             array.pop(resistances)
      */

      if (
        resistances.length >
        MAX_LEVELS
      ) {

        resistances.pop();

      }

    }


    /* ================================================
       f_bot = ta.pivotlow(...)
    ================================================= */

    if (
      center >= LENGTH &&
      isPivotLow(
        bars,
        center,
        LENGTH
      )
    ) {

      const pivot =
        bars[
          center
        ].low;


      /*
         Pine:
         array.unshift(supports, f_bot)
      */

      supports.unshift(
        pivot
      );


      /*
         Pine:
         if array.size(supports) > maxLevels
             array.pop(supports)
      */

      if (
        supports.length >
        MAX_LEVELS
      ) {

        supports.pop();

      }

    }


    /*
       Pine:

       nearestSupport =
           array.size(supports) > 0
               ? array.get(supports, 0)
               : na

       nearestResistance =
           array.size(resistances) > 0
               ? array.get(resistances, 0)
               : na

       IMPORTANT:

       This script does NOT calculate which level is
       mathematically closest to price.

       array.get(..., 0) means the NEWEST confirmed pivot.
    */

    const nearestSupport =

      supports.length >
      0

        ? supports[0]

        : null;


    const nearestResistance =

      resistances.length >
      0

        ? resistances[0]

        : null;


    history.push({

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
        [...supports],

      resistances:
        [...resistances]

    });

  }


  return history;

}


/* =========================================================
   PINE:

   ta.crossover(
       close,
       nearestSupport
   )

   Equivalent:

   current close > current support
   AND
   previous close <= previous support
========================================================= */

function crossover(
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
   PINE:

   ta.crossunder(
       close,
       nearestResistance
   )

   Equivalent:

   current close < current resistance
   AND
   previous close >= previous resistance
========================================================= */

function crossunder(
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
   SIGNAL ENGINE
========================================================= */

function analyse(
  bars
) {

  const states =
    buildSignalState(
      bars
    );


  const current =
    states.at(-1);


  const previous =
    states.at(-2);


  const buySignal =
    crossover(
      previous,
      current
    );


  const sellSignal =
    crossunder(
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

  }


  if (
    sellSignal
  ) {

    signal =
      "SELL";

  }


  return {

    signal,

    buySignal,

    sellSignal,

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
      previous?.close ?? null,

    currentTime:
      current.time,

    previousTime:
      previous?.time ?? null

  };

}


/* =========================================================
   RECENT SIGNAL HISTORY

   This does NOT add any new strategy logic.

   It simply checks the exact same crossover / crossunder
   logic across previous candles.
========================================================= */

function recentSignals(
  bars,
  limit = 20
) {

  const states =
    buildSignalState(
      bars
    );


  const signals =
    [];


  for (
    let i = 1;

    i < states.length;

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


    const buy =
      crossover(
        previous,
        current
      );


    const sell =
      crossunder(
        previous,
        current
      );


    if (
      buy
    ) {

      signals.push({

        signal:
          "BUY",

        time:
          current.time,

        price:
          current.close,

        level:
          current.nearestSupport

      });

    }


    if (
      sell
    ) {

      signals.push({

        signal:
          "SELL",

        time:
          current.time,

        price:
          current.close,

        level:
          current.nearestResistance

      });

    }

  }


  return signals
    .slice(
      -limit
    )
    .reverse();

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
          "Method not allowed."

      });

  }


  try {

    const bars =
      await fetchM1();


    const analysis =
      analyse(
        bars
      );


    const signals =
      recentSignals(
        bars,
        20
      );


    return res
      .status(200)
      .json({

        success:
          true,


        engine:
          "1-Min Gold Support & Resistance Signals",


        symbol:
          SYMBOL,


        timeframe:
          "1min",


        generatedAt:
          new Date()
            .toISOString(),


        settings: {

          pivotLookbackLength:
            LENGTH,

          maxActiveLevels:
            MAX_LEVELS,

          showSRLines:
            SHOW_ZONES

        },


        signal:
          analysis.signal,


        buySignal:
          analysis.buySignal,


        sellSignal:
          analysis.sellSignal,


        price:
          analysis.currentClose,


        previousClose:
          analysis.previousClose,


        candleTime:
          analysis.currentTime,


        nearestSupport:
          analysis.nearestSupport,


        nearestResistance:
          analysis.nearestResistance,


        support:
          analysis.nearestSupport,


        resistance:
          analysis.nearestResistance,


        levels: {

          supports:
            analysis.supports,

          resistances:
            analysis.resistances

        },


        /*
           Pine Script only gives BUY / SELL markers.
           It does NOT calculate entry, SL or TP.

           These remain null intentionally.
        */

        entry:
          null,

        stopLoss:
          null,

        tp1:
          null,

        tp2:
          null,


        reasons:

          analysis.signal ===
          "BUY"

            ? [

                "Close crossed above newest confirmed support."

              ]

            : analysis.signal ===
              "SELL"

              ? [

                  "Close crossed below newest confirmed resistance."

                ]

              : [

                  "Waiting for close to cross newest support or resistance."

                ],


        recentSignals:
          signals,


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
                  bar.open,

                high:
                  bar.high,

                low:
                  bar.low,

                close:
                  bar.close

              })
            )

      });

  } catch (
    error
  ) {

    console.error(

      "MKAYFX S&R ERROR",

      error

    );


    return res
      .status(500)
      .json({

        success:
          false,

        engine:
          "1-Min Gold Support & Resistance Signals",

        symbol:
          SYMBOL,

        error:

          safeError(
            error
          )

          ||

          "Unknown S&R engine error."

      });

  }

}