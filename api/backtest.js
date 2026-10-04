/* =========================================================
   MKAYFX BTC/USD LIQUIDITY SNIPER BACKTESTER V1.1
   HIGHER-FREQUENCY / BALANCED MODE

   Vercel API route:
   /api/backtest.js

   STRATEGY
   --------
   4H  = Macro bias
   1H  = Direction + liquidity
   15M = Sweep / BOS / displacement
   5M  = Precision

   CHANGES FROM V1
   ----------------
   - Min score: 70 -> 60
   - Sweep lookback: 6 -> 12 bars
   - Smaller minimum sweep depth
   - Easier displacement threshold
   - Easier volume expansion threshold
   - Larger entry-extension allowance
   - A / B / C setup tiers
   - Less aggressive BUY/SELL conflict filter
   - Maximum historical hold = 18 hours
   - Timed-out trades no longer block the rest of the test
   - Still uses NEXT 5M OPEN for historical entry
   - Still assumes SL first when TP + SL occur in same candle
========================================================= */

const COINBASE_BASE =
  "https://api.exchange.coinbase.com";

const PRODUCT_ID =
  "BTC-USD";

const SYMBOL =
  "BTC/USD";

const GRANULARITY_5M =
  300;

const CHUNK_CANDLES =
  299;

const REQUEST_CONCURRENCY =
  4;

const ALLOWED_DAYS =
  new Set([
    3,
    7,
    14,
    30
  ]);


/* =========================================================
   HANDLER
========================================================= */

export default async function handler(
  req,
  res
) {

  setHeaders(
    res
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

    &&

    req.method !==
    "POST"

  ) {

    return res
      .status(405)
      .json({

        success:
          false,

        error:
          "Use GET or POST."

      });

  }


  try {

    const input = {

      ...(req.query || {}),

      ...(
        req.body &&
        typeof req.body ===
        "object"

          ? req.body

          : {}
      )

    };


    const requestedDays =
      Math.round(

        numberOr(
          input.days,
          7
        )

      );


    const days =

      ALLOWED_DAYS.has(
        requestedDays
      )

        ? requestedDays

        : 7;


    const cfg =
      buildConfig(
        input
      );


    const nowSec =
      Math.floor(

        Date.now() /
        1000

      );


    const backtestStartSec =

      nowSec -

      days *
      86400;


    /*
      Extra warmup gives EMA / ATR / structure
      enough historical candles before the
      actual test period starts.
    */

    const warmupDays =
      10;


    const fetchStartSec =

      backtestStartSec -

      warmupDays *
      86400;


    const fetchStarted =
      Date.now();


    /* =====================================================
       DOWNLOAD BTC 5M HISTORY
    ===================================================== */

    const candles5m =
      await fetchHistoricalCandles({

        startSec:
          fetchStartSec,

        endSec:
          nowSec,

        granularity:
          GRANULARITY_5M

      });


    if (
      candles5m.length <
      1000
    ) {

      throw new Error(

        `Not enough historical candles: ${candles5m.length}`

      );

    }


    /* =====================================================
       RESAMPLE TIMEFRAMES
    ===================================================== */

    const candles15m =
      resampleCandles(

        candles5m,

        15 *
        60,

        3

      );


    const candles1h =
      resampleCandles(

        candles5m,

        60 *
        60,

        12

      );


    const candles4h =
      resampleCandles(

        candles5m,

        4 *
        60 *
        60,

        48

      );


    if (

      candles15m.length <
      100

      ||

      candles1h.length <
      60

      ||

      candles4h.length <
      50

    ) {

      throw new Error(

        `Not enough resampled history. M15=${candles15m.length}, H1=${candles1h.length}, H4=${candles4h.length}`

      );

    }


    /* =====================================================
       RUN TEST
    ===================================================== */

    const result =
      runBacktest({

        candles5m,

        candles15m,

        candles1h,

        candles4h,

        startSec:
          backtestStartSec,

        endSec:
          nowSec,

        cfg

      });


    return res
      .status(200)
      .json({

        success:
          true,

        model:
          "MKAYFX BTC LIQUIDITY SNIPER BACKTEST V1.1",

        symbol:
          SYMBOL,

        days,

        generatedAt:
          new Date()
            .toISOString(),

        fetchMs:
          Date.now() -
          fetchStarted,


        candleCounts: {

          M5:
            candles5m
              .filter(

                candle =>
                  candle.time >=
                  backtestStartSec

              )
              .length,

          M15:
            candles15m
              .filter(

                candle =>
                  candle.time >=
                  backtestStartSec

              )
              .length,

          H1:
            candles1h
              .filter(

                candle =>
                  candle.time >=
                  backtestStartSec

              )
              .length,

          H4:
            candles4h
              .filter(

                candle =>
                  candle.time >=
                  backtestStartSec

              )
              .length

        },


        settings: {

          minSignalScore:
            cfg.minScore,

          sniperScore:
            cfg.sniperScore,

          targetR:
            cfg.targetR,

          tp1R:
            cfg.tp1R,

          stopAtrBuffer:
            cfg.stopAtrBuffer,

          maxEntryExtensionAtr:
            cfg.maxEntryExtensionAtr,

          sweepLookbackBars:
            cfg.sweepLookback,

          bosLookbackBars:
            cfg.bosLookback,

          displacementBodyAtr:
            cfg.displacementBodyAtr,

          displacementEfficiency:
            cfg.displacementEfficiency,

          volumeSpikeMultiplier:
            cfg.volumeSpikeMult,

          slippageBps:
            cfg.slippageBps,

          maximumHoldHours:
            cfg.maxHoldHours,

          triggerMode:
            "BALANCED_FREQUENCY",

          sameCandleRule:
            "STOP_FIRST",

          onePositionAtATime:
            true,

          entryRule:
            "NEXT_5M_OPEN"

        },


        period: {

          start:
            new Date(
              backtestStartSec *
              1000
            )
              .toISOString(),

          end:
            new Date(
              nowSec *
              1000
            )
              .toISOString()

        },


        ...result

      });

  }

  catch (
    error
  ) {

    console.error(

      "MKAYFX BTC backtest error:",

      error

    );


    return res
      .status(500)
      .json({

        success:
          false,

        symbol:
          SYMBOL,

        error:
          error?.message
          ||
          "Unknown backtest error",

        generatedAt:
          new Date()
            .toISOString()

      });

  }

}


/* =========================================================
   CONFIG
========================================================= */

function buildConfig(
  input
) {

  return {

    /*
      Lower than old 70.
      This is the main frequency increase.
    */

    minScore:
      clamp(

        numberOr(
          input.minScore,
          60
        ),

        50,

        95

      ),


    sniperScore:
      clamp(

        numberOr(
          input.sniperScore,
          78
        ),

        60,

        100

      ),


    targetR:
      clamp(

        numberOr(
          input.targetR,
          3
        ),

        1.5,

        6

      ),


    tp1R:
      clamp(

        numberOr(
          input.tp1R,
          1.5
        ),

        0.5,

        3

      ),


    stopAtrBuffer:
      clamp(

        numberOr(
          input.stopAtrBuffer,
          0.18
        ),

        0.05,

        0.75

      ),


    maxEntryExtensionAtr:
      clamp(

        numberOr(
          input.maxEntryExtensionAtr,
          1.8
        ),

        0.4,

        3

      ),


    /*
      12 × 15M =
      3-hour liquidity sweep memory.
    */

    sweepLookback:
      Math.round(

        clamp(

          numberOr(
            input.sweepLookback,
            12
          ),

          3,

          20

        )

      ),


    minSweepDepthAtr:
      clamp(

        numberOr(
          input.minSweepDepthAtr,
          0.01
        ),

        0,

        0.30

      ),


    bosLookback:
      Math.round(

        clamp(

          numberOr(
            input.bosLookback,
            6
          ),

          3,

          20

        )

      ),


    displacementBodyAtr:
      clamp(

        numberOr(
          input.displacementBodyAtr,
          0.35
        ),

        0.20,

        1.5

      ),


    displacementEfficiency:
      clamp(

        numberOr(
          input.displacementEfficiency,
          0.42
        ),

        0.25,

        0.90

      ),


    volumeSpikeMult:
      clamp(

        numberOr(
          input.volumeSpikeMult,
          1.08
        ),

        1,

        3

      ),


    fvgLookback5m:
      Math.round(

        clamp(

          numberOr(
            input.fvgLookback5m,
            30
          ),

          8,

          80

        )

      ),


    slippageBps:
      clamp(

        numberOr(
          input.slippageBps,
          1
        ),

        0,

        20

      ),


    /*
      VERY IMPORTANT:
      an unresolved trade will not lock the
      backtester forever.
    */

    maxHoldHours:
      clamp(

        numberOr(
          input.maxHoldHours,
          18
        ),

        3,

        72

      )

  };

}


/* =========================================================
   BACKTEST LOOP
========================================================= */

function runBacktest({

  candles5m,

  candles15m,

  candles1h,

  candles4h,

  startSec,

  endSec,

  cfg

}) {

  const trades =
    [];


  const signalCandidates =
    [];


  const usedSignalKeys =
    new Set();


  let nextTradableTime =
    startSec;


  const firstIndex =
    candles15m.findIndex(

      candle =>
        candle.time >=
        startSec

    );


  const startIndex =
    Math.max(

      30,

      firstIndex <
      0

        ? 30

        : firstIndex

    );


  for (

    let i =
      startIndex;

    i <
      candles15m.length;

    i++

  ) {

    const signalCandle =
      candles15m[i];


    const cutoffSec =

      signalCandle.time +

      15 *
      60;


    if (

      cutoffSec <
      startSec

      ||

      cutoffSec >
      endSec

    ) {

      continue;

    }


    /*
      One position at a time.
    */

    if (
      cutoffSec <
      nextTradableTime
    ) {

      continue;

    }


    /*
      Historical state.

      Every timeframe is cut off at the
      current historical moment.
    */

    const m15 =
      candles15m.slice(

        0,

        i +
        1

      );


    const h1 =
      candles1h.filter(

        candle =>

          candle.time +
          3600 <=
          cutoffSec

      );


    const h4 =
      candles4h.filter(

        candle =>

          candle.time +
          4 *
          3600 <=
          cutoffSec

      );


    const m5 =
      candles5m.filter(

        candle =>

          candle.time +
          300 <=
          cutoffSec

      );


    if (

      m15.length <
      30

      ||

      h1.length <
      55

      ||

      h4.length <
      50

      ||

      m5.length <
      120

    ) {

      continue;

    }


    const analysis =
      analyzeHistoricalState({

        candles5m:
          m5,

        candles15m:
          m15,

        candles1h:
          h1,

        candles4h:
          h4,

        historicalNowSec:
          cutoffSec,

        cfg

      });


    signalCandidates.push({

      time:
        cutoffSec,

      signal:
        analysis.signal,

      buyScore:
        analysis.buySetup.score,

      sellScore:
        analysis.sellSetup.score,

      chosenScore:
        analysis.best.score,

      trigger:
        analysis.best.trigger

    });


    if (
      analysis.signal ===
      "WAIT"
    ) {

      continue;

    }


    /*
      Avoid repeatedly entering from the
      exact same liquidity event.
    */

    const signalKey = [

      analysis.signal,

      analysis.best
        .sweep
        ?.candle
        ?.time
      ||
      0,

      analysis.best
        .bos
        ?.index
      ??
      -1,

      analysis.best.trigger

    ]
      .join(
        "|"
      );


    if (
      usedSignalKeys.has(
        signalKey
      )
    ) {

      continue;

    }


    usedSignalKeys.add(
      signalKey
    );


    /*
      We only enter after the signal candle
      has closed.

      This prevents look-ahead.
    */

    const entryIndex =
      findNext5mIndex(

        candles5m,

        cutoffSec

      );


    if (

      entryIndex <
      0

      ||

      entryIndex >=
      candles5m.length

    ) {

      break;

    }


    const entryCandle =
      candles5m[
        entryIndex
      ];


    if (
      entryCandle.time >=
      endSec
    ) {

      break;

    }


    const trade =
      buildHistoricalTrade({

        side:
          analysis.signal,

        entryCandle,

        setup:
          analysis.best,

        atr15:
          analysis.atr15,

        cfg,

        score:
          analysis.best.score,

        confidence:
          analysis.confidence,

        sniper:
          analysis.best.score >=
          cfg.sniperScore,

        timeframeBias:
          analysis.timeframeBias,

        signalTime:
          cutoffSec

      });


    if (
      !trade.valid
    ) {

      continue;

    }


    const resolution =
      resolveTrade({

        candles5m,

        entryIndex,

        trade,

        endSec,

        cfg

      });


    const completeTrade = {

      ...trade,

      ...resolution,

      valid:
        undefined

    };


    trades.push(
      completeTrade
    );


    /*
      FIX:
      even timed-out trades have an exitTimeSec,
      allowing the replay to continue.
    */

    nextTradableTime =

      resolution.exitTimeSec

        ? resolution.exitTimeSec +
          300

        : entryCandle.time +
          cfg.maxHoldHours *
          3600 +
          300;

  }


  return buildBacktestStats(

    trades,

    signalCandidates,

    cfg

  );

}


/* =========================================================
   HISTORICAL MARKET ANALYSIS
========================================================= */

function analyzeHistoricalState({

  candles5m,

  candles15m,

  candles1h,

  candles4h,

  historicalNowSec,

  cfg

}) {

  const currentPrice =

    candles5m[
      candles5m.length -
      1
    ]
      .close;


  const atr15 =
    atr(

      candles15m,

      14

    );


  const atr1h =
    atr(

      candles1h,

      14

    );


  const trend4h =
    analyzeTrend(

      candles4h,

      "4H"

    );


  const trend1h =
    analyzeTrend(

      candles1h,

      "1H"

    );


  const liquidity =
    buildLiquidityMap({

      candles1h,

      candles4h,

      atr1h

    });


  const buySetup =
    evaluateDirection({

      side:
        "BUY",

      currentPrice,

      candles5m,

      candles15m,

      trend4h,

      trend1h,

      liquidity,

      atr15,

      historicalNowSec,

      cfg

    });


  const sellSetup =
    evaluateDirection({

      side:
        "SELL",

      currentPrice,

      candles5m,

      candles15m,

      trend4h,

      trend1h,

      liquidity,

      atr15,

      historicalNowSec,

      cfg

    });


  const best =

    buySetup.score >=
    sellSetup.score

      ? buySetup

      : sellSetup;


  const scoreGap =

    Math.abs(

      buySetup.score -
      sellSetup.score

    );


  let signal =

    best.coreTrigger

    &&

    best.score >=
    cfg.minScore

    &&

    !best.extended

      ? best.side

      : "WAIT";


  /*
    Old version rejected too many setups.

    Only reject when BOTH sides are genuinely
    strong and nearly identical.
  */

  const conflicting =

    buySetup.score >=
    68

    &&

    sellSetup.score >=
    68

    &&

    scoreGap <
    6;


  if (
    conflicting
  ) {

    signal =
      "WAIT";

  }


  const confidence =
    scoreToConfidence(

      best.score,

      scoreGap,

      signal

    );


  return {

    signal,

    best,

    buySetup,

    sellSetup,

    atr15,

    confidence,


    timeframeBias: {

      H4:
        trend4h.bias,

      H1:
        trend1h.bias,

      M15:
        best.structureBias,

      M5:
        best.precision.bias

    }

  };

}


/* =========================================================
   SCORE BUY / SELL
========================================================= */

function evaluateDirection({

  side,

  currentPrice,

  candles5m,

  candles15m,

  trend4h,

  trend1h,

  liquidity,

  atr15,

  historicalNowSec,

  cfg

}) {

  const bullish =
    side ===
    "BUY";


  const levels =

    bullish

      ? liquidity.lows

      : liquidity.highs;


  const components = {

    h4Trend:
      0,

    h1Trend:
      0,

    liquiditySweep:
      0,

    bos15m:
      0,

    displacement:
      0,

    volumeExpansion:
      0,

    precision5m:
      0,

    session:
      0

  };


  /* =====================================================
     4H TREND
  ===================================================== */

  if (
    trend4h.bias ===
    side
  ) {

    components.h4Trend =
      15;

  }

  else if (
    trend4h.bias ===
    "NEUTRAL"
  ) {

    components.h4Trend =
      7;

  }


  /* =====================================================
     1H TREND
  ===================================================== */

  if (
    trend1h.bias ===
    side
  ) {

    components.h1Trend =
      15;

  }

  else if (
    trend1h.bias ===
    "NEUTRAL"
  ) {

    components.h1Trend =
      7;

  }


  /* =====================================================
     LIQUIDITY SWEEP
  ===================================================== */

  const sweep =
    findRecentSweep({

      candles:
        candles15m,

      levels,

      bullish,

      atrValue:
        atr15,

      cfg

    });


  if (
    sweep
  ) {

    components
      .liquiditySweep =
      20;

  }


  const setupIndex =

    sweep

      ? sweep.index

      : Math.max(

          2,

          candles15m.length -
          4

        );


  /* =====================================================
     BOS
  ===================================================== */

  const bos =
    detectBos({

      candles:
        candles15m,

      setupIndex,

      bullish,

      lookback:
        cfg.bosLookback

    });


  if (
    bos.confirmed
  ) {

    components.bos15m =
      15;

  }

  else if (
    bos.soft
  ) {

    components.bos15m =
      6;

  }


  /* =====================================================
     DISPLACEMENT
  ===================================================== */

  const displacement =
    detectDisplacement({

      candles:
        candles15m,

      fromIndex:
        setupIndex,

      bullish,

      atrValue:
        atr15,

      cfg

    });


  if (
    displacement.confirmed
  ) {

    components.displacement =
      10;

  }

  else if (
    displacement.partial
  ) {

    components.displacement =
      4;

  }


  /* =====================================================
     VOLUME
  ===================================================== */

  const volume =
    detectVolumeExpansion({

      candles:
        candles15m,

      fromIndex:
        setupIndex,

      cfg

    });


  if (
    volume.confirmed
  ) {

    components
      .volumeExpansion =
      10;

  }

  else if (
    volume.ratio >=
    1.02
  ) {

    components
      .volumeExpansion =
      4;

  }


  /* =====================================================
     5M
  ===================================================== */

  const precision =
    analyze5mPrecision({

      candles5m,

      bullish,

      bosLevel:
        bos.level,

      currentPrice,

      atr15,

      cfg

    });


  if (
    precision.confirmed
  ) {

    components
      .precision5m =
      10;

  }

  else if (
    precision.bias ===
    side
  ) {

    components
      .precision5m =
      5;

  }


  /* =====================================================
     SESSION
  ===================================================== */

  const session =
    getSession(

      new Date(

        historicalNowSec *
        1000

      )

    );


  if (

    session.name ===
    "LONDON"

    ||

    session.name ===
    "LONDON_NY_OVERLAP"

    ||

    session.name ===
    "NEW_YORK"

  ) {

    components.session =
      5;

  }

  else {

    components.session =
      2;

  }


  /* =====================================================
     SCORE
  ===================================================== */

  let score =

    Object
      .values(
        components
      )
      .reduce(

        (
          sum,
          value
        ) =>

          sum +
          value,

        0

      );


  /*
    HTF opposition still matters,
    but old -12 penalty was aggressive.
  */

  if (

    trend4h.bias ===
    oppositeSide(
      side
    )

    &&

    trend1h.bias ===
    oppositeSide(
      side
    )

  ) {

    score -=
      8;

  }


  score =
    clamp(

      score,

      0,

      100

    );


  /* =====================================================
     ENTRY EXTENSION
  ===================================================== */

  const reference =

    sweep
      ?.level
      ?.price

    ??

    bos.level

    ??

    currentPrice;


  const extensionAtr =

    atr15 >
    0

      ? Math.abs(

          currentPrice -
          reference

        )

        /

        atr15

      : 0;


  const extended =

    extensionAtr >
    cfg.maxEntryExtensionAtr;


  /* =====================================================
     SETUP TIERS
  ===================================================== */

  /*
    A-TIER

    Full original setup.
  */

  const tierA =
    Boolean(

      sweep

      &&

      bos.confirmed

      &&

      displacement.confirmed

    );


  /*
    B-TIER

    Liquidity sweep + confirmed BOS.
    Allows partial displacement when 5M
    is pointing the same direction.
  */

  const tierB =
    Boolean(

      sweep

      &&

      bos.confirmed

      &&

      (
        displacement.confirmed

        ||

        displacement.partial
      )

      &&

      precision.bias ===
      side

    );


  /*
    C-TIER

    Liquidity sweep + strong displacement.
    Allows a soft BOS if 5M direction agrees.
  */

  const tierC =
    Boolean(

      sweep

      &&

      (
        bos.confirmed

        ||

        bos.soft
      )

      &&

      displacement.confirmed

      &&

      precision.bias ===
      side

    );


  const coreTrigger =

    tierA

    ||

    tierB

    ||

    tierC;


  let trigger =
    "NONE";


  if (

    tierA

    &&

    precision.confirmed

  ) {

    trigger =
      "A_SWEEP_BOS_DISPLACEMENT_5M";

  }

  else if (
    tierA
  ) {

    trigger =
      "A_SWEEP_BOS_DISPLACEMENT";

  }

  else if (
    tierB
  ) {

    trigger =
      "B_SWEEP_BOS_PARTIAL_DISPLACEMENT";

  }

  else if (
    tierC
  ) {

    trigger =
      "C_SWEEP_SOFT_BOS_DISPLACEMENT";

  }


  return {

    side,

    score,

    coreTrigger,

    tierA,

    tierB,

    tierC,

    trigger,

    components,

    sweep,

    bos,

    displacement,

    precision,

    volumeRatio:
      volume.ratio,

    extensionAtr,

    extended,

    structureBias:

      bos.confirmed

        ? side

        : bos.soft

          ? side

          : "NEUTRAL"

  };

}


/* =========================================================
   BUILD HISTORICAL TRADE
========================================================= */

function buildHistoricalTrade({

  side,

  entryCandle,

  setup,

  atr15,

  cfg,

  score,

  confidence,

  sniper,

  timeframeBias,

  signalTime

}) {

  if (
    !setup.sweep
  ) {

    return {

      valid:
        false,

      reason:
        "No liquidity sweep."

    };

  }


  const rawEntry =
    entryCandle.open;


  const slippage =

    rawEntry *

    (
      cfg.slippageBps /
      10000
    );


  const entry =

    side ===
    "BUY"

      ? rawEntry +
        slippage

      : rawEntry -
        slippage;


  const buffer =

    atr15 *

    cfg.stopAtrBuffer;


  const stopLoss =

    side ===
    "BUY"

      ? setup
          .sweep
          .extreme -
        buffer

      : setup
          .sweep
          .extreme +
        buffer;


  const risk =

    Math.abs(

      entry -
      stopLoss

    );


  if (

    !Number.isFinite(
      risk
    )

    ||

    risk <=
    0

    ||

    atr15 <=
    0

  ) {

    return {

      valid:
        false,

      reason:
        "Invalid stop distance."

    };

  }


  /*
    Still reject insane stops,
    but give BTC slightly more room.
  */

  if (
    risk >
    atr15 *
    3.5
  ) {

    return {

      valid:
        false,

      reason:
        "Stop too wide."

    };

  }


  const direction =

    side ===
    "BUY"

      ? 1

      : -1;


  const takeProfit1 =

    entry +

    direction *

    risk *

    cfg.tp1R;


  const takeProfit =

    entry +

    direction *

    risk *

    cfg.targetR;


  return {

    valid:
      true,

    signal:
      side,

    signalTime:
      new Date(

        signalTime *
        1000

      )
        .toISOString(),

    entryTime:
      new Date(

        entryCandle.time *
        1000

      )
        .toISOString(),

    entryTimeSec:
      entryCandle.time,

    entry:
      roundPrice(
        entry
      ),

    rawEntry:
      roundPrice(
        rawEntry
      ),

    stopLoss:
      roundPrice(
        stopLoss
      ),

    takeProfit1:
      roundPrice(
        takeProfit1
      ),

    takeProfit:
      roundPrice(
        takeProfit
      ),

    risk:
      roundPrice(
        risk
      ),

    targetR:
      cfg.targetR,

    score:
      Math.round(
        score
      ),

    confidence,

    sniper,

    trigger:
      setup.trigger,

    setupTier:

      setup.tierA

        ? "A"

        : setup.tierB

          ? "B"

          : setup.tierC

            ? "C"

            : "UNKNOWN",

    session:
      getSession(

        new Date(

          signalTime *
          1000

        )

      )
        .name,

    timeframeBias,

    sweptLevel:
      setup
        .sweep
        .level
        .name,

    sweptPrice:
      roundPrice(

        setup
          .sweep
          .level
          .price

      ),

    sweepExtreme:
      roundPrice(

        setup
          .sweep
          .extreme

      ),

    volumeRatio:
      round(

        setup.volumeRatio,

        2

      ),

    extensionAtr:
      round(

        setup.extensionAtr,

        2

      ),

    precisionConfirmed:
      Boolean(

        setup
          .precision
          .confirmed

      )

  };

}


/* =========================================================
   RESOLVE TRADE
========================================================= */

function resolveTrade({

  candles5m,

  entryIndex,

  trade,

  endSec,

  cfg

}) {

  /*
    IMPORTANT FIX.

    Previously an unresolved trade could stay
    active for most/all of the historical test.

    Now it can only block entries for
    maxHoldHours.
  */

  const finalAllowedSec =

    Math.min(

      endSec,

      trade.entryTimeSec +

      cfg.maxHoldHours *
      3600

    );


  let bestR =
    0;


  let worstR =
    0;


  let tp1Hit =
    false;


  let lastCandle =
    null;


  for (

    let i =
      entryIndex;

    i <
      candles5m.length;

    i++

  ) {

    const candle =
      candles5m[i];


    if (
      candle.time >
      finalAllowedSec
    ) {

      break;

    }


    lastCandle =
      candle;


    const highR =

      trade.signal ===
      "BUY"

        ? (
            candle.high -
            trade.entry
          )

          /

          trade.risk

        : (
            trade.entry -
            candle.low
          )

          /

          trade.risk;


    const lowR =

      trade.signal ===
      "BUY"

        ? (
            candle.low -
            trade.entry
          )

          /

          trade.risk

        : (
            trade.entry -
            candle.high
          )

          /

          trade.risk;


    bestR =
      Math.max(

        bestR,

        highR,

        lowR

      );


    worstR =
      Math.min(

        worstR,

        highR,

        lowR

      );


    if (
      !tp1Hit
    ) {

      tp1Hit =

        trade.signal ===
        "BUY"

          ? candle.high >=
            trade.takeProfit1

          : candle.low <=
            trade.takeProfit1;

    }


    const hitSL =

      trade.signal ===
      "BUY"

        ? candle.low <=
          trade.stopLoss

        : candle.high >=
          trade.stopLoss;


    const hitTP =

      trade.signal ===
      "BUY"

        ? candle.high >=
          trade.takeProfit

        : candle.low <=
          trade.takeProfit;


    /*
      Conservative OHLC assumption.
    */

    if (
      hitSL &&
      hitTP
    ) {

      return completedResolution({

        result:
          "LOSS",

        resultR:
          -1,

        exitPrice:
          trade.stopLoss,

        exitTimeSec:
          candle.time +
          300,

        entryTimeSec:
          trade.entryTimeSec,

        bestR,

        worstR,

        tp1Hit,

        ambiguous:
          true,

        exitReason:
          "SL_AND_TP_SAME_CANDLE_STOP_FIRST"

      });

    }


    if (
      hitSL
    ) {

      return completedResolution({

        result:
          "LOSS",

        resultR:
          -1,

        exitPrice:
          trade.stopLoss,

        exitTimeSec:
          candle.time +
          300,

        entryTimeSec:
          trade.entryTimeSec,

        bestR,

        worstR,

        tp1Hit,

        ambiguous:
          false,

        exitReason:
          "STOP_LOSS"

      });

    }


    if (
      hitTP
    ) {

      return completedResolution({

        result:
          "WIN",

        resultR:
          cfg.targetR,

        exitPrice:
          trade.takeProfit,

        exitTimeSec:
          candle.time +
          300,

        entryTimeSec:
          trade.entryTimeSec,

        bestR,

        worstR,

        tp1Hit,

        ambiguous:
          false,

        exitReason:
          "TAKE_PROFIT"

      });

    }

  }


  /*
    TIMEOUT.

    The trade is left as OPEN for performance
    statistics because it did not reach SL/TP.

    BUT it now has a real exit time so it
    cannot block later trades.
  */

  const markPrice =

    lastCandle
      ?.close

    ??

    trade.entry;


  const openR =

    trade.signal ===
    "BUY"

      ? (
          markPrice -
          trade.entry
        )

        /

        trade.risk

      : (
          trade.entry -
          markPrice
        )

        /

        trade.risk;


  const timeoutExitSec =

    Math.min(

      endSec,

      (
        lastCandle
          ?.time

        ??

        finalAllowedSec
      )

      +

      300

    );


  return {

    result:
      "OPEN",

    resultR:
      null,

    markR:
      round(

        openR,

        2

      ),

    exitReason:
      "TIMEOUT",

    exitPrice:
      roundPrice(
        markPrice
      ),

    exitTime:
      new Date(

        timeoutExitSec *
        1000

      )
        .toISOString(),

    exitTimeSec:
      timeoutExitSec,

    holdMinutes:
      round(

        (
          timeoutExitSec -
          trade.entryTimeSec
        )

        /

        60,

        1

      ),

    bestR:
      round(

        bestR,

        2

      ),

    worstR:
      round(

        worstR,

        2

      ),

    tp1Hit,

    ambiguous:
      false

  };

}


/* =========================================================
   COMPLETED RESOLUTION
========================================================= */

function completedResolution({

  result,

  resultR,

  exitPrice,

  exitTimeSec,

  entryTimeSec,

  bestR,

  worstR,

  tp1Hit,

  ambiguous,

  exitReason

}) {

  return {

    result,

    resultR,

    markR:
      null,

    exitReason,

    exitPrice:
      roundPrice(
        exitPrice
      ),

    exitTime:
      new Date(

        exitTimeSec *
        1000

      )
        .toISOString(),

    exitTimeSec,

    holdMinutes:
      round(

        (
          exitTimeSec -
          entryTimeSec
        )

        /

        60,

        1

      ),

    bestR:
      round(

        bestR,

        2

      ),

    worstR:
      round(

        worstR,

        2

      ),

    tp1Hit,

    ambiguous

  };

}


/* =========================================================
   STATISTICS
========================================================= */

function buildBacktestStats(

  trades,

  signalCandidates,

  cfg

) {

  const closed =

    trades.filter(

      trade =>

        trade.result ===
        "WIN"

        ||

        trade.result ===
        "LOSS"

    );


  const open =

    trades.filter(

      trade =>
        trade.result ===
        "OPEN"

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


  const grossWinsR =

    wins.reduce(

      (
        sum,
        trade
      ) =>

        sum +

        Number(
          trade.resultR
          ||
          0
        ),

      0

    );


  const grossLossesR =

    Math.abs(

      losses.reduce(

        (
          sum,
          trade
        ) =>

          sum +

          Number(
            trade.resultR
            ||
            0
          ),

        0

      )

    );


  const netR =

    closed.reduce(

      (
        sum,
        trade
      ) =>

        sum +

        Number(
          trade.resultR
          ||
          0
        ),

      0

    );


  const winRate =

    closed.length

      ? (
          wins.length /
          closed.length
        )

        *
        100

      : 0;


  const profitFactor =

    grossLossesR >
    0

      ? grossWinsR /
        grossLossesR

      : grossWinsR >
        0

        ? 999

        : 0;


  const expectancyR =

    closed.length

      ? netR /
        closed.length

      : 0;


  /* =====================================================
     EQUITY + DD
  ===================================================== */

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


  const equityCurve = [{

    time:
      closed[0]
        ?.entryTime
      ||
      null,

    equityR:
      0

  }];


  const drawdownCurve = [{

    time:
      closed[0]
        ?.entryTime
      ||
      null,

    drawdownR:
      0

  }];


  for (
    const trade
    of closed
  ) {

    equity +=
      Number(
        trade.resultR
        ||
        0
      );


    peak =
      Math.max(

        peak,

        equity

      );


    const drawdown =

      equity -
      peak;


    maxDrawdownR =
      Math.min(

        maxDrawdownR,

        drawdown

      );


    if (
      trade.result ===
      "LOSS"
    ) {

      lossStreak +=
        1;


      maxLossStreak =
        Math.max(

          maxLossStreak,

          lossStreak

        );

    }

    else {

      lossStreak =
        0;

    }


    equityCurve.push({

      time:
        trade.exitTime,

      equityR:
        round(

          equity,

          2

        )

    });


    drawdownCurve.push({

      time:
        trade.exitTime,

      drawdownR:
        round(

          drawdown,

          2

        )

    });

  }


  const averageHoldMinutes =

    trades.length

      ? trades.reduce(

          (
            sum,
            trade
          ) =>

            sum +

            Number(
              trade.holdMinutes
              ||
              0
            ),

          0

        )

        /

        trades.length

      : 0;


  const averageScore =

    trades.length

      ? trades.reduce(

          (
            sum,
            trade
          ) =>

            sum +

            Number(
              trade.score
              ||
              0
            ),

          0

        )

        /

        trades.length

      : 0;


  const bestScore =

    trades.length

      ? Math.max(

          ...trades.map(

            trade =>
              Number(
                trade.score
                ||
                0
              )

          )

        )

      : 0;


  const breakEvenWinRate =

    100 /

    (
      cfg.targetR +
      1
    );


  const winRateEdge =

    winRate -
    breakEvenWinRate;


  const buyStats =
    sideStats(

      closed,

      "BUY"

    );


  const sellStats =
    sideStats(

      closed,

      "SELL"

    );


  const sessionNames = [

    "ASIA",

    "LONDON",

    "LONDON_NY_OVERLAP",

    "NEW_YORK",

    "OFF_HOURS"

  ];


  const sessionStats =

    Object.fromEntries(

      sessionNames.map(

        name => [

          name,

          groupStats(

            closed.filter(

              trade =>
                trade.session ===
                name

            )

          )

        ]

      )

    );


  const scoreBuckets = {

    "60-69":
      groupStats(

        closed.filter(

          trade =>

            trade.score >=
            60

            &&

            trade.score <
            70

        )

      ),


    "70-79":
      groupStats(

        closed.filter(

          trade =>

            trade.score >=
            70

            &&

            trade.score <
            80

        )

      ),


    "80-89":
      groupStats(

        closed.filter(

          trade =>

            trade.score >=
            80

            &&

            trade.score <
            90

        )

      ),


    "90-100":
      groupStats(

        closed.filter(

          trade =>
            trade.score >=
            90

        )

      )

  };


  const tp1HitRate =

    trades.length

      ? (
          trades.filter(

            trade =>
              trade.tp1Hit

          )
            .length

          /

          trades.length
        )

        *
        100

      : 0;


  const setupTiers = {

    A:
      groupStats(

        closed.filter(

          trade =>
            trade.setupTier ===
            "A"

        )

      ),

    B:
      groupStats(

        closed.filter(

          trade =>
            trade.setupTier ===
            "B"

        )

      ),

    C:
      groupStats(

        closed.filter(

          trade =>
            trade.setupTier ===
            "C"

        )

      )

  };


  return {

    trades:
      trades.length,

    closedTrades:
      closed.length,

    openTrades:
      open.length,

    timedOutTrades:
      open.filter(

        trade =>
          trade.exitReason ===
          "TIMEOUT"

      )
        .length,

    wins:
      wins.length,

    losses:
      losses.length,

    winRate:
      round(

        winRate,

        2

      ),

    breakEvenWinRate:
      round(

        breakEvenWinRate,

        2

      ),

    winRateEdge:
      round(

        winRateEdge,

        2

      ),

    netR:
      round(

        netR,

        2

      ),

    grossWinsR:
      round(

        grossWinsR,

        2

      ),

    grossLossesR:
      round(

        grossLossesR,

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

    averageScore:
      round(

        averageScore,

        1

      ),

    bestScore:
      round(

        bestScore,

        0

      ),

    sniperTrades:
      trades.filter(

        trade =>
          trade.sniper

      )
        .length,

    tp1HitRate:
      round(

        tp1HitRate,

        2

      ),

    ambiguousCandles:
      closed.filter(

        trade =>
          trade.ambiguous

      )
        .length,

    signalCandidates:
      signalCandidates.length,

    buy:
      buyStats,

    sell:
      sellStats,

    sessions:
      sessionStats,

    scoreBuckets,

    setupTiers,

    equityCurve,

    drawdownCurve,

    recentTrades:

      trades
        .slice(
          -100
        )
        .reverse()
        .map(
          cleanTradeForResponse
        )

  };

}


/* =========================================================
   CLEAN TRADE RESPONSE
========================================================= */

function cleanTradeForResponse(
  trade
) {

  const {

    exitTimeSec,

    entryTimeSec,

    ...rest

  } =
    trade;


  return rest;

}


/* =========================================================
   GROUP STATS
========================================================= */

function sideStats(
  trades,
  side
) {

  return groupStats(

    trades.filter(

      trade =>
        trade.signal ===
        side

    )

  );

}


function groupStats(
  sample
) {

  const wins =

    sample.filter(

      trade =>
        trade.result ===
        "WIN"

    );


  const losses =

    sample.filter(

      trade =>
        trade.result ===
        "LOSS"

    );


  const netR =

    sample.reduce(

      (
        sum,
        trade
      ) =>

        sum +

        Number(
          trade.resultR
          ||
          0
        ),

      0

    );


  return {

    trades:
      sample.length,

    wins:
      wins.length,

    losses:
      losses.length,

    winRate:

      sample.length

        ? round(

            (
              wins.length /
              sample.length
            )

            *
            100,

            2

          )

        : 0,

    netR:
      round(

        netR,

        2

      ),

    expectancyR:

      sample.length

        ? round(

            netR /
            sample.length,

            3

          )

        : 0

  };

}


/* =========================================================
   LIQUIDITY MAP
========================================================= */

function buildLiquidityMap({

  candles1h,

  candles4h,

  atr1h

}) {

  const highs =
    [];


  const lows =
    [];


  const previousDay =
    getPreviousUtcDayRange(

      candles1h

    );


  if (
    previousDay
  ) {

    pushLevel(

      highs,

      "Previous Day High",

      previousDay.high,

      "PDH",

      5

    );


    pushLevel(

      lows,

      "Previous Day Low",

      previousDay.low,

      "PDL",

      5

    );

  }


  const previous4h =

    candles4h.length >=
    2

      ? candles4h[
          candles4h.length -
          2
        ]

      : null;


  if (
    previous4h
  ) {

    pushLevel(

      highs,

      "Previous 4H High",

      previous4h.high,

      "H4_HIGH",

      4

    );


    pushLevel(

      lows,

      "Previous 4H Low",

      previous4h.low,

      "H4_LOW",

      4

    );

  }


  const asian =
    getLatestAsianRange(

      candles1h

    );


  if (
    asian
  ) {

    pushLevel(

      highs,

      "Asian High",

      asian.high,

      "ASIA_HIGH",

      4

    );


    pushLevel(

      lows,

      "Asian Low",

      asian.low,

      "ASIA_LOW",

      4

    );

  }


  const highPivots =

    findPivots(

      candles1h,

      "high",

      2,

      2

    )
      .slice(
        -10
      );


  const lowPivots =

    findPivots(

      candles1h,

      "low",

      2,

      2

    )
      .slice(
        -10
      );


  for (
    const pivot
    of highPivots
  ) {

    pushLevel(

      highs,

      "1H Swing High",

      pivot.price,

      "H1_SWING_HIGH",

      3,

      pivot.time

    );

  }


  for (
    const pivot
    of lowPivots
  ) {

    pushLevel(

      lows,

      "1H Swing Low",

      pivot.price,

      "H1_SWING_LOW",

      3,

      pivot.time

    );

  }


  const swingHighs =

    highPivots.map(

      pivot =>
        pivot.price

    );


  const swingLows =

    lowPivots.map(

      pivot =>
        pivot.price

    );


  const tolerance =

    Math.max(

      atr1h *
      0.15,

      10

    );


  const equalHighs =
    findEqualLevels(

      swingHighs,

      tolerance

    );


  const equalLows =
    findEqualLevels(

      swingLows,

      tolerance

    );


  for (
    const level
    of equalHighs
  ) {

    pushLevel(

      highs,

      "Equal Highs",

      level,

      "EQH",

      4

    );

  }


  for (
    const level
    of equalLows
  ) {

    pushLevel(

      lows,

      "Equal Lows",

      level,

      "EQL",

      4

    );

  }


  const weeklyOpen =
    getCurrentWeekOpen(

      candles1h

    );


  const lastClose =

    candles1h[
      candles1h.length -
      1
    ]
      ?.close;


  if (

    Number.isFinite(
      weeklyOpen
    )

    &&

    Number.isFinite(
      lastClose
    )

  ) {

    if (
      weeklyOpen >=
      lastClose
    ) {

      pushLevel(

        highs,

        "Weekly Open",

        weeklyOpen,

        "WEEKLY_OPEN",

        2

      );

    }

    else {

      pushLevel(

        lows,

        "Weekly Open",

        weeklyOpen,

        "WEEKLY_OPEN",

        2

      );

    }

  }


  return {

    highs:
      dedupeLevels(
        highs
      ),

    lows:
      dedupeLevels(
        lows
      )

  };

}


/* =========================================================
   SWEEP
========================================================= */

function findRecentSweep({

  candles,

  levels,

  bullish,

  atrValue,

  cfg

}) {

  const start =

    Math.max(

      2,

      candles.length -
      cfg.sweepLookback

    );


  const minimumDepth =

    atrValue *

    cfg.minSweepDepthAtr;


  let best =
    null;


  for (

    let i =
      start;

    i <
      candles.length;

    i++

  ) {

    const candle =
      candles[i];


    for (
      const level
      of levels
    ) {

      if (
        !Number.isFinite(
          level.price
        )
      ) {

        continue;

      }


      const swept =

        bullish

          ? (
              candle.low <=
              level.price -
              minimumDepth

              &&

              candle.close >
              level.price
            )

          : (
              candle.high >=
              level.price +
              minimumDepth

              &&

              candle.close <
              level.price
            );


      if (
        !swept
      ) {

        continue;

      }


      const extreme =

        bullish

          ? candle.low

          : candle.high;


      const depth =

        bullish

          ? level.price -
            candle.low

          : candle.high -
            level.price;


      const recency =

        i -
        start +
        1;


      const quality =

        level.weight *
        10

        +

        (
          depth /

          Math.max(

            atrValue,

            0.0000001

          )
        )

        *
        10

        +

        recency;


      if (

        !best

        ||

        quality >
        best.quality

      ) {

        best = {

          index:
            i,

          candle,

          level,

          extreme,

          depth,

          quality

        };

      }

    }

  }


  return best;

}


/* =========================================================
   BOS
========================================================= */

function detectBos({

  candles,

  setupIndex,

  bullish,

  lookback

}) {

  const start =

    Math.max(

      0,

      setupIndex -
      lookback

    );


  const before =

    candles.slice(

      start,

      setupIndex

    );


  if (
    before.length <
    3
  ) {

    return {

      confirmed:
        false,

      soft:
        false,

      level:
        null,

      index:
        null

    };

  }


  const level =

    bullish

      ? Math.max(

          ...before.map(

            candle =>
              candle.high

          )

        )

      : Math.min(

          ...before.map(

            candle =>
              candle.low

          )

        );


  let confirmedIndex =
    null;


  for (

    let i =
      setupIndex;

    i <
      candles.length;

    i++

  ) {

    const candle =
      candles[i];


    const confirmed =

      bullish

        ? candle.close >
          level

        : candle.close <
          level;


    if (
      confirmed
    ) {

      confirmedIndex =
        i;

      break;

    }

  }


  const latest =

    candles[
      candles.length -
      1
    ];


  const localAtr =
    atr(

      candles,

      14

    );


  const distance =

    bullish

      ? level -
        latest.close

      : latest.close -
        level;


  /*
    Wider soft-BOS allowance.
  */

  const soft =

    confirmedIndex ===
    null

    &&

    distance <=
    localAtr *
    0.25;


  return {

    confirmed:

      confirmedIndex !==
      null,

    soft,

    level,

    index:
      confirmedIndex

  };

}


/* =========================================================
   DISPLACEMENT
========================================================= */

function detectDisplacement({

  candles,

  fromIndex,

  bullish,

  atrValue,

  cfg

}) {

  const end =

    Math.min(

      candles.length,

      fromIndex +
      6

    );


  let best =
    null;


  for (

    let i =
      fromIndex;

    i <
      end;

    i++

  ) {

    const candle =
      candles[i];


    if (
      !candle
    ) {

      continue;

    }


    const body =

      Math.abs(

        candle.close -
        candle.open

      );


    const range =

      Math.max(

        candle.high -
        candle.low,

        0.0000001

      );


    const efficiency =

      body /
      range;


    const bodyAtr =

      atrValue >
      0

        ? body /
          atrValue

        : 0;


    const directionOk =

      bullish

        ? candle.close >
          candle.open

        : candle.close <
          candle.open;


    const quality =

      directionOk

        ? bodyAtr *
          efficiency

        : 0;


    if (

      !best

      ||

      quality >
      best.quality

    ) {

      best = {

        index:
          i,

        bodyAtr,

        efficiency,

        directionOk,

        quality

      };

    }

  }


  if (
    !best
  ) {

    return {

      confirmed:
        false,

      partial:
        false,

      bodyAtr:
        0,

      efficiency:
        0

    };

  }


  const confirmed =

    best.directionOk

    &&

    best.bodyAtr >=
    cfg.displacementBodyAtr

    &&

    best.efficiency >=
    cfg.displacementEfficiency;


  const partial =

    !confirmed

    &&

    best.directionOk

    &&

    best.bodyAtr >=
    cfg.displacementBodyAtr *
    0.65

    &&

    best.efficiency >=
    cfg.displacementEfficiency *
    0.75;


  return {

    confirmed,

    partial,

    index:
      best.index,

    bodyAtr:
      round(

        best.bodyAtr,

        2

      ),

    efficiency:
      round(

        best.efficiency,

        2

      )

  };

}


/* =========================================================
   VOLUME
========================================================= */

function detectVolumeExpansion({

  candles,

  fromIndex,

  cfg

}) {

  const baselineEnd =

    Math.max(

      1,

      fromIndex

    );


  const baselineStart =

    Math.max(

      0,

      baselineEnd -
      20

    );


  const baseline =

    candles.slice(

      baselineStart,

      baselineEnd

    );


  const baselineVolume =

    average(

      baseline.map(

        candle =>
          candle.volume

      )

    );


  const test =

    candles.slice(

      fromIndex,

      Math.min(

        candles.length,

        fromIndex +
        6

      )

    );


  const maximumVolume =

    test.length

      ? Math.max(

          ...test.map(

            candle =>
              candle.volume

          )

        )

      : 0;


  const ratio =

    baselineVolume >
    0

      ? maximumVolume /
        baselineVolume

      : 0;


  return {

    confirmed:

      ratio >=
      cfg.volumeSpikeMult,

    ratio

  };

}


/* =========================================================
   5M PRECISION
========================================================= */

function analyze5mPrecision({

  candles5m,

  bullish,

  bosLevel,

  currentPrice,

  atr15,

  cfg

}) {

  const candles =

    candles5m.slice(

      -cfg.fvgLookback5m

    );


  if (
    candles.length <
    5
  ) {

    return {

      confirmed:
        false,

      bias:
        "NEUTRAL",

      retest:
        false,

      rejection:
        false,

      fvg:
        null

    };

  }


  const latest =

    candles[
      candles.length -
      1
    ];


  const previous =

    candles[
      candles.length -
      2
    ];


  const micro =
    analyzeMicroStructure(

      candles

    );


  const fvg =
    findRecentFvg(

      candles,

      bullish

    );


  const body =

    Math.abs(

      latest.close -
      latest.open

    );


  const rejection =

    bullish

      ? (
          latest.close >
          latest.open

          &&

          latest.open -
          latest.low >
          body *
          0.25
        )

      : (
          latest.close <
          latest.open

          &&

          latest.high -
          latest.open >
          body *
          0.25
        );


  let retest =
    false;


  if (
    Number.isFinite(
      bosLevel
    )
  ) {

    const tolerance =

      atr15 *
      0.25;


    const touched =

      latest.low <=
      bosLevel +
      tolerance

      &&

      latest.high >=
      bosLevel -
      tolerance;


    const held =

      bullish

        ? latest.close >=
          bosLevel -
          tolerance *
          0.25

        : latest.close <=
          bosLevel +
          tolerance *
          0.25;


    if (
      touched &&
      held
    ) {

      retest =
        true;

    }

  }


  if (
    !retest &&
    fvg
  ) {

    const tolerance =

      atr15 *
      0.16;


    const zoneTouched =

      currentPrice >=
      fvg.low -
      tolerance

      &&

      currentPrice <=
      fvg.high +
      tolerance;


    if (
      zoneTouched
    ) {

      retest =
        true;

    }

  }


  const momentum =

    bullish

      ? latest.close >=
        previous.close

      : latest.close <=
        previous.close;


  const side =

    bullish

      ? "BUY"

      : "SELL";


  return {

    confirmed:

      micro.bias ===
      side

      &&

      momentum

      &&

      (
        retest

        ||

        rejection

        ||

        Boolean(
          fvg
        )
      ),

    bias:
      micro.bias,

    retest,

    rejection,

    fvg

  };

}


/* =========================================================
   MICROSTRUCTURE
========================================================= */

function analyzeMicroStructure(
  candles
) {

  if (
    candles.length <
    10
  ) {

    return {

      bias:
        "NEUTRAL"

    };

  }


  const highs =

    findPivots(

      candles,

      "high",

      1,

      1

    )
      .slice(
        -2
      );


  const lows =

    findPivots(

      candles,

      "low",

      1,

      1

    )
      .slice(
        -2
      );


  if (

    highs.length >=
    2

    &&

    lows.length >=
    2

  ) {

    const hh =

      highs[1].price >
      highs[0].price;


    const hl =

      lows[1].price >
      lows[0].price;


    const lh =

      highs[1].price <
      highs[0].price;


    const ll =

      lows[1].price <
      lows[0].price;


    if (
      hh &&
      hl
    ) {

      return {

        bias:
          "BUY"

      };

    }


    if (
      lh &&
      ll
    ) {

      return {

        bias:
          "SELL"

      };

    }

  }


  /*
    EMA fallback makes 5M confirmation
    less binary.
  */

  const closes =

    candles.map(

      candle =>
        candle.close

    );


  const ema9 =
    ema(

      closes,

      9

    );


  const ema20 =
    ema(

      closes,

      20

    );


  const lastClose =

    closes[
      closes.length -
      1
    ];


  if (

    lastClose >
    ema9

    &&

    ema9 >
    ema20

  ) {

    return {

      bias:
        "BUY"

    };

  }


  if (

    lastClose <
    ema9

    &&

    ema9 <
    ema20

  ) {

    return {

      bias:
        "SELL"

    };

  }


  return {

    bias:
      "NEUTRAL"

  };

}


/* =========================================================
   FVG
========================================================= */

function findRecentFvg(

  candles,

  bullish

) {

  let latest =
    null;


  for (

    let i =
      2;

    i <
      candles.length;

    i++

  ) {

    const first =

      candles[
        i -
        2
      ];


    const third =
      candles[i];


    if (

      bullish

      &&

      third.low >
      first.high

    ) {

      latest = {

        direction:
          "BUY",

        low:
          first.high,

        high:
          third.low,

        time:
          third.time

      };

    }


    if (

      !bullish

      &&

      third.high <
      first.low

    ) {

      latest = {

        direction:
          "SELL",

        low:
          third.high,

        high:
          first.low,

        time:
          third.time

      };

    }

  }


  return latest;

}


/* =========================================================
   HTF TREND
========================================================= */

function analyzeTrend(

  candles,

  timeframe

) {

  const closes =

    candles.map(

      candle =>
        candle.close

    );


  const last =

    candles[
      candles.length -
      1
    ];


  const ema20 =
    ema(

      closes,

      20

    );


  const ema50 =
    ema(

      closes,

      50

    );


  const previousEma20 =
    ema(

      closes.slice(
        0,
        -3
      ),

      20

    );


  const highs =

    findPivots(

      candles,

      "high",

      2,

      2

    )
      .slice(
        -2
      );


  const lows =

    findPivots(

      candles,

      "low",

      2,

      2

    )
      .slice(
        -2
      );


  let structure =
    "NEUTRAL";


  if (

    highs.length >=
    2

    &&

    lows.length >=
    2

  ) {

    const hh =

      highs[1].price >
      highs[0].price;


    const hl =

      lows[1].price >
      lows[0].price;


    const lh =

      highs[1].price <
      highs[0].price;


    const ll =

      lows[1].price <
      lows[0].price;


    if (
      hh &&
      hl
    ) {

      structure =
        "BUY";

    }

    else if (
      lh &&
      ll
    ) {

      structure =
        "SELL";

    }

  }


  const emaBull =

    last.close >
    ema20

    &&

    ema20 >
    ema50

    &&

    ema20 >=
    previousEma20;


  const emaBear =

    last.close <
    ema20

    &&

    ema20 <
    ema50

    &&

    ema20 <=
    previousEma20;


  let bias =
    "NEUTRAL";


  if (

    structure ===
    "BUY"

    &&

    emaBull

  ) {

    bias =
      "BUY";

  }

  else if (

    structure ===
    "SELL"

    &&

    emaBear

  ) {

    bias =
      "SELL";

  }

  else if (

    emaBull

    &&

    structure !==
    "SELL"

  ) {

    bias =
      "BUY";

  }

  else if (

    emaBear

    &&

    structure !==
    "BUY"

  ) {

    bias =
      "SELL";

  }


  return {

    timeframe,

    bias,

    structure,

    close:
      last.close,

    ema20,

    ema50

  };

}


/* =========================================================
   DOWNLOAD HISTORICAL CANDLES
========================================================= */

async function fetchHistoricalCandles({

  startSec,

  endSec,

  granularity

}) {

  const windows =
    [];


  const span =

    granularity *

    CHUNK_CANDLES;


  let cursor =
    startSec;


  while (
    cursor <
    endSec
  ) {

    const chunkEnd =

      Math.min(

        endSec,

        cursor +
        span

      );


    windows.push({

      startSec:
        cursor,

      endSec:
        chunkEnd

    });


    cursor =
      chunkEnd;

  }


  const rows =
    [];


  for (

    let i =
      0;

    i <
      windows.length;

    i +=
      REQUEST_CONCURRENCY

  ) {

    const batch =

      windows.slice(

        i,

        i +
        REQUEST_CONCURRENCY

      );


    const results =

      await Promise.all(

        batch.map(

          window =>
            fetchCandleChunk({

              ...window,

              granularity

            })

        )

      );


    for (
      const result
      of results
    ) {

      rows.push(
        ...result
      );

    }


    if (

      i +
      REQUEST_CONCURRENCY <
      windows.length

    ) {

      await delay(
        120
      );

    }

  }


  const byTime =
    new Map();


  for (
    const candle
    of rows
  ) {

    if (

      candle.time >=
      startSec -
      granularity

      &&

      candle.time <=
      endSec

    ) {

      byTime.set(

        candle.time,

        candle

      );

    }

  }


  return [

    ...byTime.values()

  ]

    .sort(

      (
        a,
        b
      ) =>
        a.time -
        b.time

    )

    .filter(

      candle =>
        candle.time +
        granularity <=
        endSec

    );

}


/* =========================================================
   FETCH CHUNK
========================================================= */

async function fetchCandleChunk({

  startSec,

  endSec,

  granularity

}) {

  const url =
    new URL(

      `${COINBASE_BASE}/products/${PRODUCT_ID}/candles`

    );


  url.searchParams.set(

    "granularity",

    String(
      granularity
    )

  );


  url.searchParams.set(

    "start",

    new Date(

      startSec *
      1000

    )
      .toISOString()

  );


  url.searchParams.set(

    "end",

    new Date(

      endSec *
      1000

    )
      .toISOString()

  );


  const controller =
    new AbortController();


  const timeout =
    setTimeout(

      () =>
        controller.abort(),

      12000

    );


  try {

    const response =
      await fetch(

        url.toString(),

        {

          headers: {

            Accept:
              "application/json",

            "User-Agent":
              "MKAYFX-BTC-Backtester/1.1"

          },

          cache:
            "no-store",

          signal:
            controller.signal

        }

      );


    if (
      !response.ok
    ) {

      const body =
        await response.text();


      throw new Error(

        `Coinbase candles HTTP ${response.status}: ${body.slice(0,180)}`

      );

    }


    const rows =
      await response.json();


    if (
      !Array.isArray(
        rows
      )
    ) {

      throw new Error(

        "Coinbase candles response is not an array."

      );

    }


    return rows

      .map(

        row => ({

          time:
            Number(
              row[0]
            ),

          low:
            Number(
              row[1]
            ),

          high:
            Number(
              row[2]
            ),

          open:
            Number(
              row[3]
            ),

          close:
            Number(
              row[4]
            ),

          volume:
            Number(
              row[5]
            )
            ||
            0

        })

      )

      .filter(

        candle =>

          [

            candle.time,

            candle.low,

            candle.high,

            candle.open,

            candle.close,

            candle.volume

          ]
            .every(
              Number.isFinite
            )

      );

  }

  finally {

    clearTimeout(
      timeout
    );

  }

}


/* =========================================================
   RESAMPLE
========================================================= */

function resampleCandles(

  candles,

  targetSeconds,

  expectedParts

) {

  const groups =
    new Map();


  for (
    const candle
    of candles
  ) {

    const bucket =

      Math.floor(

        candle.time /
        targetSeconds

      )

      *

      targetSeconds;


    if (
      !groups.has(
        bucket
      )
    ) {

      groups.set(

        bucket,

        []

      );

    }


    groups
      .get(
        bucket
      )
      .push(
        candle
      );

  }


  const result =
    [];


  for (

    const [

      bucket,

      group

    ]

    of [

      ...groups.entries()

    ]
      .sort(

        (
          a,
          b
        ) =>
          a[0] -
          b[0]

      )

  ) {

    if (
      group.length <
      expectedParts
    ) {

      continue;

    }


    group.sort(

      (
        a,
        b
      ) =>
        a.time -
        b.time

    );


    result.push({

      time:
        bucket,

      open:
        group[0]
          .open,

      high:
        Math.max(

          ...group.map(

            candle =>
              candle.high

          )

        ),

      low:
        Math.min(

          ...group.map(

            candle =>
              candle.low

          )

        ),

      close:
        group[
          group.length -
          1
        ]
          .close,

      volume:
        group.reduce(

          (
            total,
            candle
          ) =>

            total +
            candle.volume,

          0

        )

    });

  }


  return result;

}


/* =========================================================
   PREVIOUS DAY
========================================================= */

function getPreviousUtcDayRange(
  candles
) {

  if (
    !candles.length
  ) {

    return null;

  }


  const latest =

    new Date(

      candles[
        candles.length -
        1
      ]
        .time *
      1000

    );


  const todayStart =

    Date.UTC(

      latest.getUTCFullYear(),

      latest.getUTCMonth(),

      latest.getUTCDate()

    )

    /

    1000;


  const previousStart =

    todayStart -
    86400;


  const previous =

    candles.filter(

      candle =>

        candle.time >=
        previousStart

        &&

        candle.time <
        todayStart

    );


  if (
    !previous.length
  ) {

    return null;

  }


  return {

    high:
      Math.max(

        ...previous.map(

          candle =>
            candle.high

        )

      ),

    low:
      Math.min(

        ...previous.map(

          candle =>
            candle.low

        )

      )

  };

}


/* =========================================================
   ASIAN RANGE
========================================================= */

function getLatestAsianRange(
  candles
) {

  if (
    !candles.length
  ) {

    return null;

  }


  const latestTime =

    candles[
      candles.length -
      1
    ]
      .time;


  const latestDate =

    new Date(

      latestTime *
      1000

    );


  let dayStart =

    Date.UTC(

      latestDate
        .getUTCFullYear(),

      latestDate
        .getUTCMonth(),

      latestDate
        .getUTCDate()

    )

    /

    1000;


  if (

    latestTime <

    dayStart +
    8 *
    3600

  ) {

    dayStart -=
      86400;

  }


  const session =

    candles.filter(

      candle =>

        candle.time >=
        dayStart

        &&

        candle.time <

        dayStart +
        8 *
        3600

    );


  if (
    !session.length
  ) {

    return null;

  }


  return {

    high:
      Math.max(

        ...session.map(

          candle =>
            candle.high

        )

      ),

    low:
      Math.min(

        ...session.map(

          candle =>
            candle.low

        )

      )

  };

}


/* =========================================================
   WEEKLY OPEN
========================================================= */

function getCurrentWeekOpen(
  candles
) {

  if (
    !candles.length
  ) {

    return null;

  }


  const latest =

    new Date(

      candles[
        candles.length -
        1
      ]
        .time *
      1000

    );


  const day =
    latest.getUTCDay();


  const daysSinceMonday =

    (
      day +
      6
    )

    %

    7;


  const mondayStart =

    Date.UTC(

      latest.getUTCFullYear(),

      latest.getUTCMonth(),

      latest.getUTCDate() -
      daysSinceMonday

    )

    /

    1000;


  const first =

    candles.find(

      candle =>
        candle.time >=
        mondayStart

    );


  return (

    first
      ?.open

    ??

    null

  );

}


/* =========================================================
   SESSION
========================================================= */

function getSession(
  date
) {

  const hour =

    date.getUTCHours()

    +

    date.getUTCMinutes() /
    60;


  if (

    hour >=
    0

    &&

    hour <
    7

  ) {

    return {

      name:
        "ASIA",

      label:
        "Asian session"

    };

  }


  if (

    hour >=
    7

    &&

    hour <
    12

  ) {

    return {

      name:
        "LONDON",

      label:
        "London session"

    };

  }


  if (

    hour >=
    12

    &&

    hour <
    16

  ) {

    return {

      name:
        "LONDON_NY_OVERLAP",

      label:
        "London / New York overlap"

    };

  }


  if (

    hour >=
    16

    &&

    hour <
    21

  ) {

    return {

      name:
        "NEW_YORK",

      label:
        "New York session"

    };

  }


  return {

    name:
      "OFF_HOURS",

    label:
      "Off-hours"

  };

}


/* =========================================================
   PIVOTS
========================================================= */

function findPivots(

  candles,

  field,

  left = 2,

  right = 2

) {

  const output =
    [];


  for (

    let i =
      left;

    i <
      candles.length -
      right;

    i++

  ) {

    const value =
      candles[i][field];


    let valid =
      true;


    for (

      let j =
        i -
        left;

      j <=
        i +
        right;

      j++

    ) {

      if (
        j ===
        i
      ) {

        continue;

      }


      if (

        field ===
        "high"

        &&

        candles[j].high >=
        value

      ) {

        valid =
          false;

        break;

      }


      if (

        field ===
        "low"

        &&

        candles[j].low <=
        value

      ) {

        valid =
          false;

        break;

      }

    }


    if (
      valid
    ) {

      output.push({

        index:
          i,

        time:
          candles[i]
            .time,

        price:
          value

      });

    }

  }


  return output;

}


/* =========================================================
   EQUAL LEVELS
========================================================= */

function findEqualLevels(

  values,

  tolerance

) {

  const output =
    [];


  for (

    let i =
      0;

    i <
      values.length;

    i++

  ) {

    for (

      let j =
        i +
        1;

      j <
        values.length;

      j++

    ) {

      if (

        Math.abs(

          values[i] -
          values[j]

        )

        <=

        tolerance

      ) {

        output.push(

          (
            values[i] +
            values[j]
          )

          /

          2

        );

      }

    }

  }


  return dedupeNumbers(

    output,

    tolerance *
    0.7

  );

}


/* =========================================================
   ADD LEVEL
========================================================= */

function pushLevel(

  array,

  name,

  value,

  type,

  weight,

  time = null

) {

  if (
    !Number.isFinite(
      value
    )
  ) {

    return;

  }


  array.push({

    name,

    price:
      value,

    type,

    weight,

    time

  });

}


/* =========================================================
   DEDUPE
========================================================= */

function dedupeLevels(
  levels
) {

  const sorted =

    [
      ...levels
    ]
      .sort(

        (
          a,
          b
        ) =>
          b.weight -
          a.weight

      );


  const output =
    [];


  for (
    const level
    of sorted
  ) {

    const tolerance =

      Math.max(

        level.price *
        0.00015,

        5

      );


    const duplicate =

      output.some(

        existing =>

          Math.abs(

            existing.price -
            level.price

          )

          <=

          tolerance

      );


    if (
      !duplicate
    ) {

      output.push(
        level
      );

    }

  }


  return output;

}


function dedupeNumbers(

  values,

  tolerance

) {

  const output =
    [];


  for (
    const value
    of values
  ) {

    const exists =

      output.some(

        existing =>

          Math.abs(

            existing -
            value

          )

          <=

          tolerance

      );


    if (
      !exists
    ) {

      output.push(
        value
      );

    }

  }


  return output;

}


/* =========================================================
   ATR
========================================================= */

function atr(

  candles,

  period = 14

) {

  if (

    candles.length <
    period +
    2

  ) {

    return 0;

  }


  const ranges =
    [];


  for (

    let i =
      1;

    i <
      candles.length;

    i++

  ) {

    const candle =
      candles[i];


    const previous =
      candles[
        i -
        1
      ];


    ranges.push(

      Math.max(

        candle.high -
        candle.low,

        Math.abs(

          candle.high -
          previous.close

        ),

        Math.abs(

          candle.low -
          previous.close

        )

      )

    );

  }


  return average(

    ranges.slice(

      -period

    )

  );

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

    return 0;

  }


  if (
    values.length <
    period
  ) {

    return average(
      values
    );

  }


  const multiplier =

    2 /

    (
      period +
      1
    );


  let result =

    average(

      values.slice(

        0,

        period

      )

    );


  for (

    let i =
      period;

    i <
      values.length;

    i++

  ) {

    result =

      values[i] *
      multiplier

      +

      result *
      (
        1 -
        multiplier
      );

  }


  return result;

}


/* =========================================================
   NEXT 5M INDEX
========================================================= */

function findNext5mIndex(

  candles,

  cutoffSec

) {

  let low =
    0;


  let high =
    candles.length -
    1;


  let answer =
    -1;


  while (
    low <=
    high
  ) {

    const middle =

      Math.floor(

        (
          low +
          high
        )

        /

        2

      );


    if (
      candles[middle].time >=
      cutoffSec
    ) {

      answer =
        middle;


      high =
        middle -
        1;

    }

    else {

      low =
        middle +
        1;

    }

  }


  return answer;

}


/* =========================================================
   HELPERS
========================================================= */

function oppositeSide(
  side
) {

  return (

    side ===
    "BUY"

      ? "SELL"

      : "BUY"

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

    )

    /

    values.length

  );

}


function scoreToConfidence(

  score,

  gap,

  signal

) {

  if (
    signal ===
    "WAIT"
  ) {

    return Math.round(

      clamp(

        score *
        0.72

        +

        gap *
        0.20,

        0,

        69

      )

    );

  }


  return Math.round(

    clamp(

      score *
      0.86

      +

      Math.min(

        gap,

        20

      )

      *
      0.65,

      50,

      98

    )

  );

}


function numberOr(

  value,

  fallback

) {

  const valueNumber =
    Number(
      value
    );


  return Number.isFinite(
    valueNumber
  )

    ? valueNumber

    : fallback;

}


function clamp(

  value,

  minimum,

  maximum

) {

  return Math.min(

    maximum,

    Math.max(

      minimum,

      value

    )

  );

}


function round(

  value,

  digits = 2

) {

  if (
    !Number.isFinite(
      value
    )
  ) {

    return 0;

  }


  const factor =

    10 **
    digits;


  return (

    Math.round(

      value *
      factor

    )

    /

    factor

  );

}


function roundPrice(
  value
) {

  if (
    !Number.isFinite(
      value
    )
  ) {

    return null;

  }


  return (

    Math.round(

      value *
      100

    )

    /

    100

  );

}


function delay(
  milliseconds
) {

  return new Promise(

    resolve =>
      setTimeout(

        resolve,

        milliseconds

      )

  );

}


/* =========================================================
   HEADERS
========================================================= */

function setHeaders(
  res
) {

  res.setHeader(

    "Cache-Control",

    "public, s-maxage=300, stale-while-revalidate=60"

  );


  res.setHeader(

    "Access-Control-Allow-Origin",

    "*"

  );


  res.setHeader(

    "Access-Control-Allow-Methods",

    "GET,POST,OPTIONS"

  );


  res.setHeader(

    "Access-Control-Allow-Headers",

    "Content-Type, Authorization"

  );

}