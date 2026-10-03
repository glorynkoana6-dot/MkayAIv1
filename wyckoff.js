/* =========================================================
   MKAYFX WYCKOFF ENGINE V2
   Vercel Serverless API

   Endpoint:
   /api/wyckoff?symbol=XAU/USD&tf=5m

   REQUIRED VERCEL ENV:
   TWELVE_DATA_API_KEY

   PURPOSE
   -------
   - Wyckoff campaign detection
   - Accumulation / Distribution
   - Reaccumulation / Redistribution
   - Phase A/B/C/D/E
   - SC / BC
   - AR
   - ST
   - Spring / UTAD
   - Test / C-Test
   - SOS / SOW
   - LPS / LPSY
   - Multi-timeframe selection
   - Entry / SL / TP1 / TP2
========================================================= */

const BASE_URL = "https://api.twelvedata.com";

const TF_MAP = {
  "1m": "1min",
  "3m": "3min",
  "5m": "5min",
  "15m": "15min",
  "30m": "30min",
  "1h": "1h",
  "2h": "2h",
  "4h": "4h",
  "1D": "1day"
};

const TF_CHAIN = {
  "1m": ["1m", "5m", "15m", "1h"],
  "3m": ["3m", "5m", "15m", "1h"],
  "5m": ["5m", "15m", "1h", "4h"],
  "15m": ["15m", "1h", "4h", "1D"],
  "30m": ["30m", "1h", "4h", "1D"],
  "1h": ["1h", "4h", "1D"],
  "2h": ["2h", "4h", "1D"],
  "4h": ["4h", "1D"],
  "1D": ["1D"]
};


/* =========================================================
   SETTINGS
========================================================= */

const S = {

  atrLen: 14,
  volLen: 50,

  pivotLen: 4,

  trendLen: 80,
  extremeLen: 30,

  climaxVolMult: 1.8,
  climaxSpreadMult: 1.5,

  absorptionMinBars: 3,
  absorptionMaxBars: 8,
  absorptionExtremeATR: 0.50,
  absorptionReboundATR: 0.35,

  minARATR: 2.0,
  maxARBars: 30,

  boundaryTolATR: 0.75,

  stMaxVolRatio: 0.90,
  stMaxSpreadRatio: 0.90,

  minPhaseBBars: 30,
  minPhaseBTests: 2,
  minOppositeTests: 1,
  minTraversals: 2,

  phaseBZoneFrac: 0.25,

  phaseBRangeMinATR: 1.5,
  phaseBRangeMaxATR: 8.0,

  springMinPenATR: 0.15,
  springMaxPenATR: 2.5,

  springCloseMin: 0.55,
  utadCloseMax: 0.45,

  springEffortMax: 1.50,

  testTolATR: 1.25,
  testMaxVolRatio: 0.80,
  testMaxSpreadRatio: 0.80,

  breakATR: 0.15,

  strengthVolMult: 1.15,
  strengthSpreadATR: 1.15,

  sosCloseMin: 0.65,
  sowCloseMax: 0.35,

  phaseDDominanceFrac: 0.65,

  lpsBoundaryATR: 1.5,

  confirmBars: 3,

  minConfidence: 60,
  minValidation: 50,

  rr1: 1.5,
  rr2: 2.5,

  outputSize: 500
};


/* =========================================================
   HELPERS
========================================================= */

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function mean(arr) {

  const a =
    arr.filter(Number.isFinite);

  if (!a.length) {
    return NaN;
  }

  return (
    a.reduce(
      (sum, x) => sum + x,
      0
    ) / a.length
  );

}


function round(v, digits = 2) {

  if (!Number.isFinite(v)) {
    return null;
  }

  return Number(
    v.toFixed(digits)
  );

}


function normalizeSymbol(symbol) {

  const s =
    String(symbol || "XAU/USD")
      .trim()
      .toUpperCase();

  if (s === "XAUUSD") {
    return "XAU/USD";
  }

  if (s === "BTCUSD") {
    return "BTC/USD";
  }

  if (s === "EURUSD") {
    return "EUR/USD";
  }

  if (s === "GBPUSD") {
    return "GBP/USD";
  }

  if (s === "USDJPY") {
    return "USD/JPY";
  }

  return s;

}


/* =========================================================
   MARKET DATA
========================================================= */

async function fetchJSON(url) {

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      18000
    );

  try {

    const response =
      await fetch(
        url,
        {
          signal:
            controller.signal,
          headers: {
            accept:
              "application/json"
          }
        }
      );

    const data =
      await response.json();

    if (
      !response.ok ||
      data?.status === "error"
    ) {

      throw new Error(
        data?.message ||
        `Twelve Data HTTP ${response.status}`
      );

    }

    return data;

  }

  finally {

    clearTimeout(
      timeout
    );

  }

}


async function fetchSeries(
  symbol,
  tf
) {

  const apiKey =
    process.env
      .TWELVE_DATA_API_KEY;

  if (!apiKey) {

    throw new Error(
      "TWELVE_DATA_API_KEY is missing in Vercel Environment Variables."
    );

  }


  const interval =
    TF_MAP[tf] ||
    "5min";


  const url =
    new URL(
      `${BASE_URL}/time_series`
    );


  url.searchParams.set(
    "symbol",
    symbol
  );

  url.searchParams.set(
    "interval",
    interval
  );

  url.searchParams.set(
    "outputsize",
    String(
      S.outputSize
    )
  );

  url.searchParams.set(
    "order",
    "ASC"
  );

  url.searchParams.set(
    "timezone",
    "UTC"
  );

  url.searchParams.set(
    "apikey",
    apiKey
  );


  const data =
    await fetchJSON(
      url.toString()
    );


  if (
    !Array.isArray(
      data.values
    )
  ) {

    throw new Error(
      `No ${tf} candles returned for ${symbol}.`
    );

  }


  return (
    data.values

      .map(
        (x) => ({

          time:
            x.datetime,

          open:
            Number(x.open),

          high:
            Number(x.high),

          low:
            Number(x.low),

          close:
            Number(x.close),

          volume:
            Number(
              x.volume || 0
            )

        })
      )

      .filter(
        (x) =>
          [
            x.open,
            x.high,
            x.low,
            x.close
          ].every(
            Number.isFinite
          )
      )
  );

}


/* =========================================================
   INDICATORS
========================================================= */

function trueRange(
  bars,
  i
) {

  if (i <= 0) {

    return (
      bars[i].high -
      bars[i].low
    );

  }

  return Math.max(

    bars[i].high -
    bars[i].low,

    Math.abs(
      bars[i].high -
      bars[i - 1].close
    ),

    Math.abs(
      bars[i].low -
      bars[i - 1].close
    )

  );

}


function atrAt(
  bars,
  i,
  len = S.atrLen
) {

  if (
    i < len
  ) {
    return NaN;
  }

  const arr = [];

  for (
    let k =
      i - len + 1;

    k <= i;

    k++
  ) {

    arr.push(
      trueRange(
        bars,
        k
      )
    );

  }

  return mean(arr);

}


function avgVolumeAt(
  bars,
  i,
  len = S.volLen
) {

  if (
    i < len - 1
  ) {
    return NaN;
  }

  return mean(
    bars
      .slice(
        i - len + 1,
        i + 1
      )
      .map(
        b => b.volume
      )
  );

}


function avgSpreadAt(
  bars,
  i,
  len = 20
) {

  if (
    i < len - 1
  ) {
    return NaN;
  }

  return mean(
    bars
      .slice(
        i - len + 1,
        i + 1
      )
      .map(
        b =>
          b.high -
          b.low
      )
  );

}


/* =========================================================
   PIVOTS
========================================================= */

function isPivotLow(
  bars,
  i,
  len = S.pivotLen
) {

  if (
    i < len ||
    i + len >= bars.length
  ) {
    return false;
  }

  const p =
    bars[i].low;

  for (
    let k =
      i - len;

    k <= i + len;

    k++
  ) {

    if (
      k !== i &&
      bars[k].low < p
    ) {
      return false;
    }

  }

  return true;

}


function isPivotHigh(
  bars,
  i,
  len = S.pivotLen
) {

  if (
    i < len ||
    i + len >= bars.length
  ) {
    return false;
  }

  const p =
    bars[i].high;

  for (
    let k =
      i - len;

    k <= i + len;

    k++
  ) {

    if (
      k !== i &&
      bars[k].high > p
    ) {
      return false;
    }

  }

  return true;

}


/* =========================================================
   TREND ENGINE
========================================================= */

function priorTrendScore(
  bars,
  i,
  len = S.trendLen
) {

  const start =
    Math.max(
      0,
      i - len
    );


  if (
    i - start < 20
  ) {
    return 0;
  }


  const first =
    bars[start].close;

  const last =
    bars[i].close;


  const atr =
    atrAt(
      bars,
      i
    ) ||
    Math.max(
      bars[i].high -
      bars[i].low,
      0.00001
    );


  let path = 0;


  for (
    let k =
      start + 1;

    k <= i;

    k++
  ) {

    path +=
      Math.abs(
        bars[k].close -
        bars[k - 1].close
      );

  }


  const net =
    last -
    first;


  const efficiency =
    path > 0
      ?
      Math.abs(net) /
      path
      :
      0;


  const displacement =
    clamp(
      net /
      (
        atr *
        Math.sqrt(
          i -
          start +
          1
        )
      ),
      -3,
      3
    ) *
    18;


  const directional =
    (
      net >= 0
        ?
        1
        :
        -1
    ) *
    efficiency *
    35;


  return clamp(
    displacement +
    directional,
    -100,
    100
  );

}


/* =========================================================
   WYCKOFF TEXT
========================================================= */

function phaseName(p) {

  switch (p) {

    case 1:
      return "A - Stopping action";

    case 2:
      return "B - Building cause";

    case 3:
      return "C - Test";

    case 4:
      return "D - Trend within range";

    case 5:
      return "E - Trend out of range";

    default:
      return "None";

  }

}


function structureName(
  direction,
  continuation
) {

  if (
    direction === "BULL"
  ) {

    return continuation
      ?
      "REACCUMULATION"
      :
      "ACCUMULATION";

  }


  if (
    direction === "BEAR"
  ) {

    return continuation
      ?
      "REDISTRIBUTION"
      :
      "DISTRIBUTION";

  }


  return "SEARCHING";

}


function event(
  label,
  index,
  price,
  score,
  bars
) {

  return {

    label,

    index,

    time:
      bars[index]?.time ||
      null,

    price:
      round(
        price,
        4
      ),

    score:
      Number.isFinite(score)
        ?
        score
        :
        null

  };

}


/* =========================================================
   CLIMAX DETECTION
========================================================= */

function findClimaxes(
  bars
) {

  const out = [];

  const start =
    Math.max(
      S.volLen +
      S.extremeLen +
      10,

      bars.length -
      420
    );


  for (
    let i = start;

    i <
    bars.length -
    S.pivotLen;

    i++
  ) {


    const a =
      atrAt(
        bars,
        i
      );


    const avgVol =
      avgVolumeAt(
        bars,
        i
      );


    if (
      !Number.isFinite(a) ||
      !Number.isFinite(avgVol) ||
      a <= 0
    ) {
      continue;
    }


    const candle =
      bars[i];


    const spread =
      Math.max(
        candle.high -
        candle.low,
        0.0000001
      );


    const closePos =
      (
        candle.close -
        candle.low
      ) /
      spread;


    const trend =
      priorTrendScore(
        bars,
        i - 1
      );


    const prior =
      bars.slice(
        Math.max(
          0,
          i -
          S.extremeLen
        ),
        i
      );


    if (
      !prior.length
    ) {
      continue;
    }


    const priorLow =
      Math.min(
        ...prior.map(
          b => b.low
        )
      );


    const priorHigh =
      Math.max(
        ...prior.map(
          b => b.high
        )
      );


    const volHit =
      candle.volume >=
      avgVol *
      S.climaxVolMult;


    const spreadHit =
      spread >=
      a *
      S.climaxSpreadMult;


    const newLow =
      candle.low <=
      priorLow;


    const newHigh =
      candle.high >=
      priorHigh;


    const scScore =

      (
        trend <= -15
          ?
          1
          :
          0
      )

      +

      (
        newLow
          ?
          1
          :
          0
      )

      +

      (
        volHit
          ?
          1
          :
          0
      )

      +

      (
        spreadHit
          ?
          1
          :
          0
      )

      +

      (
        closePos >= 0.35
          ?
          1
          :
          0
      )

      +

      (
        candle.close >
        candle.open
          ?
          1
          :
          0
      );


    const bcScore =

      (
        trend >= 15
          ?
          1
          :
          0
      )

      +

      (
        newHigh
          ?
          1
          :
          0
      )

      +

      (
        volHit
          ?
          1
          :
          0
      )

      +

      (
        spreadHit
          ?
          1
          :
          0
      )

      +

      (
        closePos <= 0.65
          ?
          1
          :
          0
      )

      +

      (
        candle.close <
        candle.open
          ?
          1
          :
          0
      );


    if (
      scScore >= 5
    ) {

      out.push({

        side:
          "ACCUM",

        index:
          i,

        score:
          scScore,

        trend,

        atr:
          a

      });

    }


    if (
      bcScore >= 5
    ) {

      out.push({

        side:
          "DIST",

        index:
          i,

        score:
          bcScore,

        trend,

        atr:
          a

      });

    }

  }


  return out;

}


/* =========================================================
   BUILD CAMPAIGN
========================================================= */

function buildCampaign(
  bars,
  c
) {

  const last =
    bars.length - 1;

  const bullStop =
    c.side === "ACCUM";

  const climax =
    bars[c.index];

  const climaxPrice =
    bullStop
      ?
      climax.low
      :
      climax.high;


  const events = [

    event(
      bullStop
        ?
        "SC"
        :
        "BC",

      c.index,

      climaxPrice,

      c.score,

      bars
    )

  ];


  /* =======================================================
     PHASE A - ABSORPTION
  ======================================================= */

  let absorbed =
    false;


  for (
    let i =
      c.index +
      S.absorptionMinBars;

    i <=
    Math.min(
      c.index +
      S.absorptionMaxBars,
      last
    );

    i++
  ) {


    const recent =
      bars.slice(
        Math.max(
          c.index,
          i - 2
        ),
        i + 1
      );


    const lo =
      Math.min(
        ...recent.map(
          b => b.low
        )
      );


    const hi =
      Math.max(
        ...recent.map(
          b => b.high
        )
      );


    if (
      bullStop
    ) {

      if (

        lo >=
        climaxPrice -
        c.atr *
        S.absorptionExtremeATR

        &&

        bars[i].close >=
        climaxPrice +
        c.atr *
        S.absorptionReboundATR

      ) {

        absorbed =
          true;

        break;

      }

    }

    else {

      if (

        hi <=
        climaxPrice +
        c.atr *
        S.absorptionExtremeATR

        &&

        bars[i].close <=
        climaxPrice -
        c.atr *
        S.absorptionReboundATR

      ) {

        absorbed =
          true;

        break;

      }

    }

  }


  /* =======================================================
     AUTOMATIC RALLY / REACTION
  ======================================================= */

  let arIndex =
    -1;

  let arPrice =
    bullStop
      ?
      -Infinity
      :
      Infinity;


  const arEnd =
    Math.min(
      c.index +
      S.maxARBars,
      last
    );


  for (
    let i =
      c.index + 1;

    i <= arEnd;

    i++
  ) {

    if (
      bullStop &&
      bars[i].high >
      arPrice
    ) {

      arPrice =
        bars[i].high;

      arIndex =
        i;

    }


    if (
      !bullStop &&
      bars[i].low <
      arPrice
    ) {

      arPrice =
        bars[i].low;

      arIndex =
        i;

    }

  }


  const arMoveATR =
    arIndex >= 0
      ?
      Math.abs(
        arPrice -
        climaxPrice
      ) /
      Math.max(
        c.atr,
        0.0000001
      )
      :
      0;


  const arOK =
    arMoveATR >=
    S.minARATR;


  let phase =
    1;


  let rangeLow =
    bullStop
      ?
      climaxPrice
      :
      arPrice;


  let rangeHigh =
    bullStop
      ?
      arPrice
      :
      climaxPrice;


  /* =======================================================
     PHASE B
  ======================================================= */

  let stIndex =
    -1;

  let stPrice =
    NaN;

  let stCount =
    0;

  let oppCount =
    0;

  let traversals =
    0;

  let lastZone =
    0;


  const stVolumes =
    [];

  const stSpreads =
    [];


  if (
    absorbed &&
    arOK &&
    arIndex >= 0
  ) {


    for (
      let i =
        arIndex + 1;

      i <
      last -
      S.pivotLen;

      i++
    ) {


      const a =
        atrAt(
          bars,
          i
        ) ||
        c.atr;


      const height =
        Math.max(
          rangeHigh -
          rangeLow,
          0.0000001
        );


      if (
        bullStop &&
        isPivotLow(
          bars,
          i
        )
      ) {


        const spread =
          bars[i].high -
          bars[i].low;


        const near =

          Math.abs(
            bars[i].low -
            climaxPrice
          ) <=
          a *
          S.boundaryTolATR

          ||

          bars[i].low <=
          rangeLow +
          height *
          S.phaseBZoneFrac;


        const holds =
          bars[i].low >=
          climaxPrice -
          a *
          S.boundaryTolATR;


        const lowerEffort =
          bars[i].volume <=
          climax.volume *
          S.stMaxVolRatio;


        const lowerSpread =
          spread <=
          (
            climax.high -
            climax.low
          ) *
          S.stMaxSpreadRatio;


        if (
          near &&
          holds &&
          lowerEffort &&
          lowerSpread
        ) {

          stCount++;

          stIndex =
            i;

          stPrice =
            bars[i].low;

          stVolumes.push(
            bars[i].volume
          );

          stSpreads.push(
            spread
          );

        }

      }


      if (
        !bullStop &&
        isPivotHigh(
          bars,
          i
        )
      ) {


        const spread =
          bars[i].high -
          bars[i].low;


        const near =

          Math.abs(
            bars[i].high -
            climaxPrice
          ) <=
          a *
          S.boundaryTolATR

          ||

          bars[i].high >=
          rangeHigh -
          height *
          S.phaseBZoneFrac;


        const holds =
          bars[i].high <=
          climaxPrice +
          a *
          S.boundaryTolATR;


        const lowerEffort =
          bars[i].volume <=
          climax.volume *
          S.stMaxVolRatio;


        const lowerSpread =
          spread <=
          (
            climax.high -
            climax.low
          ) *
          S.stMaxSpreadRatio;


        if (
          near &&
          holds &&
          lowerEffort &&
          lowerSpread
        ) {

          stCount++;

          stIndex =
            i;

          stPrice =
            bars[i].high;

          stVolumes.push(
            bars[i].volume
          );

          stSpreads.push(
            spread
          );

        }

      }


      if (
        stCount > 0
      ) {


        if (
          bullStop &&
          isPivotHigh(
            bars,
            i
          ) &&
          bars[i].high >=
          rangeHigh -
          a *
          S.boundaryTolATR
        ) {

          oppCount++;

        }


        if (
          !bullStop &&
          isPivotLow(
            bars,
            i
          ) &&
          bars[i].low <=
          rangeLow +
          a *
          S.boundaryTolATR
        ) {

          oppCount++;

        }

      }


      let zone =
        0;


      if (
        isPivotLow(
          bars,
          i
        ) &&
        bars[i].low <=
        rangeLow +
        height *
        S.phaseBZoneFrac
      ) {

        zone =
          -1;

      }


      if (
        isPivotHigh(
          bars,
          i
        ) &&
        bars[i].high >=
        rangeHigh -
        height *
        S.phaseBZoneFrac
      ) {

        zone =
          1;

      }


      if (
        zone !== 0 &&
        lastZone !== 0 &&
        zone !==
        lastZone
      ) {

        traversals++;

      }


      if (
        zone !== 0
      ) {

        lastZone =
          zone;

      }

    }

  }


  if (
    stIndex >= 0
  ) {

    phase =
      2;


    events.push(

      event(
        "AR",
        arIndex,
        arPrice,
        null,
        bars
      )

    );


    events.push(

      event(
        "ST",
        stIndex,
        stPrice,
        Math.min(
          6,
          3 +
          stCount
        ),
        bars
      )

    );

  }


  const bAge =
    stIndex >= 0
      ?
      last -
      stIndex
      :
      0;


  const rangeATR =
    (
      rangeHigh -
      rangeLow
    ) /
    Math.max(
      c.atr,
      0.0000001
    );


  const matureB =

    phase >= 2

    &&

    stCount >=
    S.minPhaseBTests

    &&

    bAge >=
    S.minPhaseBBars

    &&

    (
      oppCount >=
      S.minOppositeTests

      ||

      traversals >=
      S.minTraversals
    )

    &&

    rangeATR >=
    S.phaseBRangeMinATR *
    0.75

    &&

    rangeATR <=
    S.phaseBRangeMaxATR *
    2;


  /* =======================================================
     PHASE C
  ======================================================= */

  let outcome =
    null;

  let excursion =
    null;

  let test =
    null;


  if (
    matureB
  ) {


    for (
      let i =
        Math.max(
          stIndex + 1,
          c.index + 10
        );

      i <= last;

      i++
    ) {


      const a =
        atrAt(
          bars,
          i
        ) ||
        c.atr;


      const spread =
        Math.max(
          bars[i].high -
          bars[i].low,
          0.0000001
        );


      const closePos =
        (
          bars[i].close -
          bars[i].low
        ) /
        spread;


      const avgVol =
        avgVolumeAt(
          bars,
          i
        ) ||
        bars[i].volume;


      const lowerPen =
        rangeLow -
        bars[i].low;


      const upperPen =
        bars[i].high -
        rangeHigh;


      const spring =

        lowerPen >=
        a *
        S.springMinPenATR

        &&

        lowerPen <=
        a *
        S.springMaxPenATR

        &&

        bars[i].close >
        rangeLow

        &&

        closePos >=
        S.springCloseMin

        &&

        bars[i].volume <=
        avgVol *
        S.springEffortMax;


      const utad =

        upperPen >=
        a *
        S.springMinPenATR

        &&

        upperPen <=
        a *
        S.springMaxPenATR

        &&

        bars[i].close <
        rangeHigh

        &&

        closePos <=
        S.utadCloseMax

        &&

        bars[i].volume <=
        avgVol *
        S.springEffortMax;


      if (
        spring
      ) {

        excursion =
          event(
            "Spring",
            i,
            bars[i].low,
            3,
            bars
          );

        outcome =
          "BULL";

        phase =
          3;

        break;

      }


      if (
        utad
      ) {

        excursion =
          event(
            "UTAD",
            i,
            bars[i].high,
            3,
            bars
          );

        outcome =
          "BEAR";

        phase =
          3;

        break;

      }

    }

  }


  if (
    excursion
  ) {

    events.push(
      excursion
    );


    for (
      let i =
        excursion.index + 1;

      i <
      last -
      S.pivotLen;

      i++
    ) {


      const a =
        atrAt(
          bars,
          i
        ) ||
        c.atr;


      const spread =
        Math.max(
          bars[i].high -
          bars[i].low,
          0.0000001
        );


      const closePos =
        (
          bars[i].close -
          bars[i].low
        ) /
        spread;


      if (
        outcome === "BULL" &&
        isPivotLow(
          bars,
          i
        )
      ) {


        const near =
          bars[i].low <=
          rangeLow +
          a *
          S.testTolATR;


        const holds =
          bars[i].low >=
          excursion.price -
          a *
          0.15;


        const lowerVolume =
          bars[i].volume <=
          bars[
            excursion.index
          ].volume *
          S.testMaxVolRatio;


        const lowerSpread =
          spread <=
          (
            bars[
              excursion.index
            ].high -
            bars[
              excursion.index
            ].low
          ) *
          S.testMaxSpreadRatio;


        if (
          near &&
          holds &&
          lowerVolume &&
          lowerSpread &&
          closePos >= 0.50
        ) {

          test =
            event(
              "Test",
              i,
              bars[i].low,
              3,
              bars
            );

          break;

        }

      }


      if (
        outcome === "BEAR" &&
        isPivotHigh(
          bars,
          i
        )
      ) {


        const near =
          bars[i].high >=
          rangeHigh -
          a *
          S.testTolATR;


        const holds =
          bars[i].high <=
          excursion.price +
          a *
          0.15;


        const lowerVolume =
          bars[i].volume <=
          bars[
            excursion.index
          ].volume *
          S.testMaxVolRatio;


        const lowerSpread =
          spread <=
          (
            bars[
              excursion.index
            ].high -
            bars[
              excursion.index
            ].low
          ) *
          S.testMaxSpreadRatio;


        if (
          near &&
          holds &&
          lowerVolume &&
          lowerSpread &&
          closePos <= 0.50
        ) {

          test =
            event(
              "Test",
              i,
              bars[i].high,
              3,
              bars
            );

          break;

        }

      }

    }

  }


  /*
    No-Spring / No-UTAD
    Terminal Phase-C test
  */

  if (
    matureB &&
    !outcome
  ) {


    const scanFrom =
      Math.max(
        stIndex + 3,
        last - 80
      );


    for (
      let i =
        scanFrom;

      i <
      last -
      S.pivotLen;

      i++
    ) {


      const a =
        atrAt(
          bars,
          i
        ) ||
        c.atr;


      const avgVol =
        avgVolumeAt(
          bars,
          i
        );


      const avgSpread =
        avgSpreadAt(
          bars,
          i
        );


      if (
        !Number.isFinite(
          avgVol
        ) ||
        !Number.isFinite(
          avgSpread
        )
      ) {
        continue;
      }


      if (
        isPivotLow(
          bars,
          i
        )
      ) {

        const near =
          bars[i].low <=
          rangeLow +
          a *
          S.testTolATR;


        const holds =
          bars[i].low >=
          rangeLow -
          a *
          0.15;


        const quiet =
          bars[i].volume <=
          avgVol *
          0.90;


        if (
          near &&
          holds &&
          quiet
        ) {

          outcome =
            "BULL";

          test =
            event(
              "C-Test",
              i,
              bars[i].low,
              2,
              bars
            );

          phase =
            3;

          break;

        }

      }


      if (
        isPivotHigh(
          bars,
          i
        )
      ) {

        const near =
          bars[i].high >=
          rangeHigh -
          a *
          S.testTolATR;


        const holds =
          bars[i].high <=
          rangeHigh +
          a *
          0.15;


        const quiet =
          bars[i].volume <=
          avgVol *
          0.90;


        if (
          near &&
          holds &&
          quiet
        ) {

          outcome =
            "BEAR";

          test =
            event(
              "C-Test",
              i,
              bars[i].high,
              2,
              bars
            );

          phase =
            3;

          break;

        }

      }

    }

  }


  if (
    test
  ) {

    events.push(
      test
    );

  }


  /* =======================================================
     PHASE D - SOS / SOW
  ======================================================= */

  let strength =
    null;


  if (
    phase >= 3 &&
    outcome
  ) {


    const anchor =
      test?.index ??
      excursion?.index ??
      stIndex;


    const rangeHeight =
      Math.max(
        rangeHigh -
        rangeLow,
        0.0000001
      );


    for (
      let i =
        anchor + 1;

      <=
      last;

      i++
    ) {


      const a =
        atrAt(
          bars,
          i
        ) ||
        c.atr;


      const spread =
        Math.max(
          bars[i].high -
          bars[i].low,
          0.0000001
        );


      const closePos =
        (
          bars[i].close -
          bars[i].low
        ) /
        spread;


      const avgVol =
        avgVolumeAt(
          bars,
          i
        ) ||
        bars[i].volume;


      const domUp =
        rangeLow +
        rangeHeight *
        S.phaseDDominanceFrac;


      const domDown =
        rangeHigh -
        rangeHeight *
        S.phaseDDominanceFrac;


      const sos =

        outcome ===
        "BULL"

        &&

        (
          bars[i].close >
          rangeHigh +
          a *
          S.breakATR

          ||

          bars[i].close >=
          domUp
        )

        &&

        bars[i].volume >=
        avgVol *
        S.strengthVolMult

        &&

        spread >=
        a *
        S.strengthSpreadATR

        &&

        closePos >=
        S.sosCloseMin;


      const sow =

        outcome ===
        "BEAR"

        &&

        (
          bars[i].close <
          rangeLow -
          a *
          S.breakATR

          ||

          bars[i].close <=
          domDown
        )

        &&

        bars[i].volume >=
        avgVol *
        S.strengthVolMult

        &&

        spread >=
        a *
        S.strengthSpreadATR

        &&

        closePos <=
        S.sowCloseMax;


      if (
        sos
      ) {

        strength =
          event(
            "SOS",
            i,
            bars[i].high,
            3,
            bars
          );

        phase =
          4;

        break;

      }


      if (
        sow
      ) {

        strength =
          event(
            "SOW",
            i,
            bars[i].low,
            3,
            bars
          );

        phase =
          4;

        break;

      }

    }

  }


  if (
    strength
  ) {

    events.push(
      strength
    );

  }


  /* =======================================================
     LPS / LPSY
  ======================================================= */

  let lps =
    null;


  if (
    strength
  ) {


    for (
      let i =
        strength.index + 1;

      i <
      last -
      S.pivotLen;

      i++
    ) {


      const a =
        atrAt(
          bars,
          i
        ) ||
        c.atr;


      const avgVol =
        avgVolumeAt(
          bars,
          i
        ) ||
        bars[i].volume;


      const spread =
        bars[i].high -
        bars[i].low;


      const closePos =
        spread > 0
          ?
          (
            bars[i].close -
            bars[i].low
          ) /
          spread
          :
          0.5;


      if (
        outcome ===
        "BULL"

        &&

        isPivotLow(
          bars,
          i
        )

        &&

        bars[i].low >=
        rangeHigh -
        a *
        S.lpsBoundaryATR

        &&

        bars[i].volume <=
        avgVol

        &&

        spread <=
        a

        &&

        closePos >= 0.45
      ) {

        lps =
          event(
            "LPS",
            i,
            bars[i].low,
            2,
            bars
          );

        break;

      }


      if (
        outcome ===
        "BEAR"

        &&

        isPivotHigh(
          bars,
          i
        )

        &&

        bars[i].high <=
        rangeLow +
        a *
        S.lpsBoundaryATR

        &&

        bars[i].volume <=
        avgVol

        &&

        spread <=
        a

        &&

        closePos <= 0.55
      ) {

        lps =
          event(
            "LPSY",
            i,
            bars[i].high,
            2,
            bars
          );

        break;

      }

    }

  }


  if (
    lps
  ) {

    events.push(
      lps
    );

  }


  /* =======================================================
     PHASE E ACCEPTANCE
  ======================================================= */

  let eIndex =
    -1;


  if (
    phase >= 4 &&
    outcome
  ) {


    let count =
      0;


    const start =
      Math.max(
        strength?.index ||
        0,
        last - 30
      );


    for (
      let i =
        start;

      i <= last;

      i++
    ) {


      if (
        outcome ===
        "BULL"
      ) {

        count =
          bars[i].close >
          rangeHigh
            ?
            count + 1
            :
            0;

      }

      else {

        count =
          bars[i].close <
          rangeLow
            ?
            count + 1
            :
            0;

      }


      if (
        count >=
        S.confirmBars
      ) {

        phase =
          5;

        eIndex =
          i;

        break;

      }

    }

  }


  if (
    eIndex >= 0
  ) {

    events.push(

      event(
        "Phase E",
        eIndex,
        bars[eIndex].close,
        null,
        bars
      )

    );

  }


  /* =======================================================
     CONFIDENCE
  ======================================================= */

  let confidence =
    10;


  if (
    absorbed
  ) {
    confidence +=
      15;
  }


  if (
    arOK
  ) {
    confidence +=
      10;
  }


  if (
    stIndex >= 0
  ) {
    confidence +=
      15;
  }


  if (
    phase >= 3
  ) {
    confidence +=
      15;
  }


  if (
    strength
  ) {
    confidence +=
      15;
  }


  if (
    lps
  ) {
    confidence +=
      10;
  }


  if (
    phase >= 5
  ) {
    confidence +=
      10;
  }


  confidence =
    clamp(
      confidence,
      0,
      100
    );


  /* =======================================================
     VALIDATION
  ======================================================= */

  let validation =
    0;


  const absTrend =
    Math.abs(
      c.trend
    );


  validation +=

    absTrend >= 35
      ?
      10
      :
      absTrend >= 15
        ?
        5
        :
        0;


  validation +=
    absorbed
      ?
      15
      :
      0;


  if (
    rangeATR >=
    S.phaseBRangeMinATR

    &&

    rangeATR <=
    S.phaseBRangeMaxATR
  ) {

    validation +=
      10;

  }

  else if (

    rangeATR >=
    S.phaseBRangeMinATR *
    0.75

    &&

    rangeATR <=
    S.phaseBRangeMaxATR *
    1.5
  ) {

    validation +=
      5;

  }


  validation +=

    stCount >= 2
      ?
      15
      :
      stCount >= 1
        ?
        8
        :
        0;


  validation +=

    oppCount >= 1 &&
    traversals >= 2
      ?
      15
      :
      (
        oppCount >= 1 ||
        traversals >= 1
      )
        ?
        8
        :
        0;


  validation +=
    matureB
      ?
      10
      :
      0;


  validation +=
    phase >= 3
      ?
      10
      :
      0;


  validation +=
    strength
      ?
      10
      :
      0;


  validation +=
    lps
      ?
      5
      :
      0;


  validation +=
    phase >= 5
      ?
      10
      :
      0;


  validation =
    clamp(
      validation,
      0,
      100
    );


  /* =======================================================
     STRUCTURE
  ======================================================= */

  const continuation =

    bullStop
      ?
      c.trend > 15
      :
      c.trend < -15;


  let structuralDirection =
    null;


  if (
    outcome ===
    "BULL"
  ) {

    structuralDirection =
      "BULL";

  }

  else if (
    outcome ===
    "BEAR"
  ) {

    structuralDirection =
      "BEAR";

  }

  else {

    structuralDirection =
      bullStop
        ?
        "BULL"
        :
        "BEAR";

  }


  const structure =
    structureName(
      structuralDirection,
      continuation
    );


  /* =======================================================
     ENTRY ENGINE
  ======================================================= */

  let direction =
    "WAIT";


  if (
    outcome ===
    "BULL" &&
    phase >= 3
  ) {

    direction =
      "BUY";

  }


  if (
    outcome ===
    "BEAR" &&
    phase >= 3
  ) {

    direction =
      "SELL";

  }


  let entry =
    null;


  const trigger =
    lps ||
    test ||
    strength;


  if (

    trigger

    &&

    direction !==
    "WAIT"

    &&

    confidence >=
    S.minConfidence

    &&

    validation >=
    S.minValidation

  ) {


    const current =
      bars[last];


    const a =
      atrAt(
        bars,
        last
      ) ||
      c.atr;


    const entryPrice =
      current.close;


    let stop;


    if (
      direction ===
      "BUY"
    ) {


      const hardLevel =
        Math.min(
          rangeLow,

          excursion?.price ??
          rangeLow
        );


      stop =
        Math.min(

          hardLevel -
          a *
          0.20,

          entryPrice -
          a *
          1.15

        );

    }

    else {


      const hardLevel =
        Math.max(
          rangeHigh,

          excursion?.price ??
          rangeHigh
        );


      stop =
        Math.max(

          hardLevel +
          a *
          0.20,

          entryPrice +
          a *
          1.15

        );

    }


    const risk =
      Math.max(
        Math.abs(
          entryPrice -
          stop
        ),
        a *
        0.50
      );


    const sign =
      direction ===
      "BUY"
        ?
        1
        :
        -1;


    const tp1 =
      entryPrice +
      sign *
      risk *
      S.rr1;


    const tp2 =
      entryPrice +
      sign *
      risk *
      S.rr2;


    entry = {

      side:
        direction,

      trigger:
        trigger.label,

      price:
        round(
          entryPrice,
          4
        ),

      stop:
        round(
          stop,
          4
        ),

      tp1:
        round(
          tp1,
          4
        ),

      tp2:
        round(
          tp2,
          4
        ),

      risk:
        round(
          risk,
          4
        ),

      rr1:
        S.rr1,

      rr2:
        S.rr2

    };

  }


  /* =======================================================
     EXPLANATIONS
  ======================================================= */

  const reasons =
    [];


  reasons.push(

    bullStop
      ?
      "Selling climax candidate detected after bearish pressure."
      :
      "Buying climax candidate detected after bullish pressure."

  );


  reasons.push(

    absorbed
      ?
      "Post-climax absorption confirmed."
      :
      "Post-climax absorption is not fully confirmed."

  );


  if (
    arOK
  ) {

    reasons.push(
      `Automatic ${bullStop ? "rally" : "reaction"} moved ${round(arMoveATR, 2)} ATR from the climax.`
    );

  }


  if (
    stCount > 0
  ) {

    reasons.push(
      `${stCount} climax-side secondary test${stCount === 1 ? "" : "s"} detected.`
    );

  }


  if (
    oppCount > 0 ||
    traversals > 0
  ) {

    reasons.push(
      `Phase B contains ${oppCount} opposite-edge test${oppCount === 1 ? "" : "s"} and ${traversals} traversal${traversals === 1 ? "" : "s"}.`
    );

  }


  if (
    excursion
  ) {

    reasons.push(
      `${excursion.label} broke the range temporarily and reclaimed it.`
    );

  }


  if (
    test
  ) {

    reasons.push(
      `${test.label} confirmed the Phase C route.`
    );

  }


  if (
    strength
  ) {

    reasons.push(
      `${strength.label} confirmed Phase D directional strength.`
    );

  }


  if (
    lps
  ) {

    reasons.push(
      `${lps.label} confirmed a low-effort pullback after strength.`
    );

  }


  if (
    phase >= 5
  ) {

    reasons.push(
      "Price achieved multi-bar acceptance outside the trading range."
    );

  }


  if (
    entry
  ) {

    reasons.push(
      `${entry.side} qualifies because maturity is ${confidence}/100 and validation is ${validation}/100.`
    );

  }


  return {

    phase,

    phaseName:
      phaseName(
        phase
      ),

    structure,

    direction,

    confidence,

    validation,

    range: {

      low:
        round(
          rangeLow,
          4
        ),

      high:
        round(
          rangeHigh,
          4
        ),

      heightATR:
        round(
          rangeATR,
          2
        )

    },

    trendScore:
      round(
        c.trend,
        2
      ),

    climaxSide:
      c.side,

    stats: {

      absorbed,

      arMoveATR:
        round(
          arMoveATR,
          2
        ),

      stCount,

      oppositeTests:
        oppCount,

      traversals,

      phaseBAge:
        bAge,

      maturePhaseB:
        matureB

    },

    events,

    entry,

    reasons

  };

}


/* =========================================================
   MAIN ANALYSIS
========================================================= */

function analyzeBars(
  bars
) {


  if (
    !Array.isArray(
      bars
    ) ||
    bars.length < 120
  ) {

    return {

      phase:
        0,

      phaseName:
        "None",

      structure:
        "SEARCHING",

      direction:
        "WAIT",

      confidence:
        0,

      validation:
        0,

      range:
        null,

      events:
        [],

      entry:
        null,

      reasons: [
        "Not enough candles to build a Wyckoff campaign."
      ]

    };

  }


  const climaxes =
    findClimaxes(
      bars
    );


  if (
    !climaxes.length
  ) {

    return {

      phase:
        0,

      phaseName:
        "None",

      structure:
        "SEARCHING",

      direction:
        "WAIT",

      confidence:
        0,

      validation:
        0,

      range:
        null,

      events:
        [],

      entry:
        null,

      reasons: [
        "No valid selling or buying climax was detected in the active lookback."
      ]

    };

  }


  let best =
    null;


  const candidates =
    climaxes.slice(
      -20
    );


  for (
    const climax
    of candidates
  ) {


    const campaign =
      buildCampaign(
        bars,
        climax
      );


    const score =

      campaign.phase *
      100

      +

      campaign.validation

      +

      campaign.confidence *
      0.25

      +

      climax.index *
      0.0001;


    if (
      !best ||
      score >
      best.score
    ) {

      best = {

        score,

        campaign

      };

    }

  }


  return (
    best?.campaign ||
    {

      phase:
        0,

      phaseName:
        "None",

      structure:
        "SEARCHING",

      direction:
        "WAIT",

      confidence:
        0,

      validation:
        0,

      events:
        [],

      entry:
        null

    }
  );

}


/* =========================================================
   MTF UTILITY
========================================================= */

function utility(
  row,
  requestedTf
) {

  const a =
    row.analysis;


  let score =

    a.validation

    +

    a.confidence *
    0.25

    +

    a.phase *
    8;


  if (
    row.tf ===
    requestedTf
  ) {

    score +=
      5;

  }


  if (
    a.phase === 5
  ) {

    score -=
      5;

  }


  if (
    a.direction ===
    "WAIT"
  ) {

    score -=
      5;

  }


  return score;

}


function chooseEffective(
  rows,
  requestedTf
) {


  let best =
    null;


  for (
    const row
    of rows
  ) {


    const u =
      utility(
        row,
        requestedTf
      );


    const x = {

      ...row,

      utility:
        u

    };


    if (
      !best
    ) {

      best =
        x;

      continue;

    }


    if (
      x.analysis.phase >
      best.analysis.phase
    ) {

      best =
        x;

      continue;

    }


    if (

      x.analysis.phase ===
      best.analysis.phase

      &&

      x.utility >
      best.utility

    ) {

      best =
        x;

    }

  }


  return best;

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
    "no-store, max-age=0"
  );


  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );


  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );


  if (
    req.method ===
    "OPTIONS"
  ) {

    return res
      .status(204)
      .end();

  }


  try {


    const symbol =
      normalizeSymbol(
        req.query?.symbol ||
        "XAU/USD"
      );


    const requestedTf =
      TF_CHAIN[
        req.query?.tf
      ]
        ?
        req.query.tf
        :
        "5m";


    const chain =
      TF_CHAIN[
        requestedTf
      ];


    const rows =
      await Promise.all(

        chain.map(

          async tf => {


            const bars =
              await fetchSeries(
                symbol,
                tf
              );


            const analysis =
              analyzeBars(
                bars
              );


            return {

              tf,

              bars,

              analysis

            };

          }

        )

      );


    const selected =
      chooseEffective(
        rows,
        requestedTf
      );


    if (
      !selected
    ) {

      throw new Error(
        "No timeframe analysis was available."
      );

    }


    const current =
      selected.bars[
        selected.bars.length -
        1
      ];


    return res
      .status(200)
      .json({

        ok:
          true,

        engine:
          "MKAYFX WYCKOFF V2",

        generatedAt:
          new Date()
            .toISOString(),

        symbol,

        requestedTf,

        selectedTf:
          selected.tf,

        mtfActive:
          selected.tf !==
          requestedTf,

        price:
          round(
            current?.close,
            4
          ),

        analysis:
          selected.analysis,

        timeframes:
          rows.map(
            row => ({

              tf:
                row.tf,

              phase:
                row.analysis.phase,

              phaseName:
                row.analysis.phaseName,

              structure:
                row.analysis.structure,

              direction:
                row.analysis.direction,

              confidence:
                row.analysis.confidence,

              validation:
                row.analysis.validation

            })
          ),

        candles:
          selected.bars
            .slice(-220)
            .map(
              b => ({

                time:
                  b.time,

                open:
                  round(
                    b.open,
                    4
                  ),

                high:
                  round(
                    b.high,
                    4
                  ),

                low:
                  round(
                    b.low,
                    4
                  ),

                close:
                  round(
                    b.close,
                    4
                  ),

                volume:
                  b.volume

              })
            )

      });


  }

  catch (
    error
  ) {


    console.error(
      "WYCKOFF ERROR:",
      error
    );


    return res
      .status(500)
      .json({

        ok:
          false,

        engine:
          "MKAYFX WYCKOFF V2",

        error:
          error instanceof Error
            ?
            error.message
            :
            String(error)

      });

  }

}