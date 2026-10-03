import {
  SYMBOL,
  envNumber,
  finite,
  round,
  clamp,
  mean,
  parseUTC,
  sessionFor,
  fetchSeries,
  fetchSeriesSafe,
  fetchPrice,
  completed,
  resample,
  snapshot,
  goldContext,
  detectRegime,
  scoreTechnical,
  breakoutScore,
  meanReversionScore,
  seriesDirection,
  crossMarketScore,
  basicComponentScores,
  buildFeatureState,
  similarityScore,
  buildFuturePath,
  optimizeRiskReward,
  historicalStats,
  adaptiveReliability,
  ensembleScore,
  inferSetup
} from "../lib/core.js";


import {
  dbEnabled,
  upsertMarketState,
  loadResolvedStates,
  saveSignalRecord,
  memoryCount
} from "../lib/db.js";


/* =========================================================
   SETTINGS
========================================================= */

const M1_OUTPUT =
  envNumber(
    "M1_OUTPUT",
    5000,
    1000,
    5000
  );


const H1_OUTPUT =
  envNumber(
    "H1_OUTPUT",
    300,
    100,
    1000
  );


const STALE_MS =
  envNumber(
    "STALE_MS",
    10 *
      60_000,
    60_000
  );


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


const MIN_EDGE =
  envNumber(
    "MIN_EDGE_SCORE",
    68,
    40,
    95
  );


const WATCH_EDGE =
  envNumber(
    "WATCH_EDGE_SCORE",
    55,
    25,
    90
  );


const MIN_TECHNICAL =
  envNumber(
    "MIN_TECHNICAL_SCORE",
    20,
    0,
    100
  );


const MIN_AGREEMENT =
  envNumber(
    "MIN_MODEL_AGREEMENT",
    0.60,
    0.4,
    1
  );


const MIN_MATCHES =
  Math.round(
    envNumber(
      "MIN_HISTORICAL_MATCHES",
      18,
      5,
      200
    )
  );


const MIN_EXPECTANCY =
  envNumber(
    "MIN_EXPECTANCY_R",
    0.05,
    -1,
    3
  );


const TOP_K =
  Math.round(
    envNumber(
      "HISTORICAL_TOP_K",
      100,
      20,
      250
    )
  );


const MIN_SIM =
  envNumber(
    "HISTORICAL_MIN_SIMILARITY",
    50,
    20,
    95
  );


const FORWARD_BARS =
  Math.round(
    envNumber(
      "HISTORICAL_FORWARD_BARS",
      12,
      6,
      36
    )
  );


const FRESH_MINUTES =
  envNumber(
    "SIGNAL_FRESH_MINUTES",
    3,
    1,
    15
  );


const EXPIRE_MINUTES =
  envNumber(
    "SIGNAL_EXPIRE_MINUTES",
    10,
    3,
    60
  );


const MAX_CHASE_ATR =
  envNumber(
    "MAX_CHASE_ATR",
    0.35,
    0.1,
    1.5
  );


/* =========================================================
   HELPERS
========================================================= */

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


function send(
  res,
  status,
  body
) {

  return res
    .status(status)
    .json(body);
}


/* =========================================================
   CROSS MARKET
========================================================= */

async function crossContext() {

  const symbols = {
    dxy:
      process.env
        .DXY_SYMBOL ||
      "DXY",

    us10y:
      process.env
        .US10Y_SYMBOL ||
      "US10Y",

    us2y:
      process.env
        .US2Y_SYMBOL ||
      "US2Y",

    eurusd:
      "EUR/USD",

    usdjpy:
      "USD/JPY"
  };


  const [
    dxy,
    us10y,
    us2y,
    eurusd,
    usdjpy
  ] =
    await Promise.all([

      fetchSeriesSafe(
        symbols.dxy,
        "5min",
        90
      ),

      fetchSeriesSafe(
        symbols.us10y,
        "5min",
        90
      ),

      fetchSeriesSafe(
        symbols.us2y,
        "5min",
        90
      ),

      fetchSeriesSafe(
        symbols.eurusd,
        "5min",
        90
      ),

      fetchSeriesSafe(
        symbols.usdjpy,
        "5min",
        90
      )

    ]);


  const detail = {
    dxy:
      dxy.length
        ? seriesDirection(
            dxy
          )
        : null,

    us10y:
      us10y.length
        ? seriesDirection(
            us10y
          )
        : null,

    us2y:
      us2y.length
        ? seriesDirection(
            us2y
          )
        : null,

    eurusd:
      eurusd.length
        ? seriesDirection(
            eurusd
          )
        : null,

    usdjpy:
      usdjpy.length
        ? seriesDirection(
            usdjpy
          )
        : null
  };


  return {
    ...crossMarketScore(
      detail
    ),

    detail,

    symbols
  };
}


/* =========================================================
   OPTIONAL MACRO CALENDAR
========================================================= */

async function macroRisk() {

  const key =
    process.env
      .TRADING_ECONOMICS_KEY;


  if (!key) {

    return {
      available:
        false,

      blocked:
        false,

      reason:
        "TRADING_ECONOMICS_KEY_NOT_SET",

      upcoming:
        []
    };

  }


  try {

    const url =
      new URL(
        "https://api.tradingeconomics.com/calendar/country/united%20states"
      );


    url.searchParams.set(
      "c",
      key
    );


    url.searchParams.set(
      "importance",
      "3"
    );


    url.searchParams.set(
      "f",
      "json"
    );


    const controller =
      new AbortController();


    const timeout =
      setTimeout(
        () =>
          controller.abort(),
        10000
      );


    const response =
      await fetch(
        url,
        {
          cache:
            "no-store",

          signal:
            controller.signal
        }
      );


    clearTimeout(
      timeout
    );


    if (
      !response.ok
    ) {

      throw new Error(
        `Macro HTTP ${response.status}`
      );

    }


    const raw =
      await response.json();


    const now =
      Date.now();


    const before =
      envNumber(
        "MACRO_BLOCK_MINUTES_BEFORE",
        15,
        0,
        120
      ) *
      60000;


    const after =
      envNumber(
        "MACRO_BLOCK_MINUTES_AFTER",
        5,
        0,
        120
      ) *
      60000;


    const upcoming =
      (
        Array.isArray(raw)
          ? raw
          : []
      )
      .map(
        x => ({
          event:
            x.Event ||
            x.Category ||
            "US event",

          category:
            x.Category ||
            null,

          date:
            x.Date ||
            null,

          importance:
            Number(
              x.Importance ||
              0
            ),

          actual:
            x.Actual ??
            null,

          forecast:
            x.Forecast ??
            null,

          previous:
            x.Previous ??
            null
        })
      )
      .filter(
        x =>
          x.date &&
          Number.isFinite(
            Date.parse(
              x.date
            )
          )
      )
      .filter(
        x =>
          Math.abs(
            Date.parse(
              x.date
            ) -
            now
          ) <=
          6 *
          60 *
          60 *
          1000
      )
      .sort(
        (a, b) =>
          Date.parse(
            a.date
          ) -
          Date.parse(
            b.date
          )
      );


    const blocking =
      upcoming.find(
        event => {

          const difference =
            Date.parse(
              event.date
            ) -
            now;

          return (
            event.importance >= 3 &&
            difference <=
              before &&
            difference >=
              -after
          );

        }
      );


    return {
      available:
        true,

      blocked:
        Boolean(
          blocking
        ),

      blockReason:
        blocking
          ? `${blocking.event} high-impact window`
          : null,

      blockingEvent:
        blocking ||
        null,

      upcoming:
        upcoming.slice(
          0,
          8
        )
    };

  }
  catch (error) {

    return {
      available:
        false,

      blocked:
        false,

      reason:
        error?.message ||
        "MACRO_UNAVAILABLE",

      upcoming:
        []
    };

  }
}


/* =========================================================
   LOCAL HISTORICAL SIMILARITY
========================================================= */

function localMatches(
  candles,
  currentState
) {

  const results = [];


  const first =
    Math.max(
      70,
      candles.length -
        850
    );


  const last =
    candles.length -
    1 -
    FORWARD_BARS;


  for (
    let i =
      first;

    i <=
      last;

    i++
  ) {

    const slice =
      candles.slice(
        Math.max(
          0,
          i -
            240
        ),
        i + 1
      );


    if (
      slice.length <
      70
    ) {
      continue;
    }


    const regime =
      detectRegime(
        slice
      );


    const components =
      basicComponentScores(
        slice
      );


    const state =
      buildFeatureState(
        slice,
        components,
        regime
      );


    if (!state) {
      continue;
    }


    const similarity =
      similarityScore(
        currentState.vector,
        state.vector,
        currentState.session,
        state.session
      );


    if (
      similarity <
      MIN_SIM
    ) {
      continue;
    }


    const futurePath =
      buildFuturePath(
        candles,
        i,
        FORWARD_BARS
      );


    if (!futurePath) {
      continue;
    }


    results.push({
      candle_time:
        state.candleTime,

      session:
        state.session,

      regime:
        state.regime,

      vector:
        state.vector,

      features:
        state.features,

      future_path:
        futurePath,

      similarity,

      source:
        "FETCHED_HISTORY"
    });

  }


  return results
    .sort(
      (a, b) =>
        b.similarity -
        a.similarity
    )
    .slice(
      0,
      TOP_K
    );
}


/* =========================================================
   PERSISTENT MEMORY MATCHES
========================================================= */

function persistentMatches(
  rows,
  currentState
) {

  return rows
    .map(
      row => ({
        ...row,

        similarity:
          similarityScore(
            currentState.vector,
            row.vector,
            currentState.session,
            row.session
          ),

        source:
          "PERSISTENT_MEMORY"
      })
    )
    .filter(
      row =>
        row.similarity >=
          MIN_SIM &&
        Array.isArray(
          row.future_path
        )
    )
    .sort(
      (a, b) =>
        b.similarity -
        a.similarity
    )
    .slice(
      0,
      TOP_K
    );
}


/* =========================================================
   AGREEMENT
========================================================= */

function modelAgreement(
  components,
  direction
) {

  const sign =
    direction ===
      "BUY"
      ? 1
      : -1;

  let total = 0;
  let aligned = 0;

  for (
    const score of
    Object.values(
      components
    )
  ) {

    const n =
      finite(score) ??
      0;

    const magnitude =
      Math.abs(n);

    if (
      magnitude <
      5
    ) {
      continue;
    }

    total +=
      magnitude;

    if (
      Math.sign(n) ===
      sign
    ) {
      aligned +=
        magnitude;
    }

  }

  return total >
    0
    ? aligned /
      total
    : 0.5;
}


/* =========================================================
   EDGE DECISION
========================================================= */

function regimeAlignment(
  regime,
  direction
) {

  if (
    regime ===
    "QUIET_CHOP"
  ) {
    return 20;
  }

  if (
    regime ===
    "RANGE"
  ) {
    return 55;
  }

  if (
    regime ===
    "MIXED"
  ) {
    return 50;
  }

  const bullish =
    regime.startsWith(
      "BULLISH"
    );

  return (
    bullish &&
    direction ===
      "BUY"
  ) ||
  (
    !bullish &&
    direction ===
      "SELL"
  )
    ? 90
    : 25;
}


function buildDecision({
  ensemble,
  agreement,
  historical,
  regime,
  cross,
  macro
}) {

  const direction =
    ensemble >= 0
      ? "BUY"
      : "SELL";


  const technical =
    Math.abs(
      ensemble
    );


  const sampleScore =
    clamp(
      historical.matches /
      MIN_MATCHES *
      100,
      0,
      100
    );


  const expectancyScore =
    clamp(
      50 +
      (
        historical
          .expectancyR ??
        -1
      ) *
        55,
      0,
      100
    );


  const historicalScore =
    clamp(
      (
        historical
          .targetHitRate ??
        0
      ) *
        0.36 +
      (
        historical
          .averageSimilarity ??
        0
      ) *
        0.24 +
      sampleScore *
        0.20 +
      expectancyScore *
        0.20,
      0,
      100
    );


  const crossAlignment =
    !cross.available
      ? 50
      : cross.direction ===
        "NEUTRAL"
        ? 50
        : cross.direction ===
          direction
          ? 85
          : 25;


  const edgeScore =
    clamp(
      technical *
        0.30 +
      agreement *
        100 *
        0.16 +
      historicalScore *
        0.29 +
      regimeAlignment(
        regime.type,
        direction
      ) *
        0.12 +
      crossAlignment *
        0.06 +
      (
        regime.confidence ??
        50
      ) *
        0.07,
      0,
      100
    );


  const gates = {
    technicalStrength:
      technical >=
      MIN_TECHNICAL,

    modelAgreement:
      agreement >=
      MIN_AGREEMENT,

    historicalSample:
      historical.matches >=
      MIN_MATCHES,

    historicalExpectancy:
      (
        historical
          .expectancyR ??
        -99
      ) >=
      MIN_EXPECTANCY,

    regimeNotQuietChop:
      regime.type !==
      "QUIET_CHOP",

    macroWindowClear:
      !macro.blocked,

    edgeScore:
      edgeScore >=
      MIN_EDGE
  };


  const failed =
    Object.entries(
      gates
    )
      .filter(
        (
          [
            ,
            passed
          ]
        ) =>
          !passed
      )
      .map(
        (
          [
            key
          ]
        ) =>
          key
      );


  const qualified =
    failed.length ===
    0;


  let signal =
    "WAIT";


  if (
    qualified
  ) {

    signal =
      direction;

  }
  else if (
    edgeScore >=
      WATCH_EDGE
  ) {

    signal =
      "WATCH";

  }


  return {
    signal,

    candidateDirection:
      direction,

    qualified,

    edgeScore:
      round(
        edgeScore,
        1
      ),

    technicalStrength:
      round(
        technical,
        1
      ),

    modelAgreement:
      round(
        agreement,
        3
      ),

    historicalScore:
      round(
        historicalScore,
        1
      ),

    crossAlignment,

    gates,

    failedGates:
      failed,

    thresholds: {
      minEdgeScore:
        MIN_EDGE,

      watchEdgeScore:
        WATCH_EDGE,

      minTechnicalScore:
        MIN_TECHNICAL,

      minModelAgreement:
        MIN_AGREEMENT,

      minHistoricalMatches:
        MIN_MATCHES,

      minExpectancyR:
        MIN_EXPECTANCY
    }
  };
}


/* =========================================================
   TRADE PLAN
========================================================= */

function createTradePlan(
  direction,
  entry,
  packet,
  m5Atr,
  optimized
) {

  const stopAtr =
    finite(
      optimized
        ?.stopAtr
    ) ??
    1;


  const targetR =
    finite(
      optimized
        ?.targetR
    ) ??
    1.2;


  let risk =
    m5Atr *
    stopAtr;


  const swingLow =
    finite(
      packet.M1
        .ict
        .lastSwingLow
    );


  const swingHigh =
    finite(
      packet.M1
        .ict
        .lastSwingHigh
    );


  if (
    direction ===
      "BUY" &&
    swingLow !==
      null &&
    swingLow <
      entry
  ) {

    const swingRisk =
      entry -
      swingLow +
      m5Atr *
        0.08;


    if (
      swingRisk >=
        risk *
        0.55 &&
      swingRisk <=
        risk *
        1.35
    ) {

      risk =
        swingRisk;

    }

  }


  if (
    direction ===
      "SELL" &&
    swingHigh !==
      null &&
    swingHigh >
      entry
  ) {

    const swingRisk =
      swingHigh -
      entry +
      m5Atr *
        0.08;


    if (
      swingRisk >=
        risk *
        0.55 &&
      swingRisk <=
        risk *
        1.35
    ) {

      risk =
        swingRisk;

    }

  }


  risk =
    clamp(
      risk,
      m5Atr *
        0.55,
      m5Atr *
        1.65
    );


  const sign =
    direction ===
      "BUY"
      ? 1
      : -1;


  const tp2R =
    clamp(
      Math.max(
        targetR +
          0.45,
        targetR *
          1.35
      ),
      targetR +
        0.25,
      3.5
    );


  return {
    direction,

    entry:
      round(
        entry,
        2
      ),

    stopLoss:
      round(
        entry -
        sign *
          risk,
        2
      ),

    takeProfit:
      round(
        entry +
        sign *
          risk *
          targetR,
        2
      ),

    takeProfit2:
      round(
        entry +
        sign *
          risk *
          tp2R,
        2
      ),

    riskDistance:
      round(
        risk,
        2
      ),

    stopAtr:
      round(
        risk /
        m5Atr,
        2
      ),

    targetR:
      round(
        targetR,
        2
      ),

    targetR2:
      round(
        tp2R,
        2
      ),

    riskReward:
      `1:${round(
        targetR,
        2
      )}`,

    riskReward2:
      `1:${round(
        tp2R,
        2
      )}`
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

    return send(
      res,
      405,
      {
        success:
          false,

        error:
          "Use GET or POST."
      }
    );

  }


  try {

    const body =
      bodyOf(req);


    const [
      rawM1,
      rawH1,
      livePrice,
      cross,
      macro
    ] =
      await Promise.all([

        fetchSeries(
          SYMBOL,
          "1min",
          M1_OUTPUT
        ),

        fetchSeries(
          SYMBOL,
          "1h",
          H1_OUTPUT
        ),

        fetchPrice(
          SYMBOL
        ),

        crossContext(),

        macroRisk()

      ]);


    const m1 =
      completed(
        rawM1,
        1
      );


    const h1 =
      completed(
        rawH1,
        60
      );


    const m5 =
      resample(
        m1,
        5
      );


    const m15 =
      resample(
        m1,
        15
      );


    if (
      m1.length <
        500 ||
      m5.length <
        90 ||
      m15.length <
        45 ||
      h1.length <
        50
    ) {

      throw new Error(
        "Not enough completed XAU/USD data."
      );

    }


    const lastM1 =
      m1.at(-1);


    const dataAge =
      Date.now() -
      (
        parseUTC(
          lastM1.t
        ) +
        60000
      );


    if (
      dataAge >
      STALE_MS
    ) {

      throw new Error(
        "Gold data is stale."
      );

    }


    const packet = {
      lastM1,

      session:
        sessionFor(
          parseUTC(
            lastM1.t
          )
        ),

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


    packet.gold =
      goldContext(
        packet,
        m1
      );


    const regime =
      detectRegime(
        m5
      );


    const technical =
      scoreTechnical(
        packet
      );


    const components = {
      ...technical,

      breakout:
        breakoutScore(
          m5
        ),

      meanReversion:
        meanReversionScore(
          m5
        ),

      cross:
        cross.score ||
        0
    };


    const currentState =
      buildFeatureState(
        m5,
        components,
        regime
      );


    if (!currentState) {

      throw new Error(
        "Could not create market fingerprint."
      );

    }


    currentState.symbol =
      SYMBOL;


    if (
      dbEnabled()
    ) {

      await upsertMarketState(
        currentState
      )
      .catch(
        error =>
          console.error(
            "Memory write:",
            error.message
          )
      );

    }


    let matches = [];

    let memorySource =
      "FETCHED_HISTORY";


    if (
      dbEnabled()
    ) {

      const rows =
        await loadResolvedStates({
          regime:
            regime.type,

          limit:
            2000
        })
        .catch(
          () => []
        );


      matches =
        persistentMatches(
          rows,
          currentState
        );


      if (
        matches.length >=
        MIN_MATCHES
      ) {

        memorySource =
          "PERSISTENT_MEMORY";

      }

    }


    if (
      matches.length <
      MIN_MATCHES
    ) {

      matches =
        localMatches(
          m5,
          currentState
        );


      memorySource =
        "FETCHED_HISTORY";

    }


    const reliability =
      adaptiveReliability(
        matches
      );


    const ensemble =
      ensembleScore(
        components,
        regime.type,
        reliability
      );


    const direction =
      ensemble >= 0
        ? "BUY"
        : "SELL";


    const optimized =
      optimizeRiskReward(
        matches,
        direction
      ) || {
        stopAtr:
          1,

        targetR:
          1.2,

        expectancy:
          null,

        winRate:
          null,

        sample:
          0
      };


    const historical =
      historicalStats(
        matches,
        direction,
        optimized.stopAtr,
        optimized.targetR
      );


    historical.averageSimilarity =
      round(
        mean(
          matches.map(
            x =>
              x.similarity
          )
        ),
        1
      );


    historical.source =
      memorySource;


    historical.optimizedRisk =
      optimized;


    historical.costModel = {
      estimatedCostAtr:
        envNumber(
          "ESTIMATED_COST_ATR",
          0.03,
          0,
          0.5
        ),

      estimatedCostR:
        round(
          envNumber(
            "ESTIMATED_COST_ATR",
            0.03,
            0,
            0.5
          ) /
          Math.max(
            optimized.stopAtr,
            0.01
          ),
          3
        )
    };


    const agreement =
      modelAgreement(
        components,
        direction
      );


    const decision =
      buildDecision({
        ensemble,
        agreement,
        historical,
        regime,
        cross,
        macro
      });


    const setupType =
      inferSetup(
        packet,
        regime,
        components,
        decision
          .candidateDirection
      );


    const m5Atr =
      finite(
        packet.M5
          .indicators
          .atr14
      );


    if (
      m5Atr === null ||
      m5Atr <= 0
    ) {

      throw new Error(
        "M5 ATR unavailable."
      );

    }


    const plan =
      decision.qualified
        ? createTradePlan(
            direction,
            livePrice,
            packet,
            m5Atr,
            optimized
          )
        : null;


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


    const created =
      Date.now();


    const signalId =
      `MKV11-${created}-${direction}`;


    const memory =
      dbEnabled()
        ? await memoryCount()
            .catch(
              () => ({
                total:
                  0,

                resolved:
                  0
              })
            )
        : {
            total:
              0,

            resolved:
              0
          };


    const response = {
      success:
        true,

      model:
        "MKAYFX GOLD QUANT EDGE V11",

      signalId,

      symbol:
        SYMBOL,

      signal:
        decision.signal,

      candidateDirection:
        direction,

      tradeQualified:
        decision.qualified,

      locked:
        false,

      setupType,

      createdAt:
        new Date(
          created
        ).toISOString(),

      session:
        packet.session,

      edgeScore:
        decision.edgeScore,

      edgeType:
        "EDGE_SCORE_NOT_GUARANTEED_PROBABILITY",

      entry:
        plan?.entry ??
        round(
          livePrice,
          2
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

      ensemble: {
        signedScore:
          round(
            ensemble,
            1
          ),

        components,

        adaptiveReliability:
          reliability
      },

      edgeDecision:
        decision,

      historicalEdge:
        historical,

      crossMarket:
        cross,

      macroRisk:
        macro,

      execution: {
        state:
          decision.qualified
            ? "QUALIFIED_NOT_ENTERED"
            : decision.signal,

        referenceAtr:
          round(
            m5Atr,
            5
          ),

        maxChaseAtr:
          MAX_CHASE_ATR,

        freshUntil:
          new Date(
            created +
            FRESH_MINUTES *
            60000
          ).toISOString(),

        expiresAt:
          new Date(
            created +
            EXPIRE_MINUTES *
            60000
          ).toISOString(),

        rule:
          "Manual execution only."
      },

      timeframeBias: {
        M1:
          packet.M1.bias,

        M5:
          packet.M5.bias,

        M15:
          packet.M15.bias,

        H1:
          packet.H1.bias
      },

      structure: {
        M1:
          packet.M1.structure,

        M1_BOS:
          packet.M1
            .ict
            .bos,

        M1_CHOCH:
          packet.M1
            .ict
            .choch,

        M5:
          packet.M5.structure,

        M5_BOS:
          packet.M5
            .ict
            .bos,

        M15:
          packet.M15.structure
      },

      goldContext:
        packet.gold,

      technical: {
        componentScores:
          technical,

        reasons: [
          `Regime ${regime.type} (${regime.confidence}% confidence).`,

          `H1 ${packet.H1.bias}, M15 ${packet.M15.bias}, M5 ${packet.M5.bias}.`,

          `M1 structure ${packet.M1.structure}, ${packet.M1.ict.bos}, ${packet.M1.ict.choch}.`,

          ...packet.gold
            .signals,

          cross.available
            ? `Cross-market ${cross.direction} (${cross.score}).`
            : "Cross-market feeds unavailable.",

          historical.matches
            ? `${historical.matches} similar states, ${historical.expectancyR}R expectancy.`
            : "Historical sample unavailable.",

          macro.blocked
            ? `Macro block: ${macro.blockReason}.`
            : "No active high-impact macro block."
        ]
      },

      account,

      memory: {
        enabled:
          dbEnabled(),

        totalStates:
          memory.total,

        resolvedStates:
          memory.resolved,

        sourceUsed:
          memorySource
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
                  2
                ),

              h:
                round(
                  candle.h,
                  2
                ),

              l:
                round(
                  candle.l,
                  2
                ),

              c:
                round(
                  candle.c,
                  2
                )
            })
          ),

      dataQuality: {
        completedM1:
          m1.length,

        completedM5:
          m5.length,

        completedM15:
          m15.length,

        completedH1:
          h1.length,

        staleMilliseconds:
          Math.max(
            0,
            dataAge
          )
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


    return send(
      res,
      200,
      response
    );

  }
  catch (error) {

    console.error(
      "MKAYFX V11:",
      error
    );


    return send(
      res,
      500,
      {
        success:
          false,

        error:
          error?.message ||
          "Analysis failed."
      }
    );

  }
}