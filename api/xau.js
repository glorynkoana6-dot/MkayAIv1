/* =========================================================
   MKAYFX XAU LIQUIDITY INTELLIGENCE + LIVE INDICATOR
   /api/xau.js

   SYMBOL
   ------
   XAU/USD

   LIVE / BACKTEST MATCH
   ---------------------
   Execution:       M5
   Confirmation:    M15 + H1

   Reference days:  70
   Start balance:   R200
   Risk:            7%
   Minimum score:   68

   TP1:             1.5R
   TP1 exit:        50%

   TP2:             2.7R
   TP2 exit:        50%

   Spread:          0
   Slippage:        0

   Max hold:        72 M5 bars
                    = 6 hours

   Max trades:      1000

   IMPORTANT
   ---------
   Signal decisions are based on COMPLETED M5 candles.

   M15 and H1 structure are also built from completed
   M5 data to reduce repainting and make live logic
   closer to backtesting.

   ENVIRONMENT VARIABLES
   ---------------------
   TWELVE_DATA_API_KEY
   FRED_API_KEY             optional
========================================================= */


/* =========================================================
   ENVIRONMENT
========================================================= */

const TD_KEY =
  process.env.TWELVE_DATA_API_KEY;


const FRED_KEY =
  process.env.FRED_API_KEY;


const TD_BASE =
  "https://api.twelvedata.com";


const FRED_BASE =
  "https://api.stlouisfed.org/fred";


const SYMBOL =
  "XAU/USD";


/* =========================================================
   LIVE SETTINGS
========================================================= */

const LIVE_SETTINGS = {

  historicalReferenceDays:
    70,

  executionTimeframe:
    "M5",

  confirmationTimeframes: [
    "M15",
    "H1"
  ],

  startBalance:
    200,

  riskPct:
    7,

  minScore:
    68,

  tp1R:
    1.5,

  tp2R:
    2.7,

  tp1ExitPct:
    50,

  tp2ExitPct:
    50,

  spread:
    0,

  slippage:
    0,

  maxHoldBars:
    72,

  maxHoldMinutes:
    72 * 5,

  maxTrades:
    1000,

  /*
   * Stop-loss protection.
   *
   * Stop uses recent M5 structure plus ATR.
   */

  stopAtrBuffer:
    0.18,

  minStopAtr:
    0.60,

  maxStopAtr:
    2.25,

  /*
   * M15 + H1 confirmation.
   */

  requireM15Confirmation:
    true,

  requireH1Confirmation:
    true,

  /*
   * M5 is execution.
   *
   * We allow M5 NEUTRAL but prevent a trade
   * if M5 is clearly opposite.
   */

  requireM5NotOpposite:
    true,

  /*
   * Prevent BUY and SELL scores that are
   * essentially identical.
   */

  minimumScoreGap:
    3

};


/* =========================================================
   DATA SETTINGS
========================================================= */

/*
 * Twelve Data commonly returns a maximum of about
 * 5000 candles from one standard time_series request.
 *
 * The 70-day setting is retained in LIVE_SETTINGS as the
 * strategy/backtest reference.
 */

const M1_OUTPUTSIZE =
  1800;


const M5_OUTPUTSIZE =
  5000;


const D1_OUTPUTSIZE =
  120;


/*
 * Shorter than the old 55-second cache so the dashboard
 * feels more live while still protecting API usage.
 */

const PRICE_CACHE_MS =
  20_000;


const MACRO_CACHE_MS =
  15 * 60_000;


let priceCache = {

  at:
    0,

  payload:
    null

};


let macroCache = {

  at:
    0,

  payload:
    null

};


/* =========================================================
   SESSION DEFINITIONS
========================================================= */

const SESSION_DEFS = [

  {
    id:
      "tokyo",

    name:
      "Tokyo / Asia",

    short:
      "ASIA",

    zone:
      "Asia/Tokyo",

    open:
      9 * 60,

    close:
      18 * 60,

    risk:
      0.55
  },

  {
    id:
      "london",

    name:
      "London",

    short:
      "LONDON",

    zone:
      "Europe/London",

    open:
      8 * 60,

    close:
      17 * 60,

    risk:
      1
  },

  {
    id:
      "newyork",

    name:
      "New York",

    short:
      "NEW YORK",

    zone:
      "America/New_York",

    open:
      8 * 60,

    close:
      17 * 60,

    risk:
      1
  }

];


/* =========================================================
   MAIN API
========================================================= */

export default async function handler(
  req,
  res
) {

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


  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0"
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

        ok:
          false,

        error:
          "GET only"

      });

  }


  if (
    !TD_KEY
  ) {

    return res
      .status(500)
      .json({

        ok:
          false,

        error:
          "Missing TWELVE_DATA_API_KEY environment variable."

      });

  }


  try {

    const now =
      Date.now();


    /* =====================================================
       CACHE
    ===================================================== */

    if (

      priceCache.payload

      &&

      now -
      priceCache.at <
      PRICE_CACHE_MS

    ) {

      return res
        .status(200)
        .json({

          ...priceCache.payload,

          cache:
            true,

          servedAt:
            new Date()
              .toISOString()

        });

    }


    /* =====================================================
       FETCH DATA
    ===================================================== */

    const [

      m1Raw,
      m5Raw,
      d1Raw,
      macro

    ] = await Promise.all([

      fetchTdSeries(
        "1min",
        M1_OUTPUTSIZE
      ),

      fetchTdSeries(
        "5min",
        M5_OUTPUTSIZE
      ),

      fetchTdSeries(
        "1day",
        D1_OUTPUTSIZE
      ),

      getMacroContext()

    ]);


    /* =====================================================
       PARSE DATA
    ===================================================== */

    const m1 =
      parseTdSeries(
        m1Raw,
        true
      );


    const m5All =
      parseTdSeries(
        m5Raw,
        true
      );


    const d1 =
      parseTdSeries(
        d1Raw,
        false
      );


    if (

      m1.length <
      100

      ||

      m5All.length <
      300

      ||

      d1.length <
      20

    ) {

      throw new Error(

        `Not enough data returned. ` +

        `M1=${m1.length}, ` +

        `M5=${m5All.length}, ` +

        `D1=${d1.length}`

      );

    }


    /* =====================================================
       COMPLETED CANDLES

       This is very important.

       Backtests normally use closed candles.

       Therefore the LIVE signal engine also uses
       completed M5 / M15 / H1 candles.
    ===================================================== */

    const m5 =
      completedBars(
        m5All,
        5
      );


    if (
      m5.length <
      250
    ) {

      throw new Error(
        "Not enough completed M5 candles."
      );

    }


    const m15 =
      completedBars(

        resample(
          m5,
          15
        ),

        15

      );


    const h1 =
      completedBars(

        resample(
          m5,
          60
        ),

        60

      );


    const h4 =
      completedBars(

        resample(
          m5,
          240
        ),

        240

      );


    const executionBar =
      m5[
        m5.length -
        1
      ];


    const current =
      m1[
        m1.length -
        1
      ];


    const price =
      current.close;


    /* =====================================================
       VOLATILITY
    ===================================================== */

    const atr5 =

      lastFinite(
        atr(
          m5,
          14
        )
      )

      ||

      price *
      0.0015;


    const atr15 =

      lastFinite(
        atr(
          m15,
          14
        )
      )

      ||

      atr5 *
      1.65;


    const atrH1 =

      lastFinite(
        atr(
          h1,
          14
        )
      )

      ||

      atr15 *
      2.1;


    /* =====================================================
       SESSION ENGINE
    ===================================================== */

    const sessions =
      buildSessionState(
        m1
      );


    /* =====================================================
       DAY / WEEK LEVELS
    ===================================================== */

    const dayLevels =
      buildDayLevels(
        d1,
        price
      );


    /* =====================================================
       MULTI-TIMEFRAME STRUCTURE
    ===================================================== */

    const structure = {

      m5:
        timeframeState(
          m5
        ),

      m15:
        timeframeState(
          m15
        ),

      h1:
        timeframeState(
          h1
        ),

      h4:
        timeframeState(
          h4
        ),

      d1:
        timeframeState(
          d1
        )

    };


    /* =====================================================
       LIQUIDITY STRUCTURE
    ===================================================== */

    const equalLevels =
      detectEqualLevels(
        m15,
        atr15
      );


    const swingLevels =
      detectSwingLevels(
        h1,
        3,
        80
      );


    const fvgs =
      detectFvgs(
        m15,
        price,
        80
      );


    /* =====================================================
       FOOTPRINT PROXY
    ===================================================== */

    const footprint =
      buildFootprint(
        m1,
        atr5
      );


    /* =====================================================
       VWAP
    ===================================================== */

    const vwap =
      buildVwap(
        m1
      );


    /* =====================================================
       HISTORICAL SWEEP MODEL
    ===================================================== */

    const sweepHistory =
      buildSweepHistory(
        m5
      );


    /* =====================================================
       LIQUIDITY MAP
    ===================================================== */

    const rawPools =
      buildLiquidityPools({

        price,

        sessions,

        dayLevels,

        equalLevels,

        swingLevels,

        atrH1

      });


    const pools =
      rawPools

        .map(
          pool =>
            enrichPool({

              pool,

              price,

              atr5,

              atr15,

              structure,

              sessions,

              footprint,

              sweepHistory,

              m1

            })
        )

        .sort(
          (
            a,
            b
          ) =>
            b.likelihoodScore -
            a.likelihoodScore
        )

        .slice(
          0,
          12
        );


    /* =====================================================
       TRAP WINDOWS
    ===================================================== */

    const trapWindows =
      buildTrapWindows({

        now:
          new Date(),

        sessions,

        pools,

        price,

        atr15

      });


    /* =====================================================
       MARKET REGIME
    ===================================================== */

    const regime =
      buildRegime({

        m5,

        atr5,

        atr15,

        footprint,

        structure

      });


    /* =====================================================
       ACCOUNT BALANCE

       URL example:

       /api/xau?balance=300

       If omitted, default = R200.
    ===================================================== */

    const requestedBalance =
      Number(
        req.query?.balance
      );


    const accountBalance =

      Number.isFinite(
        requestedBalance
      )

      &&

      requestedBalance >
      0

        ?

        requestedBalance

        :

        LIVE_SETTINGS.startBalance;


    /* =====================================================
       LIVE SIGNAL
    ===================================================== */

    const liveSignal =
      buildLiveSignal({

        price,

        executionBar,

        m5,

        atr5,

        atr15,

        structure,

        footprint,

        pools,

        sessions,

        regime,

        accountBalance

      });


    /* =====================================================
       DATA AGE
    ===================================================== */

    const latestTs =
      current.ts;


    const dataAgeSeconds =
      Math.max(

        0,

        Math.round(

          (
            Date.now() -
            latestTs
          )

          /

          1000

        )

      );


    /* =====================================================
       RESPONSE
    ===================================================== */

    const payload = {

      ok:
        true,

      symbol:
        SYMBOL,

      generatedAt:
        new Date()
          .toISOString(),

      servedAt:
        new Date()
          .toISOString(),

      cache:
        false,


      price:
        round(
          price,
          3
        ),


      latestBarTime:
        new Date(
          latestTs
        )
          .toISOString(),


      lastCompletedM5:
        new Date(
          executionBar.ts
        )
          .toISOString(),


      dataAgeSeconds,


      strategySettings: {

        historicalReferenceDays:
          LIVE_SETTINGS
            .historicalReferenceDays,

        executionTimeframe:
          LIVE_SETTINGS
            .executionTimeframe,

        confirmationTimeframes:
          LIVE_SETTINGS
            .confirmationTimeframes,

        startBalance:
          LIVE_SETTINGS
            .startBalance,

        currentBalance:
          round(
            accountBalance,
            2
          ),

        riskPct:
          LIVE_SETTINGS
            .riskPct,

        riskAmount:
          round(

            accountBalance

            *

            (
              LIVE_SETTINGS.riskPct /
              100
            ),

            2

          ),

        minScore:
          LIVE_SETTINGS
            .minScore,

        minimumScoreGap:
          LIVE_SETTINGS
            .minimumScoreGap,

        tp1R:
          LIVE_SETTINGS
            .tp1R,

        tp2R:
          LIVE_SETTINGS
            .tp2R,

        tp1ExitPct:
          LIVE_SETTINGS
            .tp1ExitPct,

        tp2ExitPct:
          LIVE_SETTINGS
            .tp2ExitPct,

        spread:
          LIVE_SETTINGS
            .spread,

        slippage:
          LIVE_SETTINGS
            .slippage,

        maxHoldBars:
          LIVE_SETTINGS
            .maxHoldBars,

        maxHoldMinutes:
          LIVE_SETTINGS
            .maxHoldMinutes,

        maxTrades:
          LIVE_SETTINGS
            .maxTrades

      },


      liveSignal,


      source: {

        price:
          "Twelve Data XAU/USD",

        execution:
          "Completed Twelve Data M5 candles",

        footprint:
          footprint.mode,

        footprintIsTrueBidAsk:
          false,

        macro:
          macro.enabled
            ?
            "FRED"
            :
            "disabled"

      },


      sessions,


      market: {

        atr5:
          round(
            atr5,
            3
          ),

        atr15:
          round(
            atr15,
            3
          ),

        atrH1:
          round(
            atrH1,
            3
          ),

        vwap:
          round(
            vwap.value,
            3
          ),

        vwapMode:
          vwap.mode,

        vwapDistance:
          round(
            price -
            vwap.value,
            3
          ),

        regime

      },


      structure,

      dayLevels,

      equalLevels,

      swingLevels,

      fvgs,

      footprint,

      sweepHistory,

      liquidityPools:
        pools,

      trapWindows,

      macro,


      warnings: [

        "Live signal decisions use completed M5 candles to reduce repainting.",

        "M15 and H1 confirmation are required to match the selected backtest setup.",

        "7% risk per trade is aggressive and can cause large account drawdowns.",

        "Spread and slippage are set to zero to match the backtest settings, although real execution can have both.",

        "The API is stateless. The frontend should lock an accepted trade until SL, TP2, expiry or manual reset.",

        "Sweep likelihood is a heuristic ranking, not a guaranteed probability.",

        "Footprint values are OHLCV-derived proxies unless a true aggressor bid/ask feed is supplied.",

        "Spot XAU/USD provider volume is not centralized exchange volume."

      ]

    };


    priceCache = {

      at:
        Date.now(),

      payload

    };


    return res
      .status(200)
      .json(
        payload
      );


  } catch (
    error
  ) {

    console.error(
      "XAU intelligence error:",
      error
    );


    return res
      .status(500)
      .json({

        ok:
          false,

        error:
          error?.message
          ||
          "Unknown server error"

      });

  }

}


/* =========================================================
   LIVE SIGNAL ENGINE
========================================================= */

function buildLiveSignal({

  price,

  executionBar,

  m5,

  atr5,

  atr15,

  structure,

  footprint,

  pools,

  sessions,

  regime,

  accountBalance

}) {

  const riskAmount =

    accountBalance

    *

    (
      LIVE_SETTINGS.riskPct /
      100
    );


  /* =====================================================
     FIND BEST UPSIDE / DOWNSIDE LIQUIDITY
  ===================================================== */

  const highPools =
    pools

      .filter(
        p =>
          p.side ===
          "HIGH"
      )

      .sort(
        (
          a,
          b
        ) =>
          b.likelihoodScore -
          a.likelihoodScore
      );


  const lowPools =
    pools

      .filter(
        p =>
          p.side ===
          "LOW"
      )

      .sort(
        (
          a,
          b
        ) =>
          b.likelihoodScore -
          a.likelihoodScore
      );


  const buyPool =
    highPools[0]
    ||
    null;


  const sellPool =
    lowPools[0]
    ||
    null;


  let buyScore =
    buyPool
      ?
      buyPool.likelihoodScore
      :
      20;


  let sellScore =
    sellPool
      ?
      sellPool.likelihoodScore
      :
      20;


  const buyReasons =
    [];


  const sellReasons =
    [];


  /* =====================================================
     LIQUIDITY BASE
  ===================================================== */

  if (
    buyPool
  ) {

    buyReasons.push(

      `${buyPool.name} liquidity target at ${buyPool.level}`

    );

  }


  if (
    sellPool
  ) {

    sellReasons.push(

      `${sellPool.name} liquidity target at ${sellPool.level}`

    );

  }


  /* =====================================================
     M5 EXECUTION BIAS
  ===================================================== */

  if (
    structure.m5.bias ===
    "BULLISH"
  ) {

    buyScore +=
      6;

    sellScore -=
      6;

    buyReasons.push(
      "M5 execution structure bullish"
    );

  }


  if (
    structure.m5.bias ===
    "BEARISH"
  ) {

    sellScore +=
      6;

    buyScore -=
      6;

    sellReasons.push(
      "M5 execution structure bearish"
    );

  }


  /* =====================================================
     M15 CONFIRMATION
  ===================================================== */

  if (
    structure.m15.bias ===
    "BULLISH"
  ) {

    buyScore +=
      10;

    sellScore -=
      10;

    buyReasons.push(
      "M15 confirmation bullish"
    );

  }


  if (
    structure.m15.bias ===
    "BEARISH"
  ) {

    sellScore +=
      10;

    buyScore -=
      10;

    sellReasons.push(
      "M15 confirmation bearish"
    );

  }


  /* =====================================================
     H1 CONFIRMATION
  ===================================================== */

  if (
    structure.h1.bias ===
    "BULLISH"
  ) {

    buyScore +=
      10;

    sellScore -=
      10;

    buyReasons.push(
      "H1 confirmation bullish"
    );

  }


  if (
    structure.h1.bias ===
    "BEARISH"
  ) {

    sellScore +=
      10;

    buyScore -=
      10;

    sellReasons.push(
      "H1 confirmation bearish"
    );

  }


  /* =====================================================
     H4 CONTEXT

     H4 does not block a trade.
     It only adjusts confidence.
  ===================================================== */

  if (
    structure.h4.bias ===
    "BULLISH"
  ) {

    buyScore +=
      3;

    sellScore -=
      2;

    buyReasons.push(
      "H4 context supports upside"
    );

  }


  if (
    structure.h4.bias ===
    "BEARISH"
  ) {

    sellScore +=
      3;

    buyScore -=
      2;

    sellReasons.push(
      "H4 context supports downside"
    );

  }


  /* =====================================================
     FOOTPRINT / DELTA
  ===================================================== */

  const delta =
    footprint.last15?.deltaPct
    ||
    0;


  if (
    delta >=
    8
  ) {

    const bonus =
      clamp(
        delta / 4,
        2,
        8
      );


    buyScore +=
      bonus;

    sellScore -=
      bonus *
      0.5;


    buyReasons.push(

      `15m delta proxy supports buyers (${round(delta, 1)}%)`

    );

  }


  if (
    delta <=
    -8
  ) {

    const bonus =
      clamp(
        Math.abs(delta) / 4,
        2,
        8
      );


    sellScore +=
      bonus;

    buyScore -=
      bonus *
      0.5;


    sellReasons.push(

      `15m delta proxy supports sellers (${round(delta, 1)}%)`

    );

  }


  /* =====================================================
     DELTA DIVERGENCE
  ===================================================== */

  if (
    footprint.divergence ===
    "PRICE DOWN / DELTA UP"
  ) {

    buyScore +=
      4;

    buyReasons.push(
      "Bullish price/delta divergence"
    );

  }


  if (
    footprint.divergence ===
    "PRICE UP / DELTA DOWN"
  ) {

    sellScore +=
      4;

    sellReasons.push(
      "Bearish price/delta divergence"
    );

  }


  /* =====================================================
     ABSORPTION
  ===================================================== */

  if (
    footprint.absorption ===
    "SELLING ABSORBED / TRAPPED SELLER RISK"
  ) {

    buyScore +=
      5;

    buyReasons.push(
      "Selling absorption detected"
    );

  }


  if (
    footprint.absorption ===
    "BUYING ABSORBED / TRAPPED BUYER RISK"
  ) {

    sellScore +=
      5;

    sellReasons.push(
      "Buying absorption detected"
    );

  }


  /* =====================================================
     REGIME
  ===================================================== */

  if (
    regime.trend ===
    "BULLISH"
  ) {

    buyScore +=
      5;

    sellScore -=
      3;

    buyReasons.push(
      "Market regime bullish"
    );

  }


  if (
    regime.trend ===
    "BEARISH"
  ) {

    sellScore +=
      5;

    buyScore -=
      3;

    sellReasons.push(
      "Market regime bearish"
    );

  }


  /* =====================================================
     SESSION LIQUIDITY

     London / NY opening windows receive a small boost.
  ===================================================== */

  const activeMajorOpening =
    sessions.find(

      s =>

        (
          s.id ===
          "london"

          ||

          s.id ===
          "newyork"
        )

        &&

        s.phase ===
        "OPENING LIQUIDITY WINDOW"

    );


  if (
    activeMajorOpening
  ) {

    buyScore +=
      2;

    sellScore +=
      2;

  }


  /* =====================================================
     DISTANCE PENALTY

     Don't heavily reward liquidity that is extremely
     far away from current price.
  ===================================================== */

  if (
    buyPool?.distanceAtr >
    2
  ) {

    const penalty =
      Math.min(

        12,

        (
          buyPool.distanceAtr -
          2
        )

        *

        5

      );


    buyScore -=
      penalty;

  }


  if (
    sellPool?.distanceAtr >
    2
  ) {

    const penalty =
      Math.min(

        12,

        (
          sellPool.distanceAtr -
          2
        )

        *

        5

      );


    sellScore -=
      penalty;

  }


  /* =====================================================
     FINAL SCORES
  ===================================================== */

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


  /* =====================================================
     CONFIRMATION RULES
  ===================================================== */

  const buyM15Confirmed =

    !LIVE_SETTINGS
      .requireM15Confirmation

    ||

    structure.m15.bias ===
    "BULLISH";


  const buyH1Confirmed =

    !LIVE_SETTINGS
      .requireH1Confirmation

    ||

    structure.h1.bias ===
    "BULLISH";


  const buyM5Allowed =

    !LIVE_SETTINGS
      .requireM5NotOpposite

    ||

    structure.m5.bias !==
    "BEARISH";


  const sellM15Confirmed =

    !LIVE_SETTINGS
      .requireM15Confirmation

    ||

    structure.m15.bias ===
    "BEARISH";


  const sellH1Confirmed =

    !LIVE_SETTINGS
      .requireH1Confirmation

    ||

    structure.h1.bias ===
    "BEARISH";


  const sellM5Allowed =

    !LIVE_SETTINGS
      .requireM5NotOpposite

    ||

    structure.m5.bias !==
    "BULLISH";


  const buyRequirements =

    buyM15Confirmed

    &&

    buyH1Confirmed

    &&

    buyM5Allowed;


  const sellRequirements =

    sellM15Confirmed

    &&

    sellH1Confirmed

    &&

    sellM5Allowed;


  const scoreGap =
    Math.abs(
      buyScore -
      sellScore
    );


  let signal =
    "WAIT";


  let score =
    Math.max(
      buyScore,
      sellScore
    );


  let selectedPool =
    null;


  let reasons =
    [];


  const blockedBy =
    [];


  /* =====================================================
     BUY DECISION
  ===================================================== */

  if (

    buyScore >=
    LIVE_SETTINGS.minScore

    &&

    buyScore >
    sellScore

    &&

    scoreGap >=
    LIVE_SETTINGS.minimumScoreGap

    &&

    buyRequirements

  ) {

    signal =
      "BUY";

    score =
      buyScore;

    selectedPool =
      buyPool;

    reasons =
      buyReasons;

  }


  /* =====================================================
     SELL DECISION
  ===================================================== */

  if (

    sellScore >=
    LIVE_SETTINGS.minScore

    &&

    sellScore >
    buyScore

    &&

    scoreGap >=
    LIVE_SETTINGS.minimumScoreGap

    &&

    sellRequirements

  ) {

    signal =
      "SELL";

    score =
      sellScore;

    selectedPool =
      sellPool;

    reasons =
      sellReasons;

  }


  /* =====================================================
     WAIT REASONS
  ===================================================== */

  if (
    signal ===
    "WAIT"
  ) {

    if (

      buyScore <
      LIVE_SETTINGS.minScore

      &&

      sellScore <
      LIVE_SETTINGS.minScore

    ) {

      blockedBy.push(

        `Neither direction reached minimum score ${LIVE_SETTINGS.minScore}`

      );

    }


    if (
      scoreGap <
      LIVE_SETTINGS.minimumScoreGap
    ) {

      blockedBy.push(

        `BUY/SELL score gap below ${LIVE_SETTINGS.minimumScoreGap}`

      );

    }


    if (

      buyScore >
      sellScore

      &&

      !buyM15Confirmed

    ) {

      blockedBy.push(
        "BUY blocked: M15 is not bullish"
      );

    }


    if (

      buyScore >
      sellScore

      &&

      !buyH1Confirmed

    ) {

      blockedBy.push(
        "BUY blocked: H1 is not bullish"
      );

    }


    if (

      buyScore >
      sellScore

      &&

      !buyM5Allowed

    ) {

      blockedBy.push(
        "BUY blocked: M5 execution structure is bearish"
      );

    }


    if (

      sellScore >
      buyScore

      &&

      !sellM15Confirmed

    ) {

      blockedBy.push(
        "SELL blocked: M15 is not bearish"
      );

    }


    if (

      sellScore >
      buyScore

      &&

      !sellH1Confirmed

    ) {

      blockedBy.push(
        "SELL blocked: H1 is not bearish"
      );

    }


    if (

      sellScore >
      buyScore

      &&

      !sellM5Allowed

    ) {

      blockedBy.push(
        "SELL blocked: M5 execution structure is bullish"
      );

    }


    reasons =

      buyScore >=
      sellScore

        ?

        buyReasons

        :

        sellReasons;

  }


  /* =====================================================
     ENTRY

     Use completed M5 close to stay aligned with the
     backtest decision process.
  ===================================================== */

  const referenceEntry =
    executionBar.close;


  let entry =
    null;


  let stopLoss =
    null;


  let stopDistance =
    null;


  let tp1 =
    null;


  let tp2 =
    null;


  let riskReward1 =
    null;


  let riskReward2 =
    null;


  if (
    signal !==
    "WAIT"
  ) {

    entry =
      referenceEntry;


    stopLoss =
      buildLiveStop({

        side:
          signal,

        entry,

        m5,

        atr5

      });


    stopDistance =
      Math.abs(

        entry -
        stopLoss

      );


    if (
      signal ===
      "BUY"
    ) {

      tp1 =

        entry

        +

        stopDistance *
        LIVE_SETTINGS.tp1R;


      tp2 =

        entry

        +

        stopDistance *
        LIVE_SETTINGS.tp2R;

    }


    if (
      signal ===
      "SELL"
    ) {

      tp1 =

        entry

        -

        stopDistance *
        LIVE_SETTINGS.tp1R;


      tp2 =

        entry

        -

        stopDistance *
        LIVE_SETTINGS.tp2R;

    }


    riskReward1 =
      LIVE_SETTINGS.tp1R;


    riskReward2 =
      LIVE_SETTINGS.tp2R;

  }


  /* =====================================================
     SIGNAL ID

     Stable for each completed M5 setup.
  ===================================================== */

  const signalId =

    signal ===
    "WAIT"

      ?

      `XAU-M5-${executionBar.ts}-WAIT`

      :

      `XAU-M5-${executionBar.ts}-${signal}`;


  const entryBarCloseTime =

    executionBar.ts

    +

    5 *
    60_000;


  const expiresAt =

    entryBarCloseTime

    +

    LIVE_SETTINGS.maxHoldMinutes *
    60_000;


  /* =====================================================
     DISTANCE FROM LIVE PRICE TO REFERENCE ENTRY
  ===================================================== */

  const entryDrift =

    signal ===
    "WAIT"

      ?

      null

      :

      price -
      entry;


  const entryDriftAtr =

    signal ===
    "WAIT"

      ?

      null

      :

      (
        price -
        entry
      )

      /

      Math.max(
        atr5,
        1e-9
      );


  let entryState =
    "NO TRADE";


  if (
    signal !==
    "WAIT"
  ) {

    if (
      Math.abs(
        entryDriftAtr
      ) <=
      0.20
    ) {

      entryState =
        "ENTRY STILL CLOSE";

    }

    else if (
      Math.abs(
        entryDriftAtr
      ) <=
      0.50
    ) {

      entryState =
        "ENTRY MOVED";

    }

    else {

      entryState =
        "PRICE TOO FAR FROM REFERENCE ENTRY";

    }

  }


  return {

    status:

      signal ===
      "WAIT"

        ?

        "WAITING"

        :

        "SIGNAL",


    signal,


    signalId,


    score:
      round(
        score,
        1
      ),


    minimumScore:
      LIVE_SETTINGS.minScore,


    scoreGap:
      round(
        scoreGap,
        1
      ),


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


    generatedFromBar:
      new Date(
        executionBar.ts
      )
        .toISOString(),


    generatedFromBarClose:
      new Date(
        entryBarCloseTime
      )
        .toISOString(),


    marketPrice:
      round(
        price,
        3
      ),


    entry:
      round(
        entry,
        3
      ),


    referenceEntry:
      round(
        referenceEntry,
        3
      ),


    entryState,


    entryDrift:
      round(
        entryDrift,
        3
      ),


    entryDriftAtr:
      round(
        entryDriftAtr,
        2
      ),


    stopLoss:
      round(
        stopLoss,
        3
      ),


    stopDistance:
      round(
        stopDistance,
        3
      ),


    tp1:
      round(
        tp1,
        3
      ),


    tp2:
      round(
        tp2,
        3
      ),


    tp1R:
      riskReward1,


    tp2R:
      riskReward2,


    exits: {

      tp1: {

        percentage:
          LIVE_SETTINGS.tp1ExitPct,

        r:
          LIVE_SETTINGS.tp1R,

        price:
          round(
            tp1,
            3
          )

      },

      tp2: {

        percentage:
          LIVE_SETTINGS.tp2ExitPct,

        r:
          LIVE_SETTINGS.tp2R,

        price:
          round(
            tp2,
            3
          )

      }

    },


    account: {

      balance:
        round(
          accountBalance,
          2
        ),

      currency:
        "ZAR",

      riskPct:
        LIVE_SETTINGS.riskPct,

      maxRiskZar:
        round(
          riskAmount,
          2
        )

    },


    execution: {

      timeframe:
        "M5",

      confirmation:
        [
          "M15",
          "H1"
        ],

      spread:
        LIVE_SETTINGS.spread,

      slippage:
        LIVE_SETTINGS.slippage,

      maxHoldBars:
        LIVE_SETTINGS.maxHoldBars,

      maxHoldMinutes:
        LIVE_SETTINGS.maxHoldMinutes,

      maxTrades:
        LIVE_SETTINGS.maxTrades,

      expiresAt:

        signal ===
        "WAIT"

          ?

          null

          :

          new Date(
            expiresAt
          )
            .toISOString()

    },


    confirmation: {

      m5:
        structure.m5.bias,

      m15:
        structure.m15.bias,

      h1:
        structure.h1.bias,

      h4:
        structure.h4.bias,

      m15Required:
        LIVE_SETTINGS
          .requireM15Confirmation,

      h1Required:
        LIVE_SETTINGS
          .requireH1Confirmation,

      buyM15Confirmed,

      buyH1Confirmed,

      sellM15Confirmed,

      sellH1Confirmed

    },


    liquidityTarget:

      selectedPool

        ?

        {

          name:
            selectedPool.name,

          side:
            selectedPool.side,

          type:
            selectedPool.type,

          level:
            selectedPool.level,

          likelihoodScore:
            selectedPool.likelihoodScore,

          likelihood:
            selectedPool.likelihood,

          projectedSweep:
            selectedPool.projectedSweep

        }

        :

        null,


    reasons:
      reasons.slice(
        0,
        10
      ),


    blockedBy,


    note:

      signal ===
      "WAIT"

        ?

        `No valid trade until score >= ${LIVE_SETTINGS.minScore} with M15 + H1 confirmation.`

        :

        `Signal meets score ${LIVE_SETTINGS.minScore}+ with M15 + H1 confirmation. TP1 closes 50% at ${LIVE_SETTINGS.tp1R}R and TP2 closes the remaining 50% at ${LIVE_SETTINGS.tp2R}R.`

  };

}


/* =========================================================
   LIVE STOP LOSS
========================================================= */

function buildLiveStop({

  side,

  entry,

  m5,

  atr5

}) {

  const recent =
    m5.slice(
      -18
    );


  const minDistance =
    atr5 *
    LIVE_SETTINGS.minStopAtr;


  const maxDistance =
    atr5 *
    LIVE_SETTINGS.maxStopAtr;


  const buffer =
    atr5 *
    LIVE_SETTINGS.stopAtrBuffer;


  if (
    side ===
    "BUY"
  ) {

    const structureLow =
      Math.min(

        ...recent.map(
          b =>
            b.low
        )

      );


    let candidate =
      structureLow -
      buffer;


    let distance =
      entry -
      candidate;


    if (
      !Number.isFinite(
        distance
      )

      ||

      distance <=
      0

    ) {

      distance =
        minDistance;

    }


    distance =
      clamp(

        distance,

        minDistance,

        maxDistance

      );


    return entry -
      distance;

  }


  const structureHigh =
    Math.max(

      ...recent.map(
        b =>
          b.high
      )

    );


  let candidate =
    structureHigh +
    buffer;


  let distance =
    candidate -
    entry;


  if (
    !Number.isFinite(
      distance
    )

    ||

    distance <=
    0

  ) {

    distance =
      minDistance;

  }


  distance =
    clamp(

      distance,

      minDistance,

      maxDistance

    );


  return entry +
    distance;

}


/* =========================================================
   COMPLETED CANDLES
========================================================= */

function completedBars(
  bars,
  timeframeMinutes
) {

  const duration =
    timeframeMinutes *
    60_000;


  const now =
    Date.now();


  return bars.filter(

    b =>

      b.ts +
      duration <=
      now

  );

}


/* =========================================================
   TWELVE DATA
========================================================= */

async function fetchTdSeries(
  interval,
  outputsize
) {

  const url =
    new URL(
      `${TD_BASE}/time_series`
    );


  url.searchParams.set(
    "symbol",
    SYMBOL
  );


  url.searchParams.set(
    "interval",
    interval
  );


  url.searchParams.set(
    "outputsize",
    String(
      outputsize
    )
  );


  url.searchParams.set(
    "timezone",
    "UTC"
  );


  url.searchParams.set(
    "format",
    "JSON"
  );


  url.searchParams.set(
    "apikey",
    TD_KEY
  );


  const response =
    await fetch(
      url,
      {

        headers: {

          "User-Agent":
            "MKAYFX-XAU-Liquidity/2.0"

        }

      }
    );


  if (
    !response.ok
  ) {

    throw new Error(

      `Twelve Data ${interval} HTTP ${response.status}`

    );

  }


  const json =
    await response.json();


  if (
    json.status ===
    "error"
  ) {

    throw new Error(

      `Twelve Data ${interval}: ` +

      (
        json.message
        ||
        json.code
        ||
        "API error"
      )

    );

  }


  if (
    !Array.isArray(
      json.values
    )
  ) {

    throw new Error(

      `Twelve Data ${interval}: missing values`

    );

  }


  return json;

}


/* =========================================================
   PARSE TWELVE DATA
========================================================= */

function parseTdSeries(
  json,
  intraday
) {

  return json.values

    .map(
      v => {

        const ts =
          parseTdTime(
            v.datetime,
            intraday
          );


        return {

          ts,

          open:
            num(
              v.open
            ),

          high:
            num(
              v.high
            ),

          low:
            num(
              v.low
            ),

          close:
            num(
              v.close
            ),

          volume:
            num(
              v.volume
            )

        };

      }
    )

    .filter(
      b =>

        Number.isFinite(
          b.ts
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
        a.ts -
        b.ts
    );

}


function parseTdTime(
  value,
  intraday
) {

  if (
    !value
  ) {

    return NaN;

  }


  if (
    intraday
  ) {

    return Date.parse(

      String(
        value
      )
        .replace(
          " ",
          "T"
        )

      +

      "Z"

    );

  }


  return Date.parse(

    `${String(value).slice(0, 10)}T00:00:00Z`

  );

}


/* =========================================================
   FRED MACRO
========================================================= */

async function getMacroContext() {

  if (
    !FRED_KEY
  ) {

    return {

      enabled:
        false,

      score:
        0,

      bias:
        "UNAVAILABLE",

      note:
        "Add FRED_API_KEY to enable Treasury yield, real yield and broad USD context.",

      series:
        []

    };

  }


  const now =
    Date.now();


  if (

    macroCache.payload

    &&

    now -
    macroCache.at <
    MACRO_CACHE_MS

  ) {

    return macroCache.payload;

  }


  try {

    const defs = [

      {
        id:
          "DGS2",

        label:
          "US 2Y yield",

        goldSign:
          -1
      },

      {
        id:
          "DGS10",

        label:
          "US 10Y yield",

        goldSign:
          -1
      },

      {
        id:
          "DFII10",

        label:
          "US 10Y real yield",

        goldSign:
          -1
      },

      {
        id:
          "DTWEXBGS",

        label:
          "Broad USD index",

        goldSign:
          -1
      }

    ];


    const values =
      await Promise.all(

        defs.map(

          async def => ({

            ...def,

            ...(
              await fetchFredSeries(
                def.id
              )
            )

          })

        )

      );


    let weighted =
      0;


    let weightSum =
      0;


    for (
      const s of values
    ) {

      if (
        !Number.isFinite(
          s.changePct
        )
      ) {

        continue;

      }


      const scale =

        s.id ===
        "DTWEXBGS"

          ?

          0.35

          :

          0.08;


      const component =
        clamp(

          s.goldSign

          *

          (
            s.changePct /
            scale
          )

          *

          25,

          -25,

          25

        );


      const weight =

        s.id ===
        "DFII10"

          ?

          1.3

          :

          1;


      weighted +=
        component *
        weight;


      weightSum +=
        weight;


      s.goldPressure =
        round(
          component,
          1
        );

    }


    const score =

      weightSum

        ?

        clamp(

          weighted /
          weightSum,

          -100,

          100

        )

        :

        0;


    const payload = {

      enabled:
        true,

      score:
        round(
          score,
          1
        ),

      bias:

        score >=
        20

          ?

          "GOLD SUPPORTIVE"

          :

          score <=
          -20

            ?

            "GOLD HEADWIND"

            :

            "MIXED / NEUTRAL",

      note:
        "FRED macro data can be delayed. Use it as context, not an execution feed.",

      series:
        values.map(
          s => ({

            id:
              s.id,

            label:
              s.label,

            value:
              round(
                s.value,
                4
              ),

            previous:
              round(
                s.previous,
                4
              ),

            change:
              round(
                s.change,
                4
              ),

            changePct:
              round(
                s.changePct,
                3
              ),

            date:
              s.date,

            previousDate:
              s.previousDate,

            goldPressure:
              s.goldPressure
              ??
              0

          })
        )

    };


    macroCache = {

      at:
        now,

      payload

    };


    return payload;


  } catch (
    error
  ) {

    return {

      enabled:
        false,

      score:
        0,

      bias:
        "UNAVAILABLE",

      note:
        `FRED error: ${error?.message || "unknown"}`,

      series:
        []

    };

  }

}


async function fetchFredSeries(
  seriesId
) {

  const url =
    new URL(
      `${FRED_BASE}/series/observations`
    );


  url.searchParams.set(
    "series_id",
    seriesId
  );


  url.searchParams.set(
    "api_key",
    FRED_KEY
  );


  url.searchParams.set(
    "file_type",
    "json"
  );


  url.searchParams.set(
    "sort_order",
    "desc"
  );


  url.searchParams.set(
    "order_by",
    "observation_date"
  );


  url.searchParams.set(
    "limit",
    "12"
  );


  const response =
    await fetch(
      url
    );


  if (
    !response.ok
  ) {

    throw new Error(

      `FRED ${seriesId} HTTP ${response.status}`

    );

  }


  const json =
    await response.json();


  const valid =
    (
      json.observations
      ||
      []
    )

      .filter(
        x =>

          x.value !==
          "."

          &&

          Number.isFinite(
            Number(
              x.value
            )
          )
      )

      .slice(
        0,
        2
      );


  if (
    valid.length <
    2
  ) {

    throw new Error(

      `FRED ${seriesId}: insufficient observations`

    );

  }


  const latest =
    Number(
      valid[0].value
    );


  const previous =
    Number(
      valid[1].value
    );


  const change =
    latest -
    previous;


  const changePct =

    previous !==
    0

      ?

      (
        change /
        Math.abs(
          previous
        )
      )

      *

      100

      :

      0;


  return {

    value:
      latest,

    previous,

    change,

    changePct,

    date:
      valid[0].date,

    previousDate:
      valid[1].date

  };

}


/* =========================================================
   SESSION ENGINE
========================================================= */

function buildSessionState(
  m1
) {

  const now =
    new Date();


  return SESSION_DEFS.map(
    def => {

      const active =
        sessionActiveAt(
          now,
          def
        );


      const transition =
        nextSessionTransition(
          now,
          def
        );


      const phase =
        sessionPhase(
          now,
          def
        );


      const range =
        latestSessionRange(
          m1,
          def
        );


      return {

        id:
          def.id,

        name:
          def.name,

        short:
          def.short,

        zone:
          def.zone,

        active,

        phase:
          phase.name,

        phaseProgress:
          phase.progress,

        localTime:
          zonedClock(
            now,
            def.zone
          ),

        nextEvent:
          transition.type,

        nextEventAt:
          transition.at
            .toISOString(),

        nextEventInSeconds:
          Math.max(

            0,

            Math.round(

              (
                transition.at.getTime()
                -
                now.getTime()
              )

              /

              1000

            )

          ),

        openLocal:
          minutesLabel(
            def.open
          ),

        closeLocal:
          minutesLabel(
            def.close
          ),

        range

      };

    }
  );

}


function sessionActiveAt(
  date,
  def
) {

  const p =
    zonedParts(
      date,
      def.zone
    );


  if (

    p.weekday ===
    0

    ||

    p.weekday ===
    6

  ) {

    return false;

  }


  const minute =
    p.hour *
    60

    +

    p.minute;


  return (

    minute >=
    def.open

    &&

    minute <
    def.close

  );

}


function sessionPhase(
  date,
  def
) {

  const p =
    zonedParts(
      date,
      def.zone
    );


  const minute =
    p.hour *
    60

    +

    p.minute;


  const active =
    sessionActiveAt(
      date,
      def
    );


  if (
    !active
  ) {

    const beforeOpen =

      p.weekday >=
      1

      &&

      p.weekday <=
      5

      &&

      minute <
      def.open;


    const minsToOpen =

      beforeOpen

        ?

        def.open -
        minute

        :

        Infinity;


    if (
      minsToOpen <=
      75
    ) {

      return {

        name:
          "PRE-OPEN LIQUIDITY WINDOW",

        progress:
          0

      };

    }


    return {

      name:
        "CLOSED",

      progress:
        0

    };

  }


  const elapsed =
    minute -
    def.open;


  const duration =
    def.close -
    def.open;


  const progress =
    clamp(

      (
        elapsed /
        duration
      )

      *

      100,

      0,

      100

    );


  if (
    elapsed <=
    90
  ) {

    return {

      name:
        "OPENING LIQUIDITY WINDOW",

      progress:
        round(
          progress,
          1
        )

    };

  }


  if (
    def.close -
    minute <=
    60
  ) {

    return {

      name:
        "CLOSING WINDOW",

      progress:
        round(
          progress,
          1
        )

    };

  }


  return {

    name:
      "MID SESSION",

    progress:
      round(
        progress,
        1
      )

  };

}


function nextSessionTransition(
  from,
  def
) {

  const start =
    new Date(
      from.getTime()
    );


  start.setUTCSeconds(
    0,
    0
  );


  let previous =
    sessionActiveAt(
      start,
      def
    );


  for (

    let i =
      1;

    i <=
    8 *
    24 *
    60;

    i++

  ) {

    const date =
      new Date(

        start.getTime()

        +

        i *
        60_000

      );


    const state =
      sessionActiveAt(
        date,
        def
      );


    if (
      state !==
      previous
    ) {

      return {

        type:
          state
            ?
            "OPEN"
            :
            "CLOSE",

        at:
          date

      };

    }


    previous =
      state;

  }


  return {

    type:
      previous
        ?
        "CLOSE"
        :
        "OPEN",

    at:
      new Date(

        start.getTime()

        +

        24 *
        60 *
        60_000

      )

  };

}


function latestSessionRange(
  bars,
  def
) {

  const groups =
    new Map();


  for (
    const b of bars
  ) {

    const date =
      new Date(
        b.ts
      );


    const p =
      zonedParts(
        date,
        def.zone
      );


    if (

      p.weekday ===
      0

      ||

      p.weekday ===
      6

    ) {

      continue;

    }


    const minute =
      p.hour *
      60

      +

      p.minute;


    if (

      minute <
      def.open

      ||

      minute >=
      def.close

    ) {

      continue;

    }


    const key =

      `${p.year}-` +

      `${pad2(p.month)}-` +

      `${pad2(p.day)}`;


    if (
      !groups.has(
        key
      )
    ) {

      groups.set(
        key,
        []
      );

    }


    groups
      .get(
        key
      )
      .push(
        b
      );

  }


  const keys =
    Array.from(
      groups.keys()
    )
      .sort();


  const key =
    keys[
      keys.length -
      1
    ];


  if (
    !key
  ) {

    return null;

  }


  const rows =
    groups.get(
      key
    );


  const high =
    Math.max(

      ...rows.map(
        b =>
          b.high
      )

    );


  const low =
    Math.min(

      ...rows.map(
        b =>
          b.low
      )

    );


  const open =
    rows[0].open;


  const close =
    rows[
      rows.length -
      1
    ].close;


  return {

    date:
      key,

    high:
      round(
        high,
        3
      ),

    low:
      round(
        low,
        3
      ),

    open:
      round(
        open,
        3
      ),

    close:
      round(
        close,
        3
      ),

    midpoint:
      round(

        (
          high +
          low
        )

        /

        2,

        3

      ),

    range:
      round(
        high -
        low,
        3
      ),

    bars:
      rows.length,

    complete:

      rows.length

      >=

      Math.floor(

        (
          def.close -
          def.open
        )

        *

        0.85

      )

  };

}


function zonedParts(
  date,
  timeZone
) {

  const parts =
    new Intl.DateTimeFormat(

      "en-CA",

      {

        timeZone,

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",

        hour:
          "2-digit",

        minute:
          "2-digit",

        hourCycle:
          "h23",

        weekday:
          "short"

      }

    )
      .formatToParts(
        date
      );


  const obj = {};


  for (
    const p of parts
  ) {

    if (
      p.type !==
      "literal"
    ) {

      obj[p.type] =
        p.value;

    }

  }


  const week = {

    Sun:
      0,

    Mon:
      1,

    Tue:
      2,

    Wed:
      3,

    Thu:
      4,

    Fri:
      5,

    Sat:
      6

  };


  return {

    year:
      Number(
        obj.year
      ),

    month:
      Number(
        obj.month
      ),

    day:
      Number(
        obj.day
      ),

    hour:
      Number(
        obj.hour
      ),

    minute:
      Number(
        obj.minute
      ),

    weekday:
      week[
        obj.weekday
      ]

  };

}


function zonedClock(
  date,
  zone
) {

  return new Intl.DateTimeFormat(

    "en-GB",

    {

      timeZone:
        zone,

      hour:
        "2-digit",

      minute:
        "2-digit",

      second:
        "2-digit",

      hourCycle:
        "h23"

    }

  )
    .format(
      date
    );

}


/* =========================================================
   RESAMPLING
========================================================= */

function resample(
  bars,
  minutes
) {

  const bucketMs =
    minutes *
    60_000;


  const out =
    [];


  let current =
    null;


  for (
    const b of bars
  ) {

    const bucket =

      Math.floor(

        b.ts /
        bucketMs

      )

      *

      bucketMs;


    if (

      !current

      ||

      current.ts !==
      bucket

    ) {

      if (
        current
      ) {

        out.push(
          current
        );

      }


      current = {

        ts:
          bucket,

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

            ?

            b.volume

            :

            0

      };

    }

    else {

      current.high =
        Math.max(

          current.high,
          b.high

        );


      current.low =
        Math.min(

          current.low,
          b.low

        );


      current.close =
        b.close;


      current.volume +=

        Number.isFinite(
          b.volume
        )

          ?

          b.volume

          :

          0;

    }

  }


  if (
    current
  ) {

    out.push(
      current
    );

  }


  return out;

}


/* =========================================================
   TIMEFRAME STATE
========================================================= */

function timeframeState(
  bars
) {

  if (
    !bars.length
  ) {

    return {

      bias:
        "NEUTRAL",

      score:
        0,

      close:
        null,

      ema20:
        null,

      ema50:
        null,

      ema200:
        null,

      rsi14:
        50,

      atr14:
        null,

      slope:
        0

    };

  }


  const closes =
    bars.map(
      b =>
        b.close
    );


  const e20 =
    ema(
      closes,
      20
    );


  const e50 =
    ema(
      closes,
      50
    );


  const e200 =
    ema(

      closes,

      Math.min(

        200,

        Math.max(

          20,

          Math.floor(
            bars.length /
            2
          )

        )

      )

    );


  const atrValues =
    atr(
      bars,
      14
    );


  const rsiValues =
    rsi(
      closes,
      14
    );


  const last =
    bars[
      bars.length -
      1
    ];


  const e20v =
    lastFinite(
      e20
    );


  const e50v =
    lastFinite(
      e50
    );


  const e200v =
    lastFinite(
      e200
    );


  const atrv =
    lastFinite(
      atrValues
    )
    ||
    0;


  const rsiv =
    lastFinite(
      rsiValues
    )
    ||
    50;


  const slopeLookback =
    Math.min(

      5,

      e20.length -
      1

    );


  const previous20 =

    e20[

      e20.length -
      1 -
      slopeLookback

    ];


  const slope =

    Number.isFinite(
      previous20
    )

    &&

    Number.isFinite(
      e20v
    )

    &&

    atrv >
    0

      ?

      (
        e20v -
        previous20
      )

      /

      atrv

      :

      0;


  let score =
    0;


  if (

    Number.isFinite(
      e20v
    )

    &&

    last.close >
    e20v

  ) {

    score++;

  }

  else {

    score--;

  }


  if (

    Number.isFinite(
      e20v
    )

    &&

    Number.isFinite(
      e50v
    )

    &&

    e20v >
    e50v

  ) {

    score++;

  }

  else {

    score--;

  }


  if (

    Number.isFinite(
      e50v
    )

    &&

    Number.isFinite(
      e200v
    )

    &&

    e50v >
    e200v

  ) {

    score++;

  }

  else {

    score--;

  }


  if (
    slope >
    0.15
  ) {

    score++;

  }


  if (
    slope <
    -0.15
  ) {

    score--;

  }


  if (
    rsiv >
    55
  ) {

    score +=
      0.5;

  }


  if (
    rsiv <
    45
  ) {

    score -=
      0.5;

  }


  let bias =
    "NEUTRAL";


  if (
    score >=
    2
  ) {

    bias =
      "BULLISH";

  }


  if (
    score <=
    -2
  ) {

    bias =
      "BEARISH";

  }


  return {

    bias,

    score:
      round(
        score,
        2
      ),

    close:
      round(
        last.close,
        3
      ),

    ema20:
      round(
        e20v,
        3
      ),

    ema50:
      round(
        e50v,
        3
      ),

    ema200:
      round(
        e200v,
        3
      ),

    rsi14:
      round(
        rsiv,
        1
      ),

    atr14:
      round(
        atrv,
        3
      ),

    slope:
      round(
        slope,
        3
      )

  };

}


/* =========================================================
   EMA
========================================================= */

function ema(
  values,
  period
) {

  if (
    !values.length
  ) {

    return [];

  }


  const k =
    2 /
    (
      period +
      1
    );


  const out =
    new Array(
      values.length
    )
      .fill(
        null
      );


  let previous =
    values[0];


  out[0] =
    previous;


  for (
    let i =
      1;

    i <
      values.length;

    i++
  ) {

    previous =

      values[i] *
      k

      +

      previous *
      (
        1 -
        k
      );


    out[i] =
      previous;

  }


  return out;

}


/* =========================================================
   RSI
========================================================= */

function rsi(
  values,
  period = 14
) {

  const out =
    new Array(
      values.length
    )
      .fill(
        null
      );


  if (
    values.length <=
    period
  ) {

    return out;

  }


  let gain =
    0;


  let loss =
    0;


  for (
    let i =
      1;

    i <=
      period;

    i++
  ) {

    const delta =

      values[i] -
      values[i - 1];


    gain +=
      Math.max(
        delta,
        0
      );


    loss +=
      Math.max(
        -delta,
        0
      );

  }


  let averageGain =
    gain /
    period;


  let averageLoss =
    loss /
    period;


  out[period] =

    averageLoss ===
    0

      ?

      100

      :

      100

      -

      100 /
      (
        1 +
        averageGain /
        averageLoss
      );


  for (

    let i =
      period +
      1;

    i <
      values.length;

    i++

  ) {

    const delta =

      values[i] -
      values[i - 1];


    averageGain =

      (
        averageGain *
        (
          period -
          1
        )

        +

        Math.max(
          delta,
          0
        )
      )

      /

      period;


    averageLoss =

      (
        averageLoss *
        (
          period -
          1
        )

        +

        Math.max(
          -delta,
          0
        )
      )

      /

      period;


    out[i] =

      averageLoss ===
      0

        ?

        100

        :

        100

        -

        100 /
        (
          1 +
          averageGain /
          averageLoss
        );

  }


  return out;

}


/* =========================================================
   ATR
========================================================= */

function atr(
  bars,
  period = 14
) {

  const trueRanges =
    bars.map(

      (
        b,
        i
      ) => {

        if (
          i ===
          0
        ) {

          return b.high -
            b.low;

        }


        const previousClose =
          bars[
            i - 1
          ].close;


        return Math.max(

          b.high -
          b.low,

          Math.abs(
            b.high -
            previousClose
          ),

          Math.abs(
            b.low -
            previousClose
          )

        );

      }

    );


  const out =
    new Array(
      bars.length
    )
      .fill(
        null
      );


  if (
    trueRanges.length <
    period
  ) {

    return out;

  }


  let total =
    0;


  for (
    let i =
      0;

    i <
      period;

    i++
  ) {

    total +=
      trueRanges[i];

  }


  let previous =
    total /
    period;


  out[
    period -
    1
  ] =
    previous;


  for (

    let i =
      period;

    i <
      trueRanges.length;

    i++

  ) {

    previous =

      (
        previous *
        (
          period -
          1
        )

        +

        trueRanges[i]

      )

      /

      period;


    out[i] =
      previous;

  }


  return out;

}


/* =========================================================
   PREVIOUS DAY / WEEK
========================================================= */

function buildDayLevels(
  d1,
  price
) {

  const completed =
    d1.filter(

      b =>
        b.ts <
        startOfUtcDay(
          Date.now()
        )

    );


  const previousDay =

    completed[
      completed.length -
      1
    ]

    ||

    d1[
      d1.length -
      2
    ];


  const weeks =
    new Map();


  for (
    const b of completed
  ) {

    const key =
      isoWeekKey(
        new Date(
          b.ts
        )
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
        b
      );

  }


  const weekKeys =
    Array.from(
      weeks.keys()
    )
      .sort();


  const previousWeekKey =

    weekKeys[
      weekKeys.length -
      2
    ]

    ||

    weekKeys[
      weekKeys.length -
      1
    ];


  const previousWeek =
    weeks.get(
      previousWeekKey
    )
    ||
    [];


  const pwh =

    previousWeek.length

      ?

      Math.max(

        ...previousWeek.map(
          b =>
            b.high
        )

      )

      :

      null;


  const pwl =

    previousWeek.length

      ?

      Math.min(

        ...previousWeek.map(
          b =>
            b.low
        )

      )

      :

      null;


  return {

    previousDay:

      previousDay

        ?

        {

          high:
            round(
              previousDay.high,
              3
            ),

          low:
            round(
              previousDay.low,
              3
            ),

          open:
            round(
              previousDay.open,
              3
            ),

          close:
            round(
              previousDay.close,
              3
            ),

          midpoint:
            round(

              (
                previousDay.high +
                previousDay.low
              )

              /

              2,

              3

            ),

          positionPct:
            round(

              (
                (
                  price -
                  previousDay.low
                )

                /

                Math.max(

                  previousDay.high -
                  previousDay.low,

                  1e-9

                )
              )

              *

              100,

              1

            )

        }

        :

        null,


    previousWeek:

      Number.isFinite(
        pwh
      )

      &&

      Number.isFinite(
        pwl
      )

        ?

        {

          high:
            round(
              pwh,
              3
            ),

          low:
            round(
              pwl,
              3
            ),

          midpoint:
            round(

              (
                pwh +
                pwl
              )

              /

              2,

              3

            ),

          week:
            previousWeekKey

        }

        :

        null

  };

}


function isoWeekKey(
  date
) {

  const d =
    new Date(

      Date.UTC(

        date.getUTCFullYear(),

        date.getUTCMonth(),

        date.getUTCDate()

      )

    );


  const day =
    d.getUTCDay()
    ||
    7;


  d.setUTCDate(

    d.getUTCDate()

    +

    4

    -

    day

  );


  const yearStart =
    new Date(

      Date.UTC(

        d.getUTCFullYear(),

        0,

        1

      )

    );


  const week =
    Math.ceil(

      (
        (
          (
            d -
            yearStart
          )

          /

          86400000
        )

        +

        1

      )

      /

      7

    );


  return (

    `${d.getUTCFullYear()}-W`

    +

    `${pad2(week)}`

  );

}


/* =========================================================
   SWING LEVELS
========================================================= */

function detectSwingLevels(
  bars,
  pivot = 3,
  lookback = 80
) {

  const start =
    Math.max(

      pivot,

      bars.length -
      lookback

    );


  const highs =
    [];


  const lows =
    [];


  for (

    let i =
      start;

    i <
      bars.length -
      pivot;

    i++

  ) {

    let pivotHigh =
      true;


    let pivotLow =
      true;


    for (

      let j =
        i -
        pivot;

      j <=
        i +
        pivot;

      j++

    ) {

      if (
        j ===
        i
      ) {

        continue;

      }


      if (
        bars[j].high >=
        bars[i].high
      ) {

        pivotHigh =
          false;

      }


      if (
        bars[j].low <=
        bars[i].low
      ) {

        pivotLow =
          false;

      }

    }


    if (
      pivotHigh
    ) {

      highs.push({

        price:
          bars[i].high,

        ts:
          bars[i].ts

      });

    }


    if (
      pivotLow
    ) {

      lows.push({

        price:
          bars[i].low,

        ts:
          bars[i].ts

      });

    }

  }


  return {

    highs:
      highs

        .slice(
          -6
        )

        .reverse()

        .map(
          x => ({

            price:
              round(
                x.price,
                3
              ),

            time:
              new Date(
                x.ts
              )
                .toISOString()

          })
        ),


    lows:
      lows

        .slice(
          -6
        )

        .reverse()

        .map(
          x => ({

            price:
              round(
                x.price,
                3
              ),

            time:
              new Date(
                x.ts
              )
                .toISOString()

          })
        )

  };

}


/* =========================================================
   EQUAL HIGH / LOWS
========================================================= */

function detectEqualLevels(
  bars,
  atrValue
) {

  const recent =
    bars.slice(
      -120
    );


  const pivots =
    detectSwingLevels(

      recent,

      2,

      recent.length

    );


  const tolerance =
    Math.max(

      atrValue *
      0.12,

      0.15

    );


  return {

    highs:
      clusterEqual(

        pivots.highs,

        tolerance,

        "EQH"

      ),

    lows:
      clusterEqual(

        pivots.lows,

        tolerance,

        "EQL"

      )

  };

}


function clusterEqual(
  levels,
  tolerance,
  type
) {

  const clusters =
    [];


  const used =
    new Set();


  for (

    let i =
      0;

    i <
      levels.length;

    i++

  ) {

    if (
      used.has(
        i
      )
    ) {

      continue;

    }


    const group = [
      levels[i]
    ];


    used.add(
      i
    );


    for (

      let j =
        i + 1;

      j <
        levels.length;

      j++

    ) {

      if (
        used.has(
          j
        )
      ) {

        continue;

      }


      if (

        Math.abs(

          levels[j].price

          -

          levels[i].price

        )

        <=

        tolerance

      ) {

        group.push(
          levels[j]
        );


        used.add(
          j
        );

      }

    }


    if (
      group.length >=
      2
    ) {

      clusters.push({

        type,

        price:
          round(

            avg(

              group.map(
                g =>
                  g.price
              )

            ),

            3

          ),

        touches:
          group.length,

        tolerance:
          round(
            tolerance,
            3
          )

      });

    }

  }


  return clusters.slice(
    0,
    4
  );

}


/* =========================================================
   FAIR VALUE GAPS
========================================================= */

function detectFvgs(
  bars,
  price,
  lookback = 80
) {

  const out =
    [];


  const start =
    Math.max(

      2,

      bars.length -
      lookback

    );


  for (

    let i =
      start;

    i <
      bars.length;

    i++

  ) {

    const first =
      bars[
        i - 2
      ];


    const third =
      bars[i];


    if (
      third.low >
      first.high
    ) {

      const low =
        first.high;


      const high =
        third.low;


      out.push({

        type:
          "BULLISH FVG",

        low:
          round(
            low,
            3
          ),

        high:
          round(
            high,
            3
          ),

        midpoint:
          round(

            (
              low +
              high
            )

            /

            2,

            3

          ),

        distance:
          round(

            Math.abs(

              price

              -

              (
                low +
                high
              )

              /

              2

            ),

            3

          ),

        time:
          new Date(
            third.ts
          )
            .toISOString()

      });

    }


    if (
      third.high <
      first.low
    ) {

      const low =
        third.high;


      const high =
        first.low;


      out.push({

        type:
          "BEARISH FVG",

        low:
          round(
            low,
            3
          ),

        high:
          round(
            high,
            3
          ),

        midpoint:
          round(

            (
              low +
              high
            )

            /

            2,

            3

          ),

        distance:
          round(

            Math.abs(

              price

              -

              (
                low +
                high
              )

              /

              2

            ),

            3

          ),

        time:
          new Date(
            third.ts
          )
            .toISOString()

      });

    }

  }


  return out

    .sort(
      (
        a,
        b
      ) =>
        a.distance -
        b.distance
    )

    .slice(
      0,
      6
    );

}


/* =========================================================
   FOOTPRINT PROXY
========================================================= */

function buildFootprint(
  m1,
  atr5
) {

  const recent =
    m1.slice(
      -240
    );


  const nonZeroVolume =
    recent.filter(

      b =>

        Number.isFinite(
          b.volume
        )

        &&

        b.volume >
        0

    );


  const realVolume =

    nonZeroVolume.length

    >=

    recent.length *
    0.65;


  const ranges =
    recent.map(

      b =>
        Math.max(

          b.high -
          b.low,

          1e-9

        )

    );


  const rangeMedian =
    median(
      ranges
    )

    ||

    atr5 /
    5

    ||

    1;


  const rows =
    recent.map(
      b => {

        const range =
          Math.max(

            b.high -
            b.low,

            1e-9

          );


        const closeLocation =

          (
            (
              b.close -
              b.low
            )

            -

            (
              b.high -
              b.close
            )
          )

          /

          range;


        const body =

          (
            b.close -
            b.open
          )

          /

          range;


        const activity =

          realVolume

            ?

            Math.max(

              b.volume
              ||
              0,

              1

            )

            :

            clamp(

              range

              /

              Math.max(
                rangeMedian,
                1e-9
              ),

              0.15,

              5

            )

            *

            100;


        const buyShare =
          clamp(

            0.5

            +

            0.28 *
            closeLocation

            +

            0.22 *
            body,

            0.05,

            0.95

          );


        const buy =
          activity *
          buyShare;


        const sell =
          activity -
          buy;


        const delta =
          buy -
          sell;


        return {

          ts:
            b.ts,

          price:
            b.close,

          activity,

          buy,

          sell,

          delta,

          deltaPct:

            activity

              ?

              (
                delta /
                activity
              )

              *

              100

              :

              0

        };

      }
    );


  let cvd =
    0;


  for (
    const row of rows
  ) {

    cvd +=
      row.delta;


    row.cvd =
      cvd;

  }


  const last5 =
    aggregateFootprint(

      rows.slice(
        -5
      )

    );


  const last15 =
    aggregateFootprint(

      rows.slice(
        -15
      )

    );


  const last30 =
    aggregateFootprint(

      rows.slice(
        -30
      )

    );


  const last60 =
    aggregateFootprint(

      rows.slice(
        -60
      )

    );


  const divergence =
    detectDeltaDivergence(

      rows.slice(
        -30
      )

    );


  const absorption =
    detectAbsorption(

      recent.slice(
        -30
      ),

      rows.slice(
        -30
      )

    );


  return {

    mode:

      realVolume

        ?

        "OHLC + provider volume delta proxy"

        :

        "synthetic range-activity delta proxy",


    hasProviderVolume:
      realVolume,


    trueBidAskFootprint:
      false,


    last5,

    last15,

    last30,

    last60,


    cvd:
      round(
        cvd,
        2
      ),


    divergence,

    absorption,


    latestBars:
      rows

        .slice(
          -12
        )

        .map(
          r => ({

            time:
              new Date(
                r.ts
              )
                .toISOString(),

            price:
              round(
                r.price,
                3
              ),

            activity:
              round(
                r.activity,
                1
              ),

            delta:
              round(
                r.delta,
                1
              ),

            deltaPct:
              round(
                r.deltaPct,
                1
              ),

            cvd:
              round(
                r.cvd,
                1
              )

          })
        )

  };

}


function aggregateFootprint(
  rows
) {

  const activity =
    sum(

      rows.map(
        r =>
          r.activity
      )

    );


  const buy =
    sum(

      rows.map(
        r =>
          r.buy
      )

    );


  const sell =
    sum(

      rows.map(
        r =>
          r.sell
      )

    );


  const delta =
    buy -
    sell;


  return {

    activity:
      round(
        activity,
        1
      ),

    buy:
      round(
        buy,
        1
      ),

    sell:
      round(
        sell,
        1
      ),

    delta:
      round(
        delta,
        1
      ),

    deltaPct:
      round(

        activity

          ?

          (
            delta /
            activity
          )

          *

          100

          :

          0,

        1

      )

  };

}


function detectDeltaDivergence(
  rows
) {

  if (
    rows.length <
    10
  ) {

    return "NONE";

  }


  const half =
    Math.floor(

      rows.length /
      2

    );


  const first =
    rows.slice(
      0,
      half
    );


  const second =
    rows.slice(
      half
    );


  const priceChange =

    second[
      second.length -
      1
    ].price

    -

    first[0].price;


  const deltaChange =
    sum(

      second.map(
        r =>
          r.delta
      )

    );


  if (

    priceChange >
    0

    &&

    deltaChange <
    0

  ) {

    return "PRICE UP / DELTA DOWN";

  }


  if (

    priceChange <
    0

    &&

    deltaChange >
    0

  ) {

    return "PRICE DOWN / DELTA UP";

  }


  return "NONE";

}


/* =========================================================
   ABSORPTION PROXY
========================================================= */

function detectAbsorption(
  bars,
  rows
) {

  if (

    !bars.length

    ||

    bars.length !==
    rows.length

  ) {

    return "NONE";

  }


  const activities =
    rows.map(
      r =>
        r.activity
    );


  const med =
    median(
      activities
    )
    ||
    1;


  let highAbsorb =
    0;


  let lowAbsorb =
    0;


  for (

    let i =
      0;

    i <
      rows.length;

    i++

  ) {

    const row =
      rows[i];


    const bar =
      bars[i];


    const range =
      Math.max(

        bar.high -
        bar.low,

        1e-9

      );


    const upperReject =

      (
        bar.high -
        bar.close
      )

      /

      range;


    const lowerReject =

      (
        bar.close -
        bar.low
      )

      /

      range;


    if (

      row.activity >
      med *
      1.35

      &&

      row.deltaPct >
      18

      &&

      upperReject >
      0.45

    ) {

      highAbsorb++;

    }


    if (

      row.activity >
      med *
      1.35

      &&

      row.deltaPct <
      -18

      &&

      lowerReject >
      0.45

    ) {

      lowAbsorb++;

    }

  }


  if (
    highAbsorb >=
    2
  ) {

    return "BUYING ABSORBED / TRAPPED BUYER RISK";

  }


  if (
    lowAbsorb >=
    2
  ) {

    return "SELLING ABSORBED / TRAPPED SELLER RISK";

  }


  return "NONE";

}


/* =========================================================
   FOOTPRINT AT LIQUIDITY LEVEL
========================================================= */

function footprintAtLevel(
  level,
  side,
  m1,
  atr5
) {

  const recent =
    m1.slice(
      -120
    );


  const distance =
    Math.max(

      atr5 *
      0.28,

      level *
      0.00012

    );


  const nearbyBars =
    recent.filter(

      b =>

        b.high >=
        level -
        distance

        &&

        b.low <=
        level +
        distance

    );


  if (
    !nearbyBars.length
  ) {

    return {

      state:
        "NO RECENT TEST",

      deltaPct:
        0,

      rejection:
        false,

      bars:
        0

    };

  }


  const ranges =
    recent.map(

      b =>
        Math.max(

          b.high -
          b.low,

          1e-9

        )

    );


  const medRange =
    median(
      ranges
    )
    ||
    1;


  let activity =
    0;


  let delta =
    0;


  let rejection =
    false;


  for (
    const b of nearbyBars
  ) {

    const range =
      Math.max(

        b.high -
        b.low,

        1e-9

      );


    const closeLocation =

      (
        (
          b.close -
          b.low
        )

        -

        (
          b.high -
          b.close
        )
      )

      /

      range;


    const body =

      (
        b.close -
        b.open
      )

      /

      range;


    const volume =

      Number.isFinite(
        b.volume
      )

      &&

      b.volume >
      0

        ?

        b.volume

        :

        clamp(

          range /
          medRange,

          0.15,

          5

        )

        *

        100;


    const share =
      clamp(

        0.5

        +

        0.28 *
        closeLocation

        +

        0.22 *
        body,

        0.05,

        0.95

      );


    const d =
      volume *
      (
        share *
        2

        -

        1
      );


    activity +=
      volume;


    delta +=
      d;


    if (

      side ===
      "HIGH"

      &&

      b.high >
      level

      &&

      b.close <
      level

    ) {

      rejection =
        true;

    }


    if (

      side ===
      "LOW"

      &&

      b.low <
      level

      &&

      b.close >
      level

    ) {

      rejection =
        true;

    }

  }


  const deltaPct =

    activity

      ?

      (
        delta /
        activity
      )

      *

      100

      :

      0;


  const last =
    recent[
      recent.length -
      1
    ];


  let state =
    "NEUTRAL";


  if (
    side ===
    "HIGH"
  ) {

    if (

      rejection

      &&

      deltaPct >
      8

    ) {

      state =
        "REVERSAL FAVORED / BUYERS MAY BE TRAPPED";

    }

    else if (

      last.close >
      level

      &&

      deltaPct >
      12

    ) {

      state =
        "ACCEPTANCE ABOVE / DEEPER RAID RISK";

    }

    else if (
      deltaPct >
      20
    ) {

      state =
        "BUY PRESSURE INTO LIQUIDITY";

    }

  }


  if (
    side ===
    "LOW"
  ) {

    if (

      rejection

      &&

      deltaPct <
      -8

    ) {

      state =
        "REVERSAL FAVORED / SELLERS MAY BE TRAPPED";

    }

    else if (

      last.close <
      level

      &&

      deltaPct <
      -12

    ) {

      state =
        "ACCEPTANCE BELOW / DEEPER RAID RISK";

    }

    else if (
      deltaPct <
      -20
    ) {

      state =
        "SELL PRESSURE INTO LIQUIDITY";

    }

  }


  return {

    state,

    deltaPct:
      round(
        deltaPct,
        1
      ),

    rejection,

    bars:
      nearbyBars.length

  };

}


/* =========================================================
   VWAP
========================================================= */

function buildVwap(
  m1
) {

  const start =
    startOfUtcDay(
      Date.now()
    );


  const today =
    m1.filter(

      b =>
        b.ts >=
        start

    );


  const source =

    today.length

      ?

      today

      :

      m1.slice(
        -720
      );


  const hasVolume =

    source.filter(
      b =>
        b.volume >
        0
    ).length

    >=

    source.length *
    0.65;


  const ranges =
    source.map(

      b =>
        Math.max(

          b.high -
          b.low,

          1e-9

        )

    );


  const medRange =
    median(
      ranges
    )
    ||
    1;


  let priceVolume =
    0;


  let volume =
    0;


  for (
    const b of source
  ) {

    const typical =
      (
        b.high +
        b.low +
        b.close
      )

      /

      3;


    const weight =

      hasVolume

        ?

        Math.max(
          b.volume,
          1
        )

        :

        clamp(

          (
            b.high -
            b.low
          )

          /

          medRange,

          0.2,

          5

        );


    priceVolume +=
      typical *
      weight;


    volume +=
      weight;

  }


  return {

    value:

      volume

        ?

        priceVolume /
        volume

        :

        source[
          source.length -
          1
        ].close,


    mode:

      hasVolume

        ?

        "provider-volume VWAP"

        :

        "activity-weighted VWAP proxy"

  };

}


/* =========================================================
   HISTORICAL ASIA SWEEP MODEL
========================================================= */

function buildSweepHistory(
  m5
) {

  const groups =
    new Map();


  for (
    const bar of m5
  ) {

    const p =
      zonedParts(

        new Date(
          bar.ts
        ),

        "Asia/Tokyo"

      );


    if (

      p.weekday ===
      0

      ||

      p.weekday ===
      6

    ) {

      continue;

    }


    const key =

      `${p.year}-` +

      `${pad2(p.month)}-` +

      `${pad2(p.day)}`;


    if (
      !groups.has(
        key
      )
    ) {

      groups.set(
        key,
        []
      );

    }


    groups
      .get(
        key
      )
      .push(
        bar
      );

  }


  const atr5Values =
    atr(
      m5,
      14
    );


  const atrByTs =
    new Map(

      m5.map(

        (
          bar,
          i
        ) => [

          bar.ts,
          atr5Values[i]

        ]

      )

    );


  const highEvents =
    [];


  const lowEvents =
    [];


  let eligibleDays =
    0;


  const keys =
    Array.from(
      groups.keys()
    )
      .sort();


  for (
    const key of keys
  ) {

    const dayBars =
      groups
        .get(
          key
        )
        .sort(
          (
            a,
            b
          ) =>
            a.ts -
            b.ts
        );


    const asia =
      dayBars.filter(
        bar => {

          const p =
            zonedParts(

              new Date(
                bar.ts
              ),

              "Asia/Tokyo"

            );


          const minute =
            p.hour *
            60

            +

            p.minute;


          return (

            minute >=
            9 *
            60

            &&

            minute <
            18 *
            60

          );

        }
      );


    if (
      asia.length <
      80
    ) {

      continue;

    }


    const high =
      Math.max(

        ...asia.map(
          b =>
            b.high
        )

      );


    const low =
      Math.min(

        ...asia.map(
          b =>
            b.low
        )

      );


    const endTs =
      asia[
        asia.length -
        1
      ].ts;


    const after =
      m5.filter(

        b =>

          b.ts >
          endTs

          &&

          b.ts <=

          endTs

          +

          14 *
          60 *
          60_000

      );


    if (
      after.length <
      12
    ) {

      continue;

    }


    eligibleDays++;


    const highEvent =
      analyzeSweepEvent(

        after,

        high,

        "HIGH",

        atrByTs

      );


    const lowEvent =
      analyzeSweepEvent(

        after,

        low,

        "LOW",

        atrByTs

      );


    if (
      highEvent
    ) {

      highEvents.push(
        highEvent
      );

    }


    if (
      lowEvent
    ) {

      lowEvents.push(
        lowEvent
      );

    }

  }


  return {

    lookbackDays:
      eligibleDays,

    asiaHigh:
      summarizeSweepEvents(

        highEvents,
        eligibleDays

      ),

    asiaLow:
      summarizeSweepEvents(

        lowEvents,
        eligibleDays

      )

  };

}


function analyzeSweepEvent(
  after,
  level,
  side,
  atrByTs
) {

  const firstIndex =
    after.findIndex(

      b =>

        side ===
        "HIGH"

          ?

          b.high >
          level

          :

          b.low <
          level

    );


  if (
    firstIndex <
    0
  ) {

    return null;

  }


  const end =
    Math.min(

      after.length,

      firstIndex +
      25

    );


  const segment =
    after.slice(

      firstIndex,
      end

    );


  const atrAt =

    atrByTs.get(

      after[
        firstIndex
      ].ts

    )

    ||

    Math.abs(
      level
    )

    *

    0.001;


  let extension =
    0;


  let reversed =
    false;


  let reversalBars =
    null;


  for (

    let i =
      0;

    i <
      segment.length;

    i++

  ) {

    const bar =
      segment[i];


    const ext =

      side ===
      "HIGH"

        ?

        Math.max(

          0,

          bar.high -
          level

        )

        :

        Math.max(

          0,

          level -
          bar.low

        );


    extension =
      Math.max(

        extension,
        ext

      );


    if (
      i >
      0
    ) {

      const backInside =

        side ===
        "HIGH"

          ?

          bar.close <
          level

          :

          bar.close >
          level;


      if (
        backInside
      ) {

        reversed =
          true;


        reversalBars =
          i;


        break;

      }

    }

  }


  return {

    extension,

    extensionAtr:

      atrAt >
      0

        ?

        extension /
        atrAt

        :

        0,

    reversed,

    reversalBars

  };

}


function summarizeSweepEvents(
  events,
  eligibleDays
) {

  const extensions =
    events

      .map(
        e =>
          e.extensionAtr
      )

      .filter(
        Number.isFinite
      );


  const reversed =
    events.filter(
      e =>
        e.reversed
    );


  return {

    sweeps:
      events.length,


    sweepRatePct:
      round(

        eligibleDays

          ?

          (
            events.length /
            eligibleDays
          )

          *

          100

          :

          0,

        1

      ),


    reversalRatePct:
      round(

        events.length

          ?

          (
            reversed.length /
            events.length
          )

          *

          100

          :

          0,

        1

      ),


    medianOvershootAtr:
      round(

        percentile(
          extensions,
          0.5
        )
        ||
        0,

        3

      ),


    p25OvershootAtr:
      round(

        percentile(
          extensions,
          0.25
        )
        ||
        0,

        3

      ),


    p75OvershootAtr:
      round(

        percentile(
          extensions,
          0.75
        )
        ||
        0,

        3

      ),


    medianReversalBars:
      round(

        median(

          reversed

            .map(
              e =>
                e.reversalBars
            )

            .filter(
              Number.isFinite
            )

        )

        ||

        0,

        1

      )

  };

}


/* =========================================================
   CREATE LIQUIDITY POOLS
========================================================= */

function buildLiquidityPools({

  price,

  sessions,

  dayLevels,

  equalLevels,

  swingLevels,

  atrH1

}) {

  const pools =
    [];


  const add = (

    name,
    level,
    side,
    type,
    importance = 1

  ) => {

    if (
      !Number.isFinite(
        level
      )
    ) {

      return;

    }


    if (

      Math.abs(

        level -
        price

      )

      >

      atrH1 *
      4.5

    ) {

      return;

    }


    pools.push({

      name,

      level,

      side,

      type,

      importance

    });

  };


  const asia =
    sessions.find(
      s =>
        s.id ===
        "tokyo"
    )?.range;


  const london =
    sessions.find(
      s =>
        s.id ===
        "london"
    )?.range;


  const newYork =
    sessions.find(
      s =>
        s.id ===
        "newyork"
    )?.range;


  if (
    asia
  ) {

    add(
      "Asia High",
      asia.high,
      "HIGH",
      "ASIA_HIGH",
      1.25
    );


    add(
      "Asia Low",
      asia.low,
      "LOW",
      "ASIA_LOW",
      1.25
    );

  }


  if (
    london
  ) {

    add(
      "London High",
      london.high,
      "HIGH",
      "SESSION_HIGH",
      1.05
    );


    add(
      "London Low",
      london.low,
      "LOW",
      "SESSION_LOW",
      1.05
    );

  }


  if (
    newYork
  ) {

    add(
      "New York High",
      newYork.high,
      "HIGH",
      "SESSION_HIGH",
      1
    );


    add(
      "New York Low",
      newYork.low,
      "LOW",
      "SESSION_LOW",
      1
    );

  }


  if (
    dayLevels.previousDay
  ) {

    add(
      "Previous Day High",
      dayLevels.previousDay.high,
      "HIGH",
      "PDH",
      1.3
    );


    add(
      "Previous Day Low",
      dayLevels.previousDay.low,
      "LOW",
      "PDL",
      1.3
    );

  }


  if (
    dayLevels.previousWeek
  ) {

    add(
      "Previous Week High",
      dayLevels.previousWeek.high,
      "HIGH",
      "PWH",
      1.4
    );


    add(
      "Previous Week Low",
      dayLevels.previousWeek.low,
      "LOW",
      "PWL",
      1.4
    );

  }


  for (
    const eqh of
      equalLevels.highs
      ||
      []
  ) {

    add(

      `Equal Highs (${eqh.touches}x)`,

      eqh.price,

      "HIGH",

      "EQH",

      1.2

    );

  }


  for (
    const eql of
      equalLevels.lows
      ||
      []
  ) {

    add(

      `Equal Lows (${eql.touches}x)`,

      eql.price,

      "LOW",

      "EQL",

      1.2

    );

  }


  for (
    const swing of

      (
        swingLevels.highs
        ||
        []
      )
        .slice(
          0,
          3
        )
  ) {

    add(

      "H1 Swing High",

      swing.price,

      "HIGH",

      "SWING_HIGH",

      0.95

    );

  }


  for (
    const swing of

      (
        swingLevels.lows
        ||
        []
      )
        .slice(
          0,
          3
        )
  ) {

    add(

      "H1 Swing Low",

      swing.price,

      "LOW",

      "SWING_LOW",

      0.95

    );

  }


  return mergeNearbyPools(

    pools,

    Math.max(

      atrH1 *
      0.06,

      0.2

    )

  );

}


/* =========================================================
   MERGE LIQUIDITY
========================================================= */

function mergeNearbyPools(
  pools,
  tolerance
) {

  const sorted =
    pools
      .slice()
      .sort(
        (
          a,
          b
        ) =>
          a.level -
          b.level
      );


  const out =
    [];


  for (
    const pool of sorted
  ) {

    const last =
      out[
        out.length -
        1
      ];


    if (

      last

      &&

      last.side ===
      pool.side

      &&

      Math.abs(

        last.level -
        pool.level

      )

      <=

      tolerance

    ) {

      if (
        pool.importance >
        last.importance
      ) {

        last.aliases.push(
          last.name
        );


        last.name =
          pool.name;


        last.type =
          pool.type;


        last.importance =
          pool.importance;

      }

      else {

        last.aliases.push(
          pool.name
        );

      }


      last.level =

        (
          last.level +
          pool.level
        )

        /

        2;

    }

    else {

      out.push({

        ...pool,

        aliases:
          []

      });

    }

  }


  return out;

}


/* =========================================================
   LIQUIDITY TARGET SCORING
========================================================= */

function enrichPool({

  pool,

  price,

  atr5,

  atr15,

  structure,

  sessions,

  footprint,

  sweepHistory,

  m1

}) {

  const distance =
    Math.abs(

      pool.level -
      price

    );


  const distanceAtr =

    distance

    /

    Math.max(
      atr15,
      1e-9
    );


  const direction =

    pool.side ===
    "HIGH"

      ?

      1

      :

      -1;


  const momentum =
    clamp(

      (

        structure.m5.score *
        0.35

        +

        structure.m15.score *
        0.35

        +

        structure.h1.score *
        0.3

      )

      /

      4,

      -1,

      1

    );


  const directionalPressure =
    direction *
    momentum;


  const distanceScore =

    38

    *

    Math.exp(

      -distanceAtr /
      1.35

    );


  const importanceScore =

    16

    *

    pool.importance;


  const momentumScore =

    13

    *

    directionalPressure;


  const activeSessionRisk =
    Math.max(

      ...sessions.map(
        s => {

          if (
            !s.active
          ) {

            return 0;

          }


          if (

            s.id ===
            "london"

            ||

            s.id ===
            "newyork"

          ) {

            return s.phase.includes(
              "OPENING"
            )

              ?

              12

              :

              7;

          }


          return 3;

        }
      ),

      0

    );


  const delta =
    footprint.last15.deltaPct
    ||
    0;


  const deltaScore =

    direction

    *

    clamp(

      delta /
      4,

      -8,

      8

    );


  const correctSide =

    pool.side ===
    "HIGH"

      ?

      pool.level >=
      price

      :

      pool.level <=
      price;


  const sidePenalty =

    correctSide

      ?

      0

      :

      -22;


  const nearFlow =
    footprintAtLevel(

      pool.level,

      pool.side,

      m1,

      atr5

    );


  let flowScore =
    0;


  if (
    nearFlow.state.includes(
      "REVERSAL FAVORED"
    )
  ) {

    flowScore +=
      6;

  }


  if (
    nearFlow.state.includes(
      "DEEPER RAID"
    )
  ) {

    flowScore +=
      8;

  }


  if (
    nearFlow.state.includes(
      "PRESSURE"
    )
  ) {

    flowScore +=
      5;

  }


  const likelihoodScore =
    clamp(

      18

      +

      distanceScore

      +

      importanceScore

      +

      momentumScore

      +

      activeSessionRisk

      +

      deltaScore

      +

      flowScore

      +

      sidePenalty,

      5,

      95

    );


  const historical =

    pool.type ===
    "ASIA_HIGH"

      ?

      sweepHistory.asiaHigh

      :

      pool.type ===
      "ASIA_LOW"

        ?

        sweepHistory.asiaLow

        :

        null;


  let p25Atr =

    historical?.p25OvershootAtr

    ||

    0.08;


  let medianAtr =

    historical?.medianOvershootAtr

    ||

    0.18;


  let p75Atr =

    historical?.p75OvershootAtr

    ||

    0.36;


  if (

    historical

    &&

    historical.sweeps <
    3

  ) {

    p25Atr =
      0.08;


    medianAtr =
      0.18;


    p75Atr =
      0.36;

  }


  let depthMultiplier =
    1;


  if (
    nearFlow.state.includes(
      "DEEPER RAID"
    )
  ) {

    depthMultiplier =
      1.35;

  }


  if (
    nearFlow.state.includes(
      "REVERSAL FAVORED"
    )
  ) {

    depthMultiplier =
      0.72;

  }


  const trendStrength =
    Math.abs(
      momentum
    );


  depthMultiplier *=

    1

    +

    trendStrength *
    0.2;


  p25Atr *=
    depthMultiplier;


  medianAtr *=
    depthMultiplier;


  p75Atr *=
    depthMultiplier;


  const sign =

    pool.side ===
    "HIGH"

      ?

      1

      :

      -1;


  const firstZone =

    pool.level

    +

    sign *
    p25Atr *
    atr5;


  const likelyEnd =

    pool.level

    +

    sign *
    medianAtr *
    atr5;


  const secondZone =

    pool.level

    +

    sign *
    p75Atr *
    atr5;


  const zoneLow =
    Math.min(

      firstZone,
      secondZone

    );


  const zoneHigh =
    Math.max(

      firstZone,
      secondZone

    );


  let raidStyle =
    "SHALLOW RAID";


  if (
    medianAtr <
    0.12
  ) {

    raidStyle =
      "TOUCH / VERY SHALLOW RAID";

  }


  if (
    medianAtr >
    0.32
  ) {

    raidStyle =
      "DEEP RAID POSSIBLE";

  }


  if (
    nearFlow.state.includes(
      "DEEPER RAID"
    )
  ) {

    raidStyle =
      "ACCEPTANCE / DEEP RAID RISK";

  }


  const reasons =
    [];


  reasons.push(

    `${round(distanceAtr, 2)}× M15 ATR from current price`

  );


  reasons.push(

    `Liquidity importance ${round(pool.importance, 2)}×`

  );


  if (
    directionalPressure >
    0.2
  ) {

    reasons.push(

      "Multi-timeframe pressure currently points toward this pool"

    );

  }


  if (
    directionalPressure <
    -0.2
  ) {

    reasons.push(

      "Current multi-timeframe pressure points away from this pool"

    );

  }


  if (
    activeSessionRisk >=
    10
  ) {

    reasons.push(

      "Price is inside a major opening liquidity window"

    );

  }


  if (
    Math.abs(
      delta
    ) >=
    15
  ) {

    reasons.push(

      `15m delta proxy ${round(delta, 1)}%`

    );

  }


  if (

    nearFlow.state !==
    "NO RECENT TEST"

    &&

    nearFlow.state !==
    "NEUTRAL"

  ) {

    reasons.push(
      nearFlow.state
    );

  }


  return {

    ...pool,


    level:
      round(
        pool.level,
        3
      ),


    aliases:
      pool.aliases
      ||
      [],


    distance:
      round(
        distance,
        3
      ),


    distanceAtr:
      round(
        distanceAtr,
        2
      ),


    likelihoodScore:
      round(
        likelihoodScore,
        1
      ),


    likelihood:

      likelihoodScore >=
      75

        ?

        "HIGH"

        :

        likelihoodScore >=
        58

          ?

          "MEDIUM"

          :

          "LOW",


    raidStyle,


    projectedSweep: {

      target:
        round(
          pool.level,
          3
        ),

      likelyEnd:
        round(
          likelyEnd,
          3
        ),

      zoneLow:
        round(
          zoneLow,
          3
        ),

      zoneHigh:
        round(
          zoneHigh,
          3
        ),

      overshoot:
        round(

          Math.abs(

            likelyEnd -
            pool.level

          ),

          3

        ),

      overshootAtr:
        round(
          medianAtr,
          3
        ),

      historicalBasis:

        historical

          ?

          `${historical.sweeps} recent Asia ${pool.side.toLowerCase()} sweeps`

          :

          "ATR + current order-flow heuristic"

    },


    nearLevelFootprint:
      nearFlow,


    reasons

  };

}


/* =========================================================
   TRAP WINDOWS
========================================================= */

function buildTrapWindows({

  now,

  sessions,

  pools,

  price,

  atr15

}) {

  const windows =
    [];


  for (
    const session of sessions
  ) {

    let score =
      0;


    const reasons =
      [];


    if (
      session.phase ===
      "OPENING LIQUIDITY WINDOW"
    ) {

      score +=

        session.id ===
        "london"

        ||

        session.id ===
        "newyork"

          ?

          78

          :

          52;


      reasons.push(

        `${session.name} is in its first 90 minutes`

      );

    }

    else if (
      session.phase ===
      "PRE-OPEN LIQUIDITY WINDOW"
    ) {

      score +=

        session.id ===
        "london"

        ||

        session.id ===
        "newyork"

          ?

          70

          :

          45;


      reasons.push(

        `${session.name} opens soon`

      );

    }

    else if (
      session.phase ===
      "CLOSING WINDOW"
    ) {

      score +=
        40;


      reasons.push(

        `${session.name} is in its final hour`

      );

    }

    else if (
      session.active
    ) {

      score +=

        session.id ===
        "london"

        ||

        session.id ===
        "newyork"

          ?

          48

          :

          30;


      reasons.push(

        `${session.name} is active`

      );

    }


    const nearby =
      pools.filter(

        p =>
          p.distance <=
          atr15 *
          0.75

      );


    if (
      nearby.length
    ) {

      score +=
        Math.min(

          18,

          nearby.length *
          6

        );


      reasons.push(

        `${nearby.length} liquidity pool(s) within 0.75× M15 ATR`

      );

    }


    if (
      score >
      0
    ) {

      windows.push({

        session:
          session.name,

        phase:
          session.phase,

        score:
          round(

            clamp(
              score,
              0,
              95
            ),

            1

          ),

        risk:

          score >=
          75

            ?

            "ELEVATED"

            :

            score >=
            55

              ?

              "WATCH"

              :

              "NORMAL",

        event:

          session.active

            ?

            "CURRENT"

            :

            session.nextEvent,

        eventAt:

          session.active

            ?

            now.toISOString()

            :

            session.nextEventAt,

        reasons

      });

    }

  }


  const bestPool =
    pools[0];


  if (
    bestPool
  ) {

    windows.push({

      session:
        "Nearest liquidity magnet",

      phase:
        bestPool.name,

      score:
        bestPool.likelihoodScore,

      risk:
        bestPool.likelihood,

      event:

        bestPool.side ===
        "HIGH"

          ?

          "UPSIDE RAID WATCH"

          :

          "DOWNSIDE RAID WATCH",

      eventAt:
        null,

      reasons: [

        `Current ${round(price, 3)} → target ${bestPool.level}`,

        `Projected raid end ${bestPool.projectedSweep.likelyEnd}`

      ]

    });

  }


  return windows

    .sort(
      (
        a,
        b
      ) =>
        b.score -
        a.score
    )

    .slice(
      0,
      6
    );

}


/* =========================================================
   MARKET REGIME
========================================================= */

function buildRegime({

  m5,

  atr5,

  atr15,

  footprint,

  structure

}) {

  const recentAtr =
    atr(
      m5,
      14
    )

      .filter(
        Number.isFinite
      )

      .slice(
        -120
      );


  const medAtr =
    median(
      recentAtr
    )
    ||
    atr5;


  const volatilityRatio =

    atr5

    /

    Math.max(
      medAtr,
      1e-9
    );


  const biases = [

    structure.m5.bias,

    structure.m15.bias,

    structure.h1.bias

  ];


  const bullish =
    biases.filter(
      x =>
        x ===
        "BULLISH"
    ).length;


  const bearish =
    biases.filter(
      x =>
        x ===
        "BEARISH"
    ).length;


  const trend =

    bullish >=
    2

      ?

      "BULLISH"

      :

      bearish >=
      2

        ?

        "BEARISH"

        :

        "MIXED";


  const volatility =

    volatilityRatio >=
    1.35

      ?

      "EXPANDING"

      :

      volatilityRatio <=
      0.78

        ?

        "COMPRESSED"

        :

        "NORMAL";


  const orderFlow =

    footprint.last15.deltaPct >=
    18

      ?

      "BUY DOMINANT"

      :

      footprint.last15.deltaPct <=
      -18

        ?

        "SELL DOMINANT"

        :

        "BALANCED";


  return {

    trend,

    volatility,

    orderFlow,

    atrExpansion:
      round(
        volatilityRatio,
        2
      ),

    m15ToM5AtrRatio:
      round(

        atr15

        /

        Math.max(
          atr5,
          1e-9
        ),

        2

      ),

    label:

      `${trend} / ` +

      `${volatility} / ` +

      `${orderFlow}`

  };

}


/* =========================================================
   UTILITIES
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

    ?

    n

    :

    0;

}


function round(
  value,
  decimals = 2
) {

  if (
    !Number.isFinite(
      value
    )
  ) {

    return null;

  }


  const multiplier =
    10 **
    decimals;


  return Math.round(

    value *
    multiplier

  )

  /

  multiplier;

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


function sum(
  values
) {

  return values.reduce(

    (
      total,
      value
    ) =>

      total

      +

      (
        Number.isFinite(
          value
        )

          ?

          value

          :

          0
      ),

    0

  );

}


function avg(
  values
) {

  if (
    !values.length
  ) {

    return 0;

  }


  return sum(
    values
  )

  /

  values.length;

}


function median(
  values
) {

  return percentile(
    values,
    0.5
  );

}


function percentile(
  values,
  p
) {

  const arr =
    values

      .filter(
        Number.isFinite
      )

      .slice()

      .sort(
        (
          a,
          b
        ) =>
          a -
          b
      );


  if (
    !arr.length
  ) {

    return null;

  }


  if (
    arr.length ===
    1
  ) {

    return arr[0];

  }


  const index =

    (
      arr.length -
      1
    )

    *

    p;


  const low =
    Math.floor(
      index
    );


  const high =
    Math.ceil(
      index
    );


  const weight =
    index -
    low;


  return (

    arr[low] *
    (
      1 -
      weight
    )

    +

    arr[high] *
    weight

  );

}


function lastFinite(
  values
) {

  for (

    let i =
      values.length -
      1;

    i >=
      0;

    i--

  ) {

    if (
      Number.isFinite(
        values[i]
      )
    ) {

      return values[i];

    }

  }


  return null;

}


function startOfUtcDay(
  timestamp
) {

  const date =
    new Date(
      timestamp
    );


  return Date.UTC(

    date.getUTCFullYear(),

    date.getUTCMonth(),

    date.getUTCDate()

  );

}


function pad2(
  value
) {

  return String(
    value
  )
    .padStart(
      2,
      "0"
    );

}


function minutesLabel(
  minutes
) {

  return (

    `${pad2(Math.floor(minutes / 60))}:`

    +

    `${pad2(minutes % 60)}`

  );

}