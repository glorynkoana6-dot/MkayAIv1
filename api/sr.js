/* =========================================================
   MKAYFX BTC/USD LIQUIDITY SNIPER V1.0
   Vercel API route: /api/sr.js

   MODEL
   -----
   4H  = macro trend / regime
   1H  = directional bias + liquidity map
   15M = liquidity sweep + reclaim + BOS + displacement
   5M  = precision confirmation / FVG / retest / rejection

   DATA
   ----
   Coinbase Exchange BTC-USD public REST API.
   No API key required.

   SIGNAL RULE
   -----------
   A trade REQUIRES:
   1) 15M liquidity sweep + reclaim
   2) 15M break of structure
   3) 15M displacement
   4) score >= minimum threshold

   DEFAULTS
   --------
   Minimum score = 70
   Sniper score  = 80
   Main TP       = 3R
========================================================= */

const COINBASE_BASE =
  "https://api.exchange.coinbase.com";

const PRODUCT_ID =
  "BTC-USD";

const SYMBOL =
  "BTC/USD";


/* =========================================================
   SETTINGS
========================================================= */

const CFG = {

  minScore:
    envNumber(
      "BTC_MIN_SIGNAL_SCORE",
      70,
      55,
      95
    ),

  sniperScore:
    envNumber(
      "BTC_SNIPER_SCORE",
      80,
      65,
      100
    ),

  targetR:
    envNumber(
      "BTC_TARGET_R",
      3.0,
      1.5,
      6.0
    ),

  tp1R:
    envNumber(
      "BTC_TP1_R",
      1.5,
      0.5,
      3.0
    ),

  tp2R:
    envNumber(
      "BTC_TP2_R",
      4.0,
      2.0,
      8.0
    ),

  stopAtrBuffer:
    envNumber(
      "BTC_STOP_ATR_BUFFER",
      0.20,
      0.05,
      0.75
    ),

  maxEntryExtensionAtr:
    envNumber(
      "BTC_MAX_ENTRY_EXTENSION_ATR",
      1.20,
      0.4,
      3.0
    ),

  sweepLookback:
    Math.round(
      envNumber(
        "BTC_SWEEP_LOOKBACK_BARS",
        6,
        2,
        12
      )
    ),

  minSweepDepthAtr:
    envNumber(
      "BTC_MIN_SWEEP_DEPTH_ATR",
      0.03,
      0.0,
      0.30
    ),

  bosLookback:
    Math.round(
      envNumber(
        "BTC_BOS_LOOKBACK_BARS",
        8,
        4,
        20
      )
    ),

  displacementBodyAtr:
    envNumber(
      "BTC_DISPLACEMENT_BODY_ATR",
      0.55,
      0.25,
      1.50
    ),

  displacementEfficiency:
    envNumber(
      "BTC_DISPLACEMENT_EFFICIENCY",
      0.55,
      0.30,
      0.90
    ),

  volumeSpikeMult:
    envNumber(
      "BTC_VOLUME_SPIKE_MULT",
      1.25,
      1.0,
      3.0
    ),

  fvgLookback5m:
    Math.round(
      envNumber(
        "BTC_FVG_LOOKBACK_5M",
        24,
        8,
        60
      )
    )
};


/* =========================================================
   API HANDLER
========================================================= */

export default async function handler(
  req,
  res
) {

  setHeaders(res);


  if (
    req.method === "OPTIONS"
  ) {

    return res
      .status(204)
      .end();

  }


  if (
    req.method !== "GET" &&
    req.method !== "POST"
  ) {

    return res
      .status(405)
      .json({

        success: false,

        error:
          "Use GET or POST."

      });

  }


  try {

    const input = {

      ...(req.query || {}),

      ...(
        req.body &&
        typeof req.body === "object"
          ? req.body
          : {}
      )

    };


    const symbol =
      normalizeSymbol(
        input.symbol ||
        SYMBOL
      );


    if (
      symbol !== SYMBOL
    ) {

      return res
        .status(400)
        .json({

          success: false,

          error:
            "This endpoint is BTC/USD only.",

          allowedSymbol:
            SYMBOL

        });

    }


    const mode =
      String(
        input.mode ||
        "analysis"
      )
        .toLowerCase();


    /* =====================================================
       HEALTH
    ===================================================== */

    if (
      mode === "health"
    ) {

      return res
        .status(200)
        .json({

          success: true,

          service:
            "MKAYFX BTC Liquidity Sniper",

          version:
            "1.0",

          symbol:
            SYMBOL,

          source:
            "Coinbase Exchange",

          timestamp:
            new Date()
              .toISOString()

        });

    }


    /* =====================================================
       PRICE ONLY
    ===================================================== */

    if (
      mode === "price"
    ) {

      const ticker =
        await fetchTicker();


      return res
        .status(200)
        .json({

          success: true,

          symbol:
            SYMBOL,

          price:
            roundPrice(
              ticker.price
            ),

          bid:
            roundPrice(
              ticker.bid
            ),

          ask:
            roundPrice(
              ticker.ask
            ),

          spread:
            roundPrice(
              ticker.ask -
              ticker.bid
            ),

          timestamp:
            ticker.time,

          source:
            "Coinbase Exchange"

        });

    }


    /* =====================================================
       HARD LOCK CHECK
    ===================================================== */

    const locked =
      parseLockedTrade(
        input
      );


    if (
      locked
    ) {

      const ticker =
        await fetchTicker();


      const lockCheck =
        evaluateLockedTrade(

          locked,

          ticker.price

        );


      return res
        .status(200)
        .json({

          success: true,

          model:
            "MKAYFX BTC LIQUIDITY SNIPER V1.0",

          symbol:
            SYMBOL,

          signal:
            locked.signal,

          locked:
            lockCheck.status ===
            "ACTIVE",

          entry:
            roundPrice(
              locked.entry
            ),

          stopLoss:
            roundPrice(
              locked.stopLoss
            ),

          takeProfit:
            roundPrice(
              locked.takeProfit
            ),

          currentPrice:
            roundPrice(
              ticker.price
            ),

          lockCheck,

          timestamp:
            new Date()
              .toISOString()

        });

    }


    /* =====================================================
       LOAD MARKET DATA
    ===================================================== */

    const [

      ticker,

      candles5m,

      candles1h

    ] = await Promise.all([

      fetchTicker(),

      fetchCandles(
        300
      ),

      fetchCandles(
        3600
      )

    ]);


    if (
      candles5m.length < 120 ||
      candles1h.length < 120
    ) {

      throw new Error(

        `Not enough BTC history. M5=${candles5m.length}, H1=${candles1h.length}`

      );

    }


    /* =====================================================
       CREATE 15M + 4H
    ===================================================== */

    const candles15m =
      resampleCandles(

        candles5m,

        15 * 60,

        3

      );


    const candles4h =
      resampleCandles(

        candles1h,

        4 * 60 * 60,

        4

      );


    if (
      candles15m.length < 35 ||
      candles4h.length < 25
    ) {

      throw new Error(

        `Not enough resampled history. M15=${candles15m.length}, H4=${candles4h.length}`

      );

    }


    /* =====================================================
       RUN ANALYSIS
    ===================================================== */

    const result =
      analyzeMarket({

        ticker,

        candles5m,

        candles15m,

        candles1h,

        candles4h

      });


    return res
      .status(200)
      .json(
        result
      );

  }

  catch (
    error
  ) {

    console.error(

      "MKAYFX BTC sniper error:",

      error

    );


    return res
      .status(500)
      .json({

        success: false,

        symbol:
          SYMBOL,

        error:
          error?.message ||
          "Unknown server error",

        timestamp:
          new Date()
            .toISOString()

      });

  }

}


/* =========================================================
   MAIN ANALYSIS
========================================================= */

function analyzeMarket({

  ticker,

  candles5m,

  candles15m,

  candles1h,

  candles4h

}) {

  const currentPrice =
    ticker.price;


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


  /* =====================================================
     HTF TREND
  ===================================================== */

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


  /* =====================================================
     LIQUIDITY
  ===================================================== */

  const liquidity =
    buildLiquidityMap({

      candles15m,

      candles1h,

      candles4h,

      atr1h

    });


  /* =====================================================
     BUY MODEL
  ===================================================== */

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

      atr15

    });


  /* =====================================================
     SELL MODEL
  ===================================================== */

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

      atr15

    });


  /* =====================================================
     CHOOSE BEST SIDE
  ===================================================== */

  let best =
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

    best.coreTrigger &&

    best.score >=
      CFG.minScore &&

    !best.extended

      ? best.side

      : "WAIT";


  /* =====================================================
     CONFLICT FILTER
  ===================================================== */

  const conflicting =

    buySetup.score >= 60 &&

    sellSetup.score >= 60 &&

    scoreGap < 10;


  if (
    conflicting
  ) {

    signal =
      "WAIT";


    best.blockers.push(

      "BUY and SELL scores are too close. No clean directional edge."

    );

  }


  /* =====================================================
     BUILD TRADE
  ===================================================== */

  let trade =
    null;


  if (
    signal !== "WAIT"
  ) {

    trade =
      buildTrade(

        signal,

        currentPrice,

        best,

        atr15

      );


    if (
      !trade.valid
    ) {

      signal =
        "WAIT";


      best.blockers.push(

        trade.reason ||
        "Invalid risk structure."

      );


      trade =
        null;

    }

  }


  const now =
    new Date();


  const session =
    getSession(
      now
    );


  const confidence =
    scoreToConfidence(

      best.score,

      scoreGap,

      signal

    );


  /* =====================================================
     RETURN DATA
  ===================================================== */

  return {

    success:
      true,

    model:
      "MKAYFX BTC LIQUIDITY SNIPER V1.0",

    symbol:
      SYMBOL,

    marketName:
      "Bitcoin / U.S. Dollar",


    signalId:
      `BTCUSD-${Date.now()}-${signal}`,

    createdAt:
      now.toISOString(),

    timestamp:
      now.toISOString(),


    timeframe:
      "4H → 1H → 15M → 5M",


    signal,


    trigger:

      signal === "WAIT"

        ? "NO_VALID_SNIPER_TRIGGER"

        : best.trigger,


    locked:
      signal !== "WAIT",


    signalScore:
      Math.round(
        best.score
      ),


    confidence,


    sniper:

      signal !== "WAIT" &&

      best.score >=
      CFG.sniperScore,


    /* ===================================================
       PRICE
    =================================================== */

    price:
      roundPrice(
        currentPrice
      ),

    currentPrice:
      roundPrice(
        currentPrice
      ),

    bid:
      roundPrice(
        ticker.bid
      ),

    ask:
      roundPrice(
        ticker.ask
      ),


    /* ===================================================
       TRADE
    =================================================== */

    entry:

      trade

        ? roundPrice(
            trade.entry
          )

        : null,


    stopLoss:

      trade

        ? roundPrice(
            trade.stopLoss
          )

        : null,


    takeProfit1:

      trade

        ? roundPrice(
            trade.takeProfit1
          )

        : null,


    takeProfit:

      trade

        ? roundPrice(
            trade.takeProfit
          )

        : null,


    takeProfit2:

      trade

        ? roundPrice(
            trade.takeProfit2
          )

        : null,


    risk:

      trade

        ? roundPrice(
            trade.risk
          )

        : null,


    rr:

      trade

        ? CFG.targetR

        : null,


    session,


    /* ===================================================
       TIMEFRAME BIAS
    =================================================== */

    timeframeBias: {

      H4:
        trend4h.bias,

      H1:
        trend1h.bias,

      M15:
        best.structureBias,

      M5:
        best.precision.bias

    },


    /* ===================================================
       SCORES
    =================================================== */

    scores: {

      buy:
        Math.round(
          buySetup.score
        ),

      sell:
        Math.round(
          sellSetup.score
        ),

      gap:
        Math.round(
          scoreGap
        ),

      threshold:
        CFG.minScore,

      sniperThreshold:
        CFG.sniperScore

    },


    components:
      best.components,


    /* ===================================================
       STRUCTURE
    =================================================== */

    structure: {

      H4:
        trend4h,

      H1:
        trend1h,

      M15:
        best.structure,

      M5:
        best.precision

    },


    /* ===================================================
       LIQUIDITY MAP
    =================================================== */

    liquidity: {

      sweptLevel:

        best.sweep

          ? {

              name:
                best.sweep
                  .level
                  .name,

              type:
                best.sweep
                  .level
                  .type,

              levelPrice:
                roundPrice(
                  best.sweep
                    .level
                    .price
                ),

              sweepExtreme:
                roundPrice(
                  best.sweep
                    .extreme
                ),

              reclaimed:
                true

            }

          : null,


      previousDayHigh:
        nullablePrice(
          liquidity
            .previousDayHigh
        ),


      previousDayLow:
        nullablePrice(
          liquidity
            .previousDayLow
        ),


      previous4hHigh:
        nullablePrice(
          liquidity
            .previous4hHigh
        ),


      previous4hLow:
        nullablePrice(
          liquidity
            .previous4hLow
        ),


      asianHigh:
        nullablePrice(
          liquidity
            .asianHigh
        ),


      asianLow:
        nullablePrice(
          liquidity
            .asianLow
        ),


      weeklyOpen:
        nullablePrice(
          liquidity
            .weeklyOpen
        ),


      recentSwingHighs:

        liquidity
          .swingHighs
          .slice(-4)
          .map(
            roundPrice
          ),


      recentSwingLows:

        liquidity
          .swingLows
          .slice(-4)
          .map(
            roundPrice
          ),


      equalHighs:

        liquidity
          .equalHighs
          .slice(-3)
          .map(
            roundPrice
          ),


      equalLows:

        liquidity
          .equalLows
          .slice(-3)
          .map(
            roundPrice
          )

    },


    /* ===================================================
       TECHNICAL DATA
    =================================================== */

    technical: {

      atr15:
        roundPrice(
          atr15
        ),

      atr1h:
        roundPrice(
          atr1h
        ),

      bos:
        best.bos,

      displacement:
        best.displacement,

      volumeRatio:
        round(
          best.volumeRatio,
          2
        ),

      fvg:
        best.precision
          .fvg,

      retest:
        best.precision
          .retest,

      rejection:
        best.precision
          .rejection,

      extensionAtr:
        round(
          best.extensionAtr,
          2
        ),

      extended:
        best.extended

    },


    reasons:
      dedupe(
        best.reasons
      ),


    blockers:
      dedupe(
        best.blockers
      ),


    /* ===================================================
       SETTINGS
    =================================================== */

    settings: {

      macro:
        "4H",

      confirmation:
        "1H",

      setup:
        "15M",

      precision:
        "5M",

      minSignalScore:
        CFG.minScore,

      sniperScore:
        CFG.sniperScore,

      targetR:
        CFG.targetR,

      tp1R:
        CFG.tp1R,

      tp2R:
        CFG.tp2R,

      stopAtrBuffer:
        CFG.stopAtrBuffer,

      volumeSpikeMultiplier:
        CFG.volumeSpikeMult,

      tradeMode:
        "HARD LOCK"

    },


    dataSources: {

      price:
        "Coinbase Exchange BTC-USD ticker",

      candles:
        "Coinbase Exchange BTC-USD public candles",

      volume:
        "Coinbase Exchange actual traded volume"

    },


    lockCheck: {

      status:

        signal === "WAIT"

          ? "NO_TRADE"

          : "NEW_TRADE",

      signal,

      entry:

        trade

          ? roundPrice(
              trade.entry
            )

          : null,

      stopLoss:

        trade

          ? roundPrice(
              trade.stopLoss
            )

          : null,

      takeProfit:

        trade

          ? roundPrice(
              trade.takeProfit
            )

          : null

    }

  };

}


/* =========================================================
   SCORE EACH DIRECTION
========================================================= */

function evaluateDirection({

  side,

  currentPrice,

  candles5m,

  candles15m,

  trend4h,

  trend1h,

  liquidity,

  atr15

}) {

  const bullish =
    side === "BUY";


  const levels =
    bullish

      ? liquidity.lows

      : liquidity.highs;


  const reasons =
    [];


  const blockers =
    [];


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
     MAX = 15
  ===================================================== */

  if (
    trend4h.bias ===
    side
  ) {

    components
      .h4Trend =
      15;


    reasons.push(

      `4H macro trend aligned ${side}.`

    );

  }

  else if (
    trend4h.bias ===
    "NEUTRAL"
  ) {

    components
      .h4Trend =
      7;

  }

  else {

    blockers.push(

      `4H macro trend is ${trend4h.bias}.`

    );

  }


  /* =====================================================
     1H TREND
     MAX = 15
  ===================================================== */

  if (
    trend1h.bias ===
    side
  ) {

    components
      .h1Trend =
      15;


    reasons.push(

      `1H directional bias aligned ${side}.`

    );

  }

  else if (
    trend1h.bias ===
    "NEUTRAL"
  ) {

    components
      .h1Trend =
      7;

  }

  else {

    blockers.push(

      `1H directional bias is ${trend1h.bias}.`

    );

  }


  /* =====================================================
     LIQUIDITY SWEEP
     MAX = 20
     MANDATORY
  ===================================================== */

  const sweep =
    findRecentSweep({

      candles:
        candles15m,

      levels,

      bullish,

      atrValue:
        atr15

    });


  if (
    sweep
  ) {

    components
      .liquiditySweep =
      20;


    reasons.push(

      `${sweep.level.name} swept and reclaimed at ${roundPrice(sweep.level.price)}.`

    );

  }

  else {

    blockers.push(

      "No recent 15M liquidity sweep + reclaim."

    );

  }


  /* =====================================================
     BOS
     MAX = 15
  ===================================================== */

  const setupIndex =

    sweep

      ? sweep.index

      : Math.max(

          2,

          candles15m
            .length -
          4

        );


  const bos =
    detectBos({

      candles:
        candles15m,

      setupIndex,

      bullish,

      lookback:
        CFG.bosLookback

    });


  if (
    bos.confirmed
  ) {

    components
      .bos15m =
      15;


    reasons.push(

      `15M BOS confirmed through ${roundPrice(bos.level)}.`

    );

  }

  else if (
    bos.soft
  ) {

    components
      .bos15m =
      6;


    blockers.push(

      "15M structure is close to BOS but has not closed through it."

    );

  }

  else {

    blockers.push(

      "No confirmed 15M BOS after the sweep."

    );

  }


  /* =====================================================
     DISPLACEMENT
     MAX = 10
  ===================================================== */

  const displacement =
    detectDisplacement({

      candles:
        candles15m,

      fromIndex:
        setupIndex,

      bullish,

      atrValue:
        atr15

    });


  if (
    displacement.confirmed
  ) {

    components
      .displacement =
      10;


    reasons.push(

      `15M displacement confirmed (${round(displacement.bodyAtr, 2)} ATR body).`

    );

  }

  else if (
    displacement.partial
  ) {

    components
      .displacement =
      4;


    blockers.push(

      "15M displacement is only partial."

    );

  }

  else {

    blockers.push(

      "No strong 15M displacement after the sweep."

    );

  }


  /* =====================================================
     VOLUME
     MAX = 10
  ===================================================== */

  const volume =
    detectVolumeExpansion({

      candles:
        candles15m,

      fromIndex:
        setupIndex

    });


  if (
    volume.confirmed
  ) {

    components
      .volumeExpansion =
      10;


    reasons.push(

      `Volume expanded to ${round(volume.ratio, 2)}x baseline.`

    );

  }

  else if (
    volume.ratio >=
    1.05
  ) {

    components
      .volumeExpansion =
      4;

  }


  /* =====================================================
     5M PRECISION
     MAX = 10
  ===================================================== */

  const precision =
    analyze5mPrecision({

      candles5m,

      bullish,

      bosLevel:
        bos.level,

      currentPrice,

      atr15

    });


  if (
    precision.confirmed
  ) {

    components
      .precision5m =
      10;


    reasons.push(

      `5M precision confirms ${side}: ${precision.reason}.`

    );

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
     MAX = 5
  ===================================================== */

  const session =
    getSession(
      new Date()
    );


  if (

    session.name ===
      "LONDON" ||

    session.name ===
      "LONDON_NY_OVERLAP" ||

    session.name ===
      "NEW_YORK"

  ) {

    components
      .session =
      5;


    reasons.push(

      `${session.label} liquidity window active.`

    );

  }

  else {

    components
      .session =
      2;

  }


  /* =====================================================
     TOTAL SCORE
  ===================================================== */

  let score =

    Object
      .values(
        components
      )
      .reduce(

        (
          total,
          value
        ) =>
          total +
          value,

        0

      );


  /* =====================================================
     HTF OPPOSITION PENALTY
  ===================================================== */

  if (

    trend4h.bias ===
      oppositeSide(
        side
      ) &&

    trend1h.bias ===
      oppositeSide(
        side
      )

  ) {

    score -=
      12;


    blockers.push(

      "Both 4H and 1H oppose this trade."

    );

  }


  score =
    clamp(

      score,

      0,

      100

    );


  /* =====================================================
     ENTRY EXTENSION FILTER
  ===================================================== */

  const reference =

    sweep?.level?.price ??

    bos.level ??

    currentPrice;


  const extensionAtr =

    atr15 > 0

      ? Math.abs(

          currentPrice -
          reference

        ) /
        atr15

      : 0;


  const extended =

    extensionAtr >

    CFG
      .maxEntryExtensionAtr;


  if (
    extended
  ) {

    blockers.push(

      `Entry is ${round(extensionAtr, 2)} ATR from the setup. Waiting for retest.`

    );

  }


  /* =====================================================
     MANDATORY CORE TRIGGER
  ===================================================== */

  const coreTrigger =
    Boolean(

      sweep &&

      bos.confirmed &&

      displacement
        .confirmed

    );


  let trigger =
    "NONE";


  if (

    coreTrigger &&

    precision.confirmed

  ) {

    trigger =
      "SWEEP_BOS_DISPLACEMENT_5M_CONFIRM";

  }

  else if (
    coreTrigger
  ) {

    trigger =
      "SWEEP_BOS_DISPLACEMENT";

  }


  return {

    side,

    score,

    coreTrigger,

    trigger,

    components,

    reasons,

    blockers,

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

        : "NEUTRAL",

    structure: {

      bias:

        bos.confirmed

          ? side

          : "NEUTRAL",

      bosConfirmed:
        bos.confirmed,

      bosLevel:
        nullablePrice(
          bos.level
        ),

      sweepConfirmed:
        Boolean(
          sweep
        ),

      displacementConfirmed:
        displacement
          .confirmed

    }

  };

}


/* =========================================================
   LIQUIDITY MAP
========================================================= */

function buildLiquidityMap({

  candles15m,

  candles1h,

  candles4h,

  atr1h

}) {

  const highs =
    [];


  const lows =
    [];


  /* =====================================================
     PREVIOUS DAY
  ===================================================== */

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


  /* =====================================================
     PREVIOUS 4H
  ===================================================== */

  const previous4h =

    candles4h.length >= 2

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


  /* =====================================================
     ASIAN SESSION
  ===================================================== */

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


  /* =====================================================
     1H SWINGS
  ===================================================== */

  const highPivots =

    findPivots(

      candles1h,

      "high",

      2,

      2

    )
      .slice(
        -8
      );


  const lowPivots =

    findPivots(

      candles1h,

      "low",

      2,

      2

    )
      .slice(
        -8
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

    highPivots
      .map(
        x =>
          x.price
      );


  const swingLows =

    lowPivots
      .map(
        x =>
          x.price
      );


  /* =====================================================
     EQUAL HIGHS / LOWS
  ===================================================== */

  const tolerance =

    Math.max(

      atr1h *
      0.12,

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


  /* =====================================================
     WEEKLY OPEN
  ===================================================== */

  const weeklyOpen =
    getCurrentWeekOpen(

      candles1h

    );


  if (
    Number.isFinite(
      weeklyOpen
    )
  ) {

    const lastClose =

      candles1h[
        candles1h.length -
        1
      ]
        .close;


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
      ),

    previousDayHigh:
      previousDay?.high ??
      null,

    previousDayLow:
      previousDay?.low ??
      null,

    previous4hHigh:
      previous4h?.high ??
      null,

    previous4hLow:
      previous4h?.low ??
      null,

    asianHigh:
      asian?.high ??
      null,

    asianLow:
      asian?.low ??
      null,

    weeklyOpen:
      weeklyOpen ??
      null,

    swingHighs,

    swingLows,

    equalHighs,

    equalLows

  };

}


/* =========================================================
   FIND LIQUIDITY SWEEP
========================================================= */

function findRecentSweep({

  candles,

  levels,

  bullish,

  atrValue

}) {

  const start =

    Math.max(

      2,

      candles.length -
      CFG.sweepLookback

    );


  const minimumDepth =

    atrValue *

    CFG
      .minSweepDepthAtr;


  let best =
    null;


  for (
    let i = start;
    i < candles.length;
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
                minimumDepth &&

              candle.close >
                level.price
            )

          : (
              candle.high >=
                level.price +
                minimumDepth &&

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
        10 +

        (
          depth /
          Math.max(
            atrValue,
            0.0000001
          )
        ) *
        10 +

        recency;


      if (

        !best ||

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
   BREAK OF STRUCTURE
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
    before.length < 3
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
            c =>
              c.high
          )
        )

      : Math.min(
          ...before.map(
            c =>
              c.low
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


  const soft =

    confirmedIndex === null &&

    distance <=
    localAtr *
    0.15;


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

  atrValue

}) {

  const end =

    Math.min(

      candles.length,

      fromIndex +
      5

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

      atrValue > 0

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

      !best ||

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

    best.directionOk &&

    best.bodyAtr >=
      CFG
        .displacementBodyAtr &&

    best.efficiency >=
      CFG
        .displacementEfficiency;


  const partial =

    !confirmed &&

    best.directionOk &&

    best.bodyAtr >=
      CFG
        .displacementBodyAtr *
      0.70 &&

    best.efficiency >=
      CFG
        .displacementEfficiency *
      0.80;


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
   VOLUME EXPANSION
========================================================= */

function detectVolumeExpansion({

  candles,

  fromIndex

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


  const averageVolume =

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
        5

      )

    );


  const maxVolume =

    test.length

      ? Math.max(
          ...test.map(
            candle =>
              candle.volume
          )
        )

      : 0;


  const ratio =

    averageVolume > 0

      ? maxVolume /
        averageVolume

      : 0;


  return {

    confirmed:

      ratio >=
      CFG
        .volumeSpikeMult,

    ratio

  };

}


/* =========================================================
   5 MINUTE PRECISION
========================================================= */

function analyze5mPrecision({

  candles5m,

  bullish,

  bosLevel,

  currentPrice,

  atr15

}) {

  const candles =

    candles5m.slice(

      -CFG
        .fvgLookback5m

    );


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


  /* =====================================================
     REJECTION CANDLE
  ===================================================== */

  const rejection =

    bullish

      ? (
          latest.close >
            latest.open &&

          latest.open -
            latest.low >
          body *
            0.35
        )

      : (
          latest.close <
            latest.open &&

          latest.high -
            latest.open >
          body *
            0.35
        );


  /* =====================================================
     RETEST
  ===================================================== */

  let retest =
    false;


  let reason =
    null;


  if (
    Number.isFinite(
      bosLevel
    )
  ) {

    const tolerance =

      atr15 *
      0.18;


    const touched =

      latest.low <=
        bosLevel +
        tolerance &&

      latest.high >=
        bosLevel -
        tolerance;


    const held =

      bullish

        ? latest.close >=
          bosLevel

        : latest.close <=
          bosLevel;


    if (
      touched &&
      held
    ) {

      retest =
        true;


      reason =
        "BOS retest held";

    }

  }


  /* =====================================================
     FVG RETEST
  ===================================================== */

  if (
    !retest &&
    fvg
  ) {

    const tolerance =

      atr15 *
      0.12;


    const zoneTouched =

      currentPrice >=
        fvg.low -
        tolerance &&

      currentPrice <=
        fvg.high +
        tolerance;


    if (
      zoneTouched
    ) {

      retest =
        true;


      reason =
        "fresh 5M FVG retest";

    }

  }


  /* =====================================================
     MOMENTUM
  ===================================================== */

  const momentum =

    bullish

      ? latest.close >
        previous.close

      : latest.close <
        previous.close;


  const side =

    bullish

      ? "BUY"

      : "SELL";


  const confirmed =

    micro.bias ===
      side &&

    momentum &&

    (
      retest ||

      rejection ||

      Boolean(
        fvg
      )
    );


  if (
    !reason
  ) {

    if (
      rejection
    ) {

      reason =
        "5M rejection candle";

    }

    else if (
      fvg
    ) {

      reason =
        "fresh 5M FVG";

    }

    else {

      reason =
        "5M microstructure";

    }

  }


  return {

    confirmed,

    bias:
      micro.bias,

    retest,

    rejection,

    reason,

    fvg:

      fvg

        ? {

            direction:
              fvg.direction,

            low:
              roundPrice(
                fvg.low
              ),

            high:
              roundPrice(
                fvg.high
              ),

            time:
              new Date(
                fvg.time *
                1000
              )
                .toISOString()

          }

        : null

  };

}


/* =========================================================
   5M MICRO STRUCTURE
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

    highs.length >= 2 &&

    lows.length >= 2

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


  /* =====================================================
     EMA FALLBACK
  ===================================================== */

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
      ema9 &&

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
      ema9 &&

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
   FAIR VALUE GAP
========================================================= */

function findRecentFvg(

  candles,

  bullish

) {

  let latest =
    null;


  for (

    let i = 2;

    i <
      candles.length;

    i++

  ) {

    const candleA =

      candles[
        i -
        2
      ];


    const candleC =

      candles[i];


    /* ===================================================
       BULLISH FVG
    =================================================== */

    if (

      bullish &&

      candleC.low >
      candleA.high

    ) {

      latest = {

        direction:
          "BUY",

        low:
          candleA.high,

        high:
          candleC.low,

        time:
          candleC.time

      };

    }


    /* ===================================================
       BEARISH FVG
    =================================================== */

    if (

      !bullish &&

      candleC.high <
      candleA.low

    ) {

      latest = {

        direction:
          "SELL",

        low:
          candleC.high,

        high:
          candleA.low,

        time:
          candleC.time

      };

    }

  }


  return latest;

}


/* =========================================================
   HIGHER TIMEFRAME TREND
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


  const previousCloses =

    closes.slice(
      0,
      -3
    );


  const previousEma20 =
    ema(

      previousCloses,

      20

    );


  /* =====================================================
     STRUCTURE
  ===================================================== */

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

    highs.length >= 2 &&

    lows.length >= 2

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


  /* =====================================================
     EMA TREND
  ===================================================== */

  const emaBull =

    last.close >
      ema20 &&

    ema20 >
      ema50 &&

    ema20 >
      previousEma20;


  const emaBear =

    last.close <
      ema20 &&

    ema20 <
      ema50 &&

    ema20 <
      previousEma20;


  let bias =
    "NEUTRAL";


  if (

    structure ===
      "BUY" &&

    emaBull

  ) {

    bias =
      "BUY";

  }

  else if (

    structure ===
      "SELL" &&

    emaBear

  ) {

    bias =
      "SELL";

  }

  else if (

    emaBull &&

    structure !==
      "SELL"

  ) {

    bias =
      "BUY";

  }

  else if (

    emaBear &&

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
      roundPrice(
        last.close
      ),

    ema20:
      roundPrice(
        ema20
      ),

    ema50:
      roundPrice(
        ema50
      ),

    ema20Slope:
      roundPrice(

        ema20 -
        previousEma20

      )

  };

}


/* =========================================================
   BUILD TRADE
========================================================= */

function buildTrade(

  side,

  entry,

  setup,

  atr15

) {

  if (
    !setup.sweep
  ) {

    return {

      valid:
        false,

      reason:
        "No sweep available for stop placement."

    };

  }


  const buffer =

    atr15 *

    CFG
      .stopAtrBuffer;


  const stopLoss =

    side === "BUY"

      ? setup.sweep
          .extreme -
        buffer

      : setup.sweep
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
    ) ||

    risk <= 0

  ) {

    return {

      valid:
        false,

      reason:
        "Invalid stop distance."

    };

  }


  /* =====================================================
     STOP TOO LARGE FILTER
  ===================================================== */

  if (

    atr15 > 0 &&

    risk >
    atr15 *
    3

  ) {

    return {

      valid:
        false,

      reason:
        `Stop is too wide (${round(risk / atr15, 2)} ATR).`

    };

  }


  const direction =

    side === "BUY"

      ? 1

      : -1;


  return {

    valid:
      true,

    entry,

    stopLoss,

    risk,


    takeProfit1:

      entry +

      direction *

      risk *

      CFG.tp1R,


    takeProfit:

      entry +

      direction *

      risk *

      CFG.targetR,


    takeProfit2:

      entry +

      direction *

      risk *

      CFG.tp2R

  };

}


/* =========================================================
   HARD LOCK
========================================================= */

function parseLockedTrade(
  input
) {

  const signal =

    String(

      input.lockSignal ||

      input.lockedSignal ||

      ""

    )
      .toUpperCase();


  const entry =

    Number(

      input.lockEntry ??

      input.entry

    );


  const stopLoss =

    Number(

      input.lockSL ??

      input.stopLoss

    );


  const takeProfit =

    Number(

      input.lockTP ??

      input.takeProfit

    );


  if (

    signal !== "BUY" &&

    signal !== "SELL"

  ) {

    return null;

  }


  if (

    ![

      entry,

      stopLoss,

      takeProfit

    ]
      .every(
        Number.isFinite
      )

  ) {

    return null;

  }


  return {

    signal,

    entry,

    stopLoss,

    takeProfit

  };

}


/* =========================================================
   EVALUATE LOCKED TRADE
========================================================= */

function evaluateLockedTrade(

  lock,

  currentPrice

) {

  const {

    signal,

    entry,

    stopLoss,

    takeProfit

  } = lock;


  const hitTP =

    signal === "BUY"

      ? currentPrice >=
        takeProfit

      : currentPrice <=
        takeProfit;


  const hitSL =

    signal === "BUY"

      ? currentPrice <=
        stopLoss

      : currentPrice >=
        stopLoss;


  let status =
    "ACTIVE";


  if (
    hitTP
  ) {

    status =
      "TP_HIT";

  }

  else if (
    hitSL
  ) {

    status =
      "SL_HIT";

  }


  const initialRisk =

    Math.abs(

      entry -
      stopLoss

    );


  const signedMove =

    signal === "BUY"

      ? currentPrice -
        entry

      : entry -
        currentPrice;


  return {

    status,

    currentPrice:
      roundPrice(
        currentPrice
      ),

    entry:
      roundPrice(
        entry
      ),

    stopLoss:
      roundPrice(
        stopLoss
      ),

    takeProfit:
      roundPrice(
        takeProfit
      ),

    currentR:

      initialRisk > 0

        ? round(

            signedMove /
            initialRisk,

            2

          )

        : 0

  };

}


/* =========================================================
   COINBASE LIVE TICKER
========================================================= */

async function fetchTicker() {

  const response =
    await fetch(

      `${COINBASE_BASE}/products/${PRODUCT_ID}/ticker`,

      {

        headers: {

          Accept:
            "application/json",

          "User-Agent":
            "MKAYFX-BTC-Sniper/1.0"

        },

        cache:
          "no-store"

      }

    );


  if (
    !response.ok
  ) {

    throw new Error(

      `Coinbase ticker HTTP ${response.status}`

    );

  }


  const data =
    await response.json();


  const currentPrice =
    Number(
      data.price
    );


  const bid =
    Number(
      data.bid
    );


  const ask =
    Number(
      data.ask
    );


  if (

    ![

      currentPrice,

      bid,

      ask

    ]
      .every(
        Number.isFinite
      )

  ) {

    throw new Error(

      "Coinbase ticker returned invalid data."

    );

  }


  return {

    price:
      currentPrice,

    bid,

    ask,

    time:

      data.time ||

      new Date()
        .toISOString()

  };

}


/* =========================================================
   COINBASE CANDLES
========================================================= */

async function fetchCandles(
  granularity
) {

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


  const response =
    await fetch(

      url.toString(),

      {

        headers: {

          Accept:
            "application/json",

          "User-Agent":
            "MKAYFX-BTC-Sniper/1.0"

        },

        cache:
          "no-store"

      }

    );


  if (
    !response.ok
  ) {

    const text =
      await response.text();


    throw new Error(

      `Coinbase candles HTTP ${response.status}: ${text.slice(0, 160)}`

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


  const now =

    Math.floor(

      Date.now() /
      1000

    );


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
          ) || 0

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
          ) &&

        candle.time +
        granularity <=
        now

    )

    .sort(

      (
        a,
        b
      ) =>
        a.time -
        b.time

    );

}


/* =========================================================
   RESAMPLE CANDLES
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

      ) *

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


  const now =

    Math.floor(

      Date.now() /
      1000

    );


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

      bucket +
      targetSeconds >
      now

    ) {

      continue;

    }


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

    ) /
    1000;


  const previousStart =

    todayStart -
    86400;


  const previous =

    candles.filter(

      candle =>

        candle.time >=
          previousStart &&

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

    ) /
    1000;


  /* =====================================================
     ASIA = 00:00 - 08:00 UTC
  ===================================================== */

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
          dayStart &&

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
    latest
      .getUTCDay();


  const daysSinceMonday =

    (
      day +
      6
    ) %
    7;


  const mondayStart =

    Date.UTC(

      latest
        .getUTCFullYear(),

      latest
        .getUTCMonth(),

      latest
        .getUTCDate() -
      daysSinceMonday

    ) /
    1000;


  const first =

    candles.find(

      candle =>
        candle.time >=
        mondayStart

    );


  return (
    first?.open ??
    null
  );

}


/* =========================================================
   SESSION
========================================================= */

function getSession(
  date
) {

  const utcHour =

    date.getUTCHours() +

    date.getUTCMinutes() /
    60;


  const sastHour =

    (
      utcHour +
      2
    ) %
    24;


  let name =
    "OFF_HOURS";


  let label =
    "Off-hours";


  if (

    utcHour >= 0 &&

    utcHour < 7

  ) {

    name =
      "ASIA";


    label =
      "Asian session";

  }


  if (

    utcHour >= 7 &&

    utcHour < 12

  ) {

    name =
      "LONDON";


    label =
      "London session";

  }


  if (

    utcHour >= 12 &&

    utcHour < 16

  ) {

    name =
      "LONDON_NY_OVERLAP";


    label =
      "London / New York overlap";

  }


  if (

    utcHour >= 16 &&

    utcHour < 21

  ) {

    name =
      "NEW_YORK";


    label =
      "New York session";

  }


  return {

    name,

    label,

    utcHour:
      round(
        utcHour,
        2
      ),

    sastHour:
      round(
        sastHour,
        2
      )

  };

}


/* =========================================================
   FIND PIVOTS
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
        j === i
      ) {

        continue;

      }


      if (

        field ===
          "high" &&

        candles[j].high >=
        value

      ) {

        valid =
          false;

        break;

      }


      if (

        field ===
          "low" &&

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
   EQUAL HIGHS / LOWS
========================================================= */

function findEqualLevels(

  values,

  tolerance

) {

  const output =
    [];


  for (

    let i = 0;

    i <
      values.length;

    i++

  ) {

    for (

      let j =
        i + 1;

      j <
        values.length;

      j++

    ) {

      if (

        Math.abs(

          values[i] -
          values[j]

        ) <=
        tolerance

      ) {

        output.push(

          (
            values[i] +
            values[j]
          ) /
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
   PUSH LEVEL
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
   DEDUPE LEVELS
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

          ) <=
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


/* =========================================================
   DEDUPE NUMBERS
========================================================= */

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

          ) <=
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


  const trueRanges =
    [];


  for (

    let i = 1;

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


    trueRanges.push(

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

    trueRanges.slice(

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
      multiplier +

      result *
      (
        1 -
        multiplier
      );

  }


  return result;

}


/* =========================================================
   HELPERS
========================================================= */

function normalizeSymbol(
  value
) {

  const symbol =

    String(
      value ||
      ""
    )

      .trim()

      .toUpperCase()

      .replace(
        "-",
        "/"
      );


  if (
    symbol ===
    "BTCUSD"
  ) {

    return SYMBOL;

  }


  return (
    symbol ||
    SYMBOL
  );

}


function oppositeSide(
  side
) {

  return (

    side === "BUY"

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

    ) /

    values.length

  );

}


function scoreToConfidence(

  score,

  gap,

  signal

) {

  if (
    signal === "WAIT"
  ) {

    return Math.round(

      clamp(

        score *
        0.72 +

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
      0.86 +

      Math.min(
        gap,
        20
      ) *
      0.65,

      50,

      98

    )

  );

}


function envNumber(

  name,

  fallback,

  min,

  max

) {

  const raw =

    Number(

      process.env[
        name
      ]

    );


  const value =

    Number.isFinite(
      raw
    )

      ? raw

      : fallback;


  return clamp(

    value,

    min,

    max

  );

}


function clamp(

  value,

  min,

  max

) {

  return Math.min(

    max,

    Math.max(

      min,

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

    ) /

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

    ) /

    100

  );

}


function nullablePrice(
  value
) {

  return (

    Number.isFinite(
      value
    )

      ? roundPrice(
          value
        )

      : null

  );

}


function dedupe(
  values
) {

  return [

    ...new Set(

      values.filter(
        Boolean
      )

    )

  ];

}


/* =========================================================
   HEADERS
========================================================= */

function setHeaders(
  res
) {

  res.setHeader(

    "Cache-Control",

    "no-store, no-cache, must-revalidate, proxy-revalidate"

  );


  res.setHeader(

    "Pragma",

    "no-cache"

  );


  res.setHeader(

    "Expires",

    "0"

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