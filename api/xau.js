/* =========================================================
   XAU LIQUIDITY INTELLIGENCE ENGINE
   /api/xau.js

   PURPOSE
   -------
   XAU/USD intelligence only.
   This is NOT a forced BUY / SELL strategy.

   FEATURES
   --------
   - Session intelligence
   - Asia / London / NY highs and lows
   - PDH / PDL
   - PWH / PWL
   - Equal highs / lows
   - H1 swing liquidity
   - M15 FVGs
   - MTF structure
   - ATR / volatility
   - VWAP
   - Footprint-style volume delta proxy
   - CVD proxy
   - Absorption
   - Delta divergence
   - Historical Asia sweep behaviour
   - Estimated sweep overshoot
   - Potential reversal / raid zones
   - Liquidity trap windows
   - Optional FRED macro pressure

   ENVIRONMENT VARIABLES
   ---------------------
   TWELVE_DATA_API_KEY
   FRED_API_KEY          optional
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


const PRICE_CACHE_MS =
  55_000;


const MACRO_CACHE_MS =
  15 * 60_000;


let priceCache = {
  at: 0,
  payload: null
};


let macroCache = {
  at: 0,
  payload: null
};


/* =========================================================
   SESSION DEFINITIONS

   These are regional trading-analysis windows.

   Tokyo
   -----
   09:00 - 18:00 Tokyo local

   London
   ------
   08:00 - 17:00 London local

   New York
   --------
   08:00 - 17:00 New York local

   Using IANA timezones means DST is handled automatically.
========================================================= */


const SESSION_DEFS = [

  {
    id: "tokyo",
    name: "Tokyo / Asia",
    short: "ASIA",
    zone: "Asia/Tokyo",
    open: 9 * 60,
    close: 18 * 60,
    risk: 0.55
  },

  {
    id: "london",
    name: "London",
    short: "LONDON",
    zone: "Europe/London",
    open: 8 * 60,
    close: 17 * 60,
    risk: 1
  },

  {
    id: "newyork",
    name: "New York",
    short: "NEW YORK",
    zone: "America/New_York",
    open: 8 * 60,
    close: 17 * 60,
    risk: 1
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
        error: "GET only"
      });

  }


  if (
    !TD_KEY
  ) {

    return res
      .status(500)
      .json({

        ok: false,

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

      priceCache.payload &&

      now -
      priceCache.at <
      PRICE_CACHE_MS

    ) {

      return res
        .status(200)
        .json({

          ...priceCache.payload,

          cache: true,

          servedAt:
            new Date()
              .toISOString()

        });

    }


    /* =====================================================
       DATA

       M1:
       current microstructure

       M5:
       longer historical liquidity behaviour

       D1:
       day/week reference levels
    ===================================================== */


    const [

      m1Raw,
      m5Raw,
      d1Raw,
      macro

    ] = await Promise.all([

      fetchTdSeries(
        "1min",
        1800
      ),

      fetchTdSeries(
        "5min",
        5000
      ),

      fetchTdSeries(
        "1day",
        120
      ),

      getMacroContext()

    ]);


    const m1 =
      parseTdSeries(
        m1Raw,
        true
      );


    const m5 =
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

      m1.length < 100 ||

      m5.length < 300 ||

      d1.length < 20

    ) {

      throw new Error(

        `Not enough data returned. ` +

        `M1=${m1.length}, ` +

        `M5=${m5.length}, ` +

        `D1=${d1.length}`

      );

    }


    /* =====================================================
       CREATE HIGHER TIMEFRAMES
    ===================================================== */


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


    const h4 =
      resample(
        m5,
        240
      );


    const current =
      m1[
        m1.length - 1
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
       DAILY / WEEKLY LIQUIDITY
    ===================================================== */


    const dayLevels =
      buildDayLevels(
        d1,
        price
      );


    /* =====================================================
       MTF STRUCTURE
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
       BUILD RAW LIQUIDITY MAP
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


    /* =====================================================
       PROJECT SWEEP DEPTH
    ===================================================== */


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
          (a, b) =>
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

      ok: true,

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
        ).toISOString(),


      dataAgeSeconds,


      source: {

        price:
          "Twelve Data XAU/USD",

        footprint:
          footprint.mode,

        footprintIsTrueBidAsk:
          false,

        macro:
          macro.enabled
            ? "FRED"
            : "disabled"

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

        "Sweep likelihood is a heuristic ranking, not a calibrated probability or guarantee.",

        "The footprint section is an OHLCV-derived order-flow proxy unless your feed supplies true aggressor bid/ask volume.",

        "Spot XAU/USD volume can represent provider or broker activity rather than centralized exchange volume."

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

        ok: false,

        error:
          error?.message
          ||
          "Unknown server error"

      });

  }

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
            "XAU-Liquidity-Intelligence/1.0"

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
    json.status === "error"
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
   PARSE DATA
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
      (a, b) =>
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

          ? 0.35

          : 0.08;


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

          ? 1.3

          : 1;


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

        score >= 20

          ?

          "GOLD SUPPORTIVE"

          :

          score <= -20

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

          x.value !== "."

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
    valid.length < 2
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

    previous !== 0

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

    p.weekday === 0

    ||

    p.weekday === 6

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

      p.weekday >= 1

      &&

      p.weekday <= 5

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
      minsToOpen <= 75
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
    elapsed <= 90
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
    minute <= 60
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

    let i = 1;

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
      state !== previous
    ) {

      return {

        type:
          state
            ? "OPEN"
            : "CLOSE",

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
        ? "CLOSE"
        : "OPEN",

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

      p.weekday === 0

      ||

      p.weekday === 6

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
      keys.length - 1
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
      rows.length - 1
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

    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6

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


  const out = [];


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


    } else {


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
      bars.length - 1
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

      e20.length - 1

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

    atrv > 0

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
    last.close >
    e20v
  ) {

    score++;

  } else {

    score--;

  }


  if (
    e20v >
    e50v
  ) {

    score++;

  } else {

    score--;

  }


  if (
    e50v >
    e200v
  ) {

    score++;

  } else {

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
    score >= 2
  ) {

    bias =
      "BULLISH";

  }


  if (
    score <= -2
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
    let i = 1;
    i < values.length;
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
    let i = 1;
    i <= period;
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

    averageLoss === 0

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

      averageLoss === 0

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
          i === 0
        ) {

          return (
            b.high -
            b.low
          );

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
    let i = 0;
    i < period;
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

    `${d.getUTCFullYear()}-W` +

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
        j === i
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
   EQUAL HIGH / LOW LIQUIDITY
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

    let i = 0;

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
      group.length >= 2
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


    /* Bullish gap */

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


    /* Bearish gap */

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
      (a, b) =>
        a.distance -
        b.distance
    )

    .slice(
      0,
      6
    );

}


/* =========================================================
   FOOTPRINT STYLE PROXY

   IMPORTANT
   ---------
   This is NOT a true exchange footprint.

   True footprint requires actual aggressor bid/ask
   transaction data.

   This model estimates delta using:

   - provider volume if available
   - candle location
   - candle direction
   - wick structure
   - relative range

   If provider volume is missing, range activity is used.
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

        b.volume > 0

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
    rows.length < 10
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
      second.length - 1
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

    priceChange > 0

    &&

    deltaChange < 0

  ) {

    return "PRICE UP / DELTA DOWN";

  }


  if (

    priceChange < 0

    &&

    deltaChange > 0

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

    let i = 0;

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
    highAbsorb >= 2
  ) {

    return "BUYING ABSORBED / TRAPPED BUYER RISK";

  }


  if (
    lowAbsorb >= 2
  ) {

    return "SELLING ABSORBED / TRAPPED SELLER RISK";

  }


  return "NONE";

}


/* =========================================================
   FOOTPRINT AROUND SPECIFIC LIQUIDITY LEVEL
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

      b.volume > 0

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

      side === "HIGH"

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

      side === "LOW"

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
      recent.length - 1
    ];


  let state =
    "NEUTRAL";


  if (
    side === "HIGH"
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
      deltaPct > 20
    ) {

      state =
        "BUY PRESSURE INTO LIQUIDITY";

    }

  }


  if (
    side === "LOW"
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
      deltaPct < -20
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
        b.volume > 0
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
          source.length - 1
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

      p.weekday === 0

      ||

      p.weekday === 6

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
          (a, b) =>
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
      asia.length < 80
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
        asia.length - 1
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
      after.length < 12
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

        side === "HIGH"

          ?

          b.high >
          level

          :

          b.low <
          level

    );


  if (
    firstIndex < 0
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

    let i = 0;

    i <
    segment.length;

    i++

  ) {

    const bar =
      segment[i];


    const ext =

      side === "HIGH"

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
      i > 0
    ) {

      const backInside =

        side === "HIGH"

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

      atrAt > 0

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
   MERGE CONFLUENT LIQUIDITY
========================================================= */


function mergeNearbyPools(
  pools,
  tolerance
) {

  const sorted =
    pools
      .slice()
      .sort(
        (a, b) =>
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
        out.length - 1
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


      } else {

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


    } else {

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


  /* =====================================================
     HISTORICAL OVERSHOOT

     Asia pools use actual recent Asia sweep measurements.

     Other pools use ATR-based default estimates.
  ===================================================== */


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


  /* Not enough history? use conservative defaults */

  if (

    historical

    &&

    historical.sweeps < 3

  ) {

    p25Atr =
      0.08;


    medianAtr =
      0.18;


    p75Atr =
      0.36;

  }


  /* =====================================================
     FLOW ADJUSTMENT

     Acceptance = deeper expected penetration.

     Rejection / absorption = shallower expected raid.
  ===================================================== */


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
    medianAtr < 0.12
  ) {

    raidStyle =
      "TOUCH / VERY SHALLOW RAID";

  }


  if (
    medianAtr > 0.32
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


  /* =====================================================
     REASONS
  ===================================================== */


  const reasons =
    [];


  reasons.push(

    `${round(distanceAtr, 2)}× M15 ATR from current price`

  );


  reasons.push(

    `Liquidity importance ${round(pool.importance, 2)}×`

  );


  if (
    directionalPressure > 0.2
  ) {

    reasons.push(

      "Multi-timeframe pressure currently points toward this pool"

    );

  }


  if (
    directionalPressure < -0.2
  ) {

    reasons.push(

      "Current multi-timeframe pressure points away from this pool"

    );

  }


  if (
    activeSessionRisk >= 10
  ) {

    reasons.push(

      "Price is inside a major opening liquidity window"

    );

  }


  if (
    Math.abs(
      delta
    )
    >=
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

      likelihoodScore >= 75

        ?

        "HIGH"

        :

        likelihoodScore >= 58

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
      score > 0
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

          score >= 75

            ?

            "ELEVATED"

            :

            score >= 55

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
      (a, b) =>
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

    bullish >= 2

      ?

      "BULLISH"

      :

      bearish >= 2

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

    footprint.last15.deltaPct >= 18

      ?

      "BUY DOMINANT"

      :

      footprint.last15.deltaPct <= -18

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
        (a, b) =>
          a -
          b
      );


  if (
    !arr.length
  ) {

    return null;

  }


  if (
    arr.length === 1
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

    i >= 0;

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