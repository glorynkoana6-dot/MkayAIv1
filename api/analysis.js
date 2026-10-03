import {
  envNumber,
  finite,
  round,
  parseUTC,
  sessionFor,
  fetchSeries,
  fetchPrice,
  completed,
  resample,
  snapshot,
  detectRegime,
  simpleTrendPullbackStrategy
} from "./core.js";


import {
  dbEnabled,
  saveSignalRecord,
  memoryCount
} from "./db.js";


/* =========================================================
   MKAYFX SIMPLE TREND ENGINE V14
========================================================= */

const VERSION =
  "14.0";


const ASSETS = {

  "XAU/USD":{
    code:"XAUUSD",
    name:"Gold",
    type:"METAL",
    precision:2,
    trades247:false
  },

  "BTC/USD":{
    code:"BTCUSD",
    name:"Bitcoin",
    type:"CRYPTO",
    precision:2,
    trades247:true
  }

};


const DEFAULT_EQUITY =
  envNumber(
    "DEFAULT_EQUITY_ZAR",
    200,
    1
  );


const RISK_PERCENT =
  envNumber(
    "RISK_PER_TRADE_PCT",
    0.25,
    0.01,
    2
  );


const STOP_ATR =
  envNumber(
    "SIMPLE_STOP_ATR",
    1,
    0.5,
    3
  );


const TARGET_R =
  envNumber(
    "SIMPLE_TARGET_R",
    2,
    1,
    5
  );


const STALE_MS =
  envNumber(
    "STALE_MS",
    15 * 60_000,
    60_000,
    60 * 60_000
  );


/* =========================================================
   HELPERS
========================================================= */

function normalizeSymbol(value) {

  const raw =
    String(
      value ||
      "XAU/USD"
    )
      .trim()
      .toUpperCase()
      .replace(
        /\s+/g,
        ""
      );


  if (
    raw ===
      "XAU/USD" ||
    raw ===
      "XAUUSD" ||
    raw ===
      "GOLD"
  ) {
    return "XAU/USD";
  }


  if (
    raw ===
      "BTC/USD" ||
    raw ===
      "BTCUSD" ||
    raw ===
      "BTC" ||
    raw ===
      "BITCOIN"
  ) {
    return "BTC/USD";
  }


  return null;
}


function bodyOf(req) {

  if (!req.body) {
    return {};
  }


  if (
    typeof req.body ===
    "object"
  ) {
    return req.body;
  }


  try {

    return JSON.parse(
      req.body
    );

  }
  catch {

    return {};

  }
}


function queryValue(
  req,
  key
) {

  const value =
    req.query?.[key];


  return Array.isArray(value)
    ? value[0]
    : value;
}


function marketOpen(
  symbol,
  now = Date.now()
) {

  if (
    symbol ===
    "BTC/USD"
  ) {

    return {
      open:true,
      reason:"24_7_MARKET"
    };

  }


  const date =
    new Date(now);


  const day =
    date.getUTCDay();


  const hour =
    date.getUTCHours();


  if (
    day === 6
  ) {

    return {
      open:false,
      reason:"WEEKEND"
    };

  }


  if (
    day === 0 &&
    hour < 22
  ) {

    return {
      open:false,
      reason:"WEEKEND"
    };

  }


  if (
    day === 5 &&
    hour >= 22
  ) {

    return {
      open:false,
      reason:"WEEKEND"
    };

  }


  return {
    open:true,
    reason:"NORMAL_SESSION"
  };
}


/* =========================================================
   MAIN
========================================================= */

export default async function handler(
  req,
  res
) {

  res.setHeader(
    "Cache-Control",
    "no-store"
  );


  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );


  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );


  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,OPTIONS"
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
    ![
      "GET",
      "POST"
    ].includes(
      req.method
    )
  ) {

    return res
      .status(405)
      .json({
        success:false,
        error:"Use GET or POST."
      });

  }


  try {

    const body =
      bodyOf(req);


    const symbol =
      normalizeSymbol(
        body.symbol ||
        queryValue(
          req,
          "symbol"
        ) ||
        "XAU/USD"
      );


    if (!symbol) {

      return res
        .status(400)
        .json({

          success:false,

          error:
            "Unsupported symbol.",

          supportedSymbols:[
            "XAU/USD",
            "BTC/USD"
          ]

        });

    }


    const asset =
      ASSETS[symbol];


    /* =====================================================
       MARKET DATA

       M5 drives the strategy.

       M15 and H1 are built from the exact same M5 data.
       This is important because the backtest does the same.
    ===================================================== */

    const [
      rawM5,
      rawM1,
      livePriceResult
    ] =
      await Promise.all([

        fetchSeries(
          symbol,
          "5min",
          3000
        ),

        fetchSeries(
          symbol,
          "1min",
          300
        ),

        fetchPrice(
          symbol
        )
          .catch(
            () => null
          )

      ]);


    const m5 =
      completed(
        rawM5,
        5
      );


    const m1 =
      completed(
        rawM1,
        1
      );


    const m15 =
      resample(
        m5,
        15
      );


    const h1 =
      resample(
        m5,
        60
      );


    if (
      m5.length <
        2500 ||
      m15.length <
        210 ||
      h1.length <
        210
    ) {

      throw new Error(
        `Not enough completed ${symbol} data for the V14 strategy.`
      );

    }


    /* =====================================================
       STRATEGY
    ===================================================== */

    const strategy =
      simpleTrendPullbackStrategy({
        m5,
        m15,
        h1
      });


    const lastM5 =
      m5.at(-1);


    const lastM1 =
      m1.at(-1);


    const referencePrice =
      finite(
        livePriceResult
      ) ??
      finite(
        lastM1?.c
      ) ??
      finite(
        lastM5?.c
      );


    if (
      referencePrice ===
      null
    ) {

      throw new Error(
        "Reference price unavailable."
      );

    }


    const m5Atr =
      finite(
        strategy
          .indicators
          ?.m5Atr
      );


    if (
      m5Atr ===
      null ||
      m5Atr <=
        0
    ) {

      throw new Error(
        "M5 ATR unavailable."
      );

    }


    /* =====================================================
       MARKET STATUS
    ===================================================== */

    const schedule =
      marketOpen(
        symbol
      );


    const lastCandleEnd =
      parseUTC(
        lastM5.t
      ) +
      5 *
      60_000;


    const dataAge =
      Math.max(
        0,
        Date.now() -
        lastCandleEnd
      );


    const dataStale =
      dataAge >
      STALE_MS;


    let signal =
      strategy.signal;


    if (
      !schedule.open ||
      dataStale
    ) {

      signal =
        "WAIT";

    }


    /* =====================================================
       TRADE PLAN
    ===================================================== */

    let plan =
      null;


    if (
      signal ===
        "BUY" ||
      signal ===
        "SELL"
    ) {

      const direction =
        signal;


      const sign =
        direction ===
          "BUY"
          ? 1
          : -1;


      const entry =
        referencePrice;


      const riskDistance =
        m5Atr *
        STOP_ATR;


      const stopLoss =
        entry -
        sign *
        riskDistance;


      const takeProfit =
        entry +
        sign *
        riskDistance *
        TARGET_R;


      const takeProfit2 =
        entry +
        sign *
        riskDistance *
        (
          TARGET_R +
          0.5
        );


      plan = {

        entry:
          round(
            entry,
            asset.precision
          ),

        stopLoss:
          round(
            stopLoss,
            asset.precision
          ),

        takeProfit:
          round(
            takeProfit,
            asset.precision
          ),

        takeProfit2:
          round(
            takeProfit2,
            asset.precision
          ),

        riskDistance:
          round(
            riskDistance,
            asset.precision
          ),

        stopAtr:
          STOP_ATR,

        targetR:
          TARGET_R,

        riskReward:
          `1:${TARGET_R}`,

        riskReward2:
          `1:${round(
            TARGET_R +
            0.5,
            1
          )}`

      };

    }


    /* =====================================================
       TIMEFRAMES
    ===================================================== */

    const packet = {

      M1:
        snapshot(
          m1
        ),

      M5:
        snapshot(
          m5
        ),

      M15:
        snapshot(
          m15
        ),

      H1:
        snapshot(
          h1
        )

    };


    const regime =
      detectRegime(
        m5
      );


    /* =====================================================
       ACCOUNT
    ===================================================== */

    const equity =
      Math.max(
        1,
        finite(
          body.equity
        ) ??
        DEFAULT_EQUITY
      );


    const account = {

      equityZAR:
        round(
          equity,
          2
        ),

      riskPercent:
        RISK_PERCENT,

      maxRiskZAR:
        round(
          equity *
          RISK_PERCENT /
          100,
          2
        )

    };


    /* =====================================================
       MEMORY
    ===================================================== */

    const memory =
      dbEnabled()
        ? await memoryCount(
            symbol
          )
            .catch(
              () => ({
                total:0,
                resolved:0
              })
            )
        : {
            total:0,
            resolved:0
          };


    /* =====================================================
       EDGE SCORE

       This is setup completion, NOT win probability.
    ===================================================== */

    const edgeScore =
      strategy.score;


    const created =
      Date.now();


    const candidateDirection =
      strategy.direction ||
      (
        packet.H1.bias ===
          "BULLISH"
          ? "BUY"
          : packet.H1.bias ===
            "BEARISH"
            ? "SELL"
            : null
      );


    const signalId =
      `MKV14-${asset.code}-${created}-${signal}`;


    const reasons = [
      ...strategy.reasons
    ];


    if (
      !schedule.open
    ) {

      reasons.push(
        `${asset.name} market is closed.`
      );

    }


    if (
      dataStale
    ) {

      reasons.push(
        `Market data is stale: ${round(
          dataAge /
          60000,
          1
        )} minutes old.`
      );

    }


    if (
      signal ===
      "WAIT"
    ) {

      reasons.push(
        "No valid trend-pullback entry. Waiting is part of the strategy."
      );

    }


    const response = {

      success:true,

      model:
        "MKAYFX SIMPLE TREND ENGINE V14",

      version:
        VERSION,

      supportedSymbols:[
        "XAU/USD",
        "BTC/USD"
      ],

      symbol,

      asset:{

        code:
          asset.code,

        name:
          asset.name,

        type:
          asset.type,

        trades247:
          asset.trades247

      },

      signalId,

      signal,

      candidateDirection,

      tradeQualified:
        signal ===
          "BUY" ||
        signal ===
          "SELL",

      locked:false,

      setupType:
        "TREND_PULLBACK",

      createdAt:
        new Date(
          created
        ).toISOString(),

      session:
        sessionFor(
          parseUTC(
            lastM5.t
          )
        ),

      edgeScore,

      edgeType:
        "SETUP_COMPLETION_SCORE_NOT_WIN_PROBABILITY",

      currentPrice:
        round(
          referencePrice,
          asset.precision
        ),

      completedCandlePrice:
        round(
          lastM5.c,
          asset.precision
        ),

      entry:
        plan?.entry ??
        round(
          referencePrice,
          asset.precision
        ),

      stopLoss:
        plan?.stopLoss ??
        null,

      takeProfit:
        plan?.takeProfit ??
        null,

      takeProfit2:
        plan?.takeProfit2 ??
        null,

      riskReward:
        plan?.riskReward ??
        null,

      riskReward2:
        plan?.riskReward2 ??
        null,

      riskDistance:
        plan?.riskDistance ??
        null,

      marketRegime:
        regime,

      regimePolicy:{

        profile:
          "SIMPLE_TREND_PULLBACK",

        hardBlocked:
          false

      },

      ensemble:{

        signedScore:
          signal ===
            "BUY"
            ? edgeScore
            : signal ===
              "SELL"
              ? -edgeScore
              : 0,

        direction:
          candidateDirection,

        components:{
          strategy:
            edgeScore
        },

        adaptiveReliability:{}

      },

      edgeDecision:{

        signal,

        candidateDirection,

        qualified:
          signal ===
            "BUY" ||
          signal ===
            "SELL",

        edgeScore,

        strategy:
          strategy.setup,

        checks:
          strategy.checks,

        buyChecks:
          strategy.buyChecks,

        sellChecks:
          strategy.sellChecks,

        failedGates:
          Object.entries(
            strategy.checks ||
            {}
          )
            .filter(
              ([, passed]) =>
                !passed
            )
            .map(
              ([name]) =>
                name
            )

      },

      historicalEdge:{

        strategy:
          "TREND_PULLBACK_V14",

        matches:
          memory.resolved ||
          0,

        expectancyR:null,

        netExpectancyR:null,

        targetHitRate:null,

        averageSimilarity:null,

        note:
          "Use the Research screen for V14 historical performance."

      },

      crossMarket:{

        available:false,

        direction:"NEUTRAL",

        score:0,

        note:
          "Cross-market scoring is not used by V14."

      },

      macroRisk:{

        available:false,

        blocked:false,

        upcoming:[],

        note:
          "Macro data is not part of the V14 entry rule."

      },

      marketStatus:{

        open:
          schedule.open,

        reason:
          schedule.reason,

        dataStale,

        lastCompletedCandle:
          lastM5.t,

        dataAgeMinutes:
          round(
            dataAge /
            60000,
            1
          ),

        priceSource:
          livePriceResult !==
            null
            ? "LIVE_PRICE_ENDPOINT"
            : "LAST_COMPLETED_CANDLE"

      },

      execution:{

        state:
          signal ===
            "BUY" ||
          signal ===
            "SELL"
            ? "QUALIFIED_NOT_ENTERED"
            : "WAITING_FOR_SETUP",

        referenceAtr:
          round(
            m5Atr,
            5
          ),

        stopAtr:
          STOP_ATR,

        targetR:
          TARGET_R,

        rule:
          "Manual execution only."

      },

      timeframeBias:{

        M1:
          packet.M1.bias,

        M5:
          packet.M5.bias,

        M15:
          packet.M15.bias,

        H1:
          packet.H1.bias,

        agreement:{

          strategy:
            "H1_M15_M5_TREND_PULLBACK"

        }

      },

      structure:{

        M1:
          packet.M1.structure,

        M5:
          packet.M5.structure,

        M15:
          packet.M15.structure,

        H1:
          packet.H1.structure

      },

      marketContext:{

        strategy:
          "TREND_PULLBACK",

        indicators:
          strategy.indicators,

        checks:
          strategy.checks

      },

      goldContext:null,

      technical:{

        componentScores:{
          strategy:
            edgeScore
        },

        allComponents:{
          strategy:
            edgeScore
        },

        strategy,

        reasons

      },

      account,

      memory:{

        enabled:
          dbEnabled(),

        totalStates:
          memory.total ||
          0,

        resolvedStates:
          memory.resolved ||
          0,

        sourceUsed:
          "V14_STRATEGY_MEMORY",

        currentMatches:0

      },

      chart:
        m1
          .slice(-180)
          .map(
            candle => ({

              t:
                candle.t,

              o:
                round(
                  candle.o,
                  asset.precision
                ),

              h:
                round(
                  candle.h,
                  asset.precision
                ),

              l:
                round(
                  candle.l,
                  asset.precision
                ),

              c:
                round(
                  candle.c,
                  asset.precision
                )

            })
          ),

      dataQuality:{

        completedM1:
          m1.length,

        completedM5:
          m5.length,

        completedM15:
          m15.length,

        completedH1:
          h1.length,

        staleMilliseconds:
          dataAge,

        staleMinutes:
          round(
            dataAge /
            60000,
            2
          ),

        livePriceAvailable:
          livePriceResult !==
          null

      }

    };


    if (
      dbEnabled()
    ) {

      await saveSignalRecord(
        response
      )
        .catch(
          error =>
            console.error(
              "Save signal:",
              error.message
            )
        );

    }


    return res
      .status(200)
      .json(
        response
      );

  }
  catch(error) {

    console.error(
      "MKAYFX V14:",
      error
    );


    return res
      .status(500)
      .json({

        success:false,

        model:
          "MKAYFX SIMPLE TREND ENGINE V14",

        version:
          VERSION,

        error:
          error?.message ||
          "Analysis failed.",

        supportedSymbols:[
          "XAU/USD",
          "BTC/USD"
        ]

      });

  }
}