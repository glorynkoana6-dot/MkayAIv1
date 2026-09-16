/* =========================================================
   MKAYFX NEWS EVENTS ROBOT V1

   FREE-FIRST VERSION

   PRIMARY MARKET:
   XAU/USD

   ALSO RETURNS:
   EUR/USD
   GBP/USD
   USD/JPY
   BTC/USD

   DATA:
   Trading Economics Economic Calendar

   DEFAULT:
   guest:guest

   OPTIONAL VERCEL VARIABLE:
   TRADING_ECONOMICS_API_KEY
========================================================= */


const TE_API_KEY =
  process.env.TRADING_ECONOMICS_API_KEY ||
  "guest:guest";


const TE_BASE =
  "https://api.tradingeconomics.com";


const CACHE_MS =
  45_000;


/* =========================================================
   CACHE
========================================================= */


let cache = {

  key:
    "",

  time:
    0,

  data:
    null

};


/* =========================================================
   HIGH IMPACT EVENTS
========================================================= */


const HIGH_IMPACT_PATTERNS =
[

  /non.?farm|payroll/i,

  /employment situation/i,

  /unemployment rate/i,

  /average hourly earnings|wage/i,

  /consumer price|\bcpi\b/i,

  /core cpi/i,

  /personal consumption expenditures|\bpce\b/i,

  /core pce/i,

  /producer price|\bppi\b/i,

  /fed interest rate|federal funds|interest rate decision/i,

  /fomc|federal open market/i,

  /gross domestic product|\bgdp\b/i,

  /retail sales/i,

  /ism manufacturing|manufacturing pmi/i,

  /ism services|services pmi|non.?manufacturing/i,

  /jolts|job openings/i,

  /jobless claims|unemployment claims/i,

  /adp employment/i

];


/* =========================================================
   HELPERS
========================================================= */


function send(
  res,
  status,
  data
){

  return res
    .status(
      status
    )
    .json(
      data
    );

}


function clamp(
  value,
  min,
  max
){

  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );

}


function round(
  value,
  digits = 2
){

  const number =
    Number(
      value
    );


  if(
    !Number.isFinite(
      number
    )
  ){

    return null;

  }


  return Number(
    number.toFixed(
      digits
    )
  );

}


function isoDate(
  date
){

  return date
    .toISOString()
    .slice(
      0,
      10
    );

}


function addDays(
  date,
  days
){

  const result =
    new Date(
      date
    );


  result.setUTCDate(
    result.getUTCDate() +
    days
  );


  return result;

}


/* =========================================================
   EVENT DATE

   TRADING ECONOMICS CALENDAR DATES ARE UTC
========================================================= */


function parseEventDate(
  value
){

  if(
    !value
  ){

    return null;

  }


  const raw =
    String(
      value
    )
    .trim();


  const normalized =
    /Z$|[+-]\d\d:\d\d$/
      .test(
        raw
      )

      ?

      raw

      :

      `${raw}Z`;


  const milliseconds =
    Date.parse(
      normalized
    );


  if(
    !Number.isFinite(
      milliseconds
    )
  ){

    return null;

  }


  return new Date(
    milliseconds
  );

}


/* =========================================================
   PARSE VALUES

   EXAMPLES:

   150K
   3.1%
   1.2M
   250B
========================================================= */


function parseNumeric(
  value
){

  if(
    value ===
      null ||
    value ===
      undefined ||
    value ===
      ""
  ){

    return null;

  }


  if(
    typeof value ===
    "number"
  ){

    return Number.isFinite(
      value
    )
      ?
      value
      :
      null;

  }


  const text =
    String(
      value
    )

    .trim()

    .replace(
      /,/g,
      ""
    )

    .replace(
      /\s/g,
      ""
    );


  if(
    !text ||
    /^(n\/a|na|none|null|-)$/
      .test(
        text.toLowerCase()
      )
  ){

    return null;

  }


  const match =
    text.match(
      /^([+-]?(?:\d+\.?\d*|\.\d+))(K|M|B|T)?%?$/i
    );


  if(
    !match
  ){

    const fallback =
      Number.parseFloat(
        text.replace(
          /[^0-9.+-]/g,
          ""
        )
      );


    return Number.isFinite(
      fallback
    )
      ?
      fallback
      :
      null;

  }


  let number =
    Number(
      match[1]
    );


  const suffix =
    String(
      match[2] ||
      ""
    )
    .toUpperCase();


  if(
    suffix ===
    "K"
  ){

    number *=
      1000;

  }


  if(
    suffix ===
    "M"
  ){

    number *=
      1_000_000;

  }


  if(
    suffix ===
    "B"
  ){

    number *=
      1_000_000_000;

  }


  if(
    suffix ===
    "T"
  ){

    number *=
      1_000_000_000_000;

  }


  return Number.isFinite(
    number
  )
    ?
    number
    :
    null;

}


/* =========================================================
   EVENT NAME
========================================================= */


function combinedName(
  event
){

  return (
    `${
      event.Category ||
      ""
    } ${
      event.Event ||
      ""
    }`
  )
  .trim();

}


/* =========================================================
   EVENT FILTER
========================================================= */


function isImportantEvent(
  event
){

  const importance =
    Number(
      event.Importance ||
      0
    );


  if(
    importance >=
    3
  ){

    return true;

  }


  const name =
    combinedName(
      event
    );


  return HIGH_IMPACT_PATTERNS
    .some(
      pattern =>
        pattern.test(
          name
        )
    );

}


/* =========================================================
   EVENT TYPE
========================================================= */


function eventType(
  event
){

  const name =
    combinedName(
      event
    )
    .toLowerCase();


  if(
    /non.?farm|payroll|employment situation/
      .test(
        name
      )
  ){

    return "NFP";

  }


  if(
    /unemployment rate/
      .test(
        name
      )
  ){

    return "UNEMPLOYMENT";

  }


  if(
    /average hourly earnings|wage/
      .test(
        name
      )
  ){

    return "WAGES";

  }


  if(
    /core cpi/
      .test(
        name
      )
  ){

    return "CORE_CPI";

  }


  if(
    /consumer price|\bcpi\b/
      .test(
        name
      )
  ){

    return "CPI";

  }


  if(
    /core pce/
      .test(
        name
      )
  ){

    return "CORE_PCE";

  }


  if(
    /personal consumption expenditures|\bpce\b/
      .test(
        name
      )
  ){

    return "PCE";

  }


  if(
    /producer price|\bppi\b/
      .test(
        name
      )
  ){

    return "PPI";

  }


  if(
    /fed interest rate|federal funds|interest rate decision/
      .test(
        name
      )
  ){

    return "FED_RATE";

  }


  if(
    /fomc|federal open market/
      .test(
        name
      )
  ){

    return "FOMC";

  }


  if(
    /gross domestic product|\bgdp\b/
      .test(
        name
      )
  ){

    return "GDP";

  }


  if(
    /retail sales/
      .test(
        name
      )
  ){

    return "RETAIL_SALES";

  }


  if(
    /ism manufacturing|manufacturing pmi/
      .test(
        name
      )
  ){

    return "ISM_MANUFACTURING";

  }


  if(
    /ism services|services pmi|non.?manufacturing/
      .test(
        name
      )
  ){

    return "ISM_SERVICES";

  }


  if(
    /jolts|job openings/
      .test(
        name
      )
  ){

    return "JOLTS";

  }


  if(
    /jobless claims|unemployment claims/
      .test(
        name
      )
  ){

    return "JOBLESS_CLAIMS";

  }


  if(
    /adp employment/
      .test(
        name
      )
  ){

    return "ADP";

  }


  return "OTHER";

}


/* =========================================================
   ECONOMIC RULES

   higherUsdPositive:

   TRUE
   higher actual usually supports USD

   FALSE
   higher actual usually hurts USD
========================================================= */


function eventRule(
  type
){

  const rules =
  {

    NFP:{

      higherUsdPositive:
        true,

      threshold:
        30_000

    },


    UNEMPLOYMENT:{

      higherUsdPositive:
        false,

      threshold:
        0.1

    },


    WAGES:{

      higherUsdPositive:
        true,

      threshold:
        0.1

    },


    CPI:{

      higherUsdPositive:
        true,

      threshold:
        0.1

    },


    CORE_CPI:{

      higherUsdPositive:
        true,

      threshold:
        0.1

    },


    PCE:{

      higherUsdPositive:
        true,

      threshold:
        0.1

    },


    CORE_PCE:{

      higherUsdPositive:
        true,

      threshold:
        0.1

    },


    PPI:{

      higherUsdPositive:
        true,

      threshold:
        0.2

    },


    FED_RATE:{

      higherUsdPositive:
        true,

      threshold:
        0.25

    },


    GDP:{

      higherUsdPositive:
        true,

      threshold:
        0.3

    },


    RETAIL_SALES:{

      higherUsdPositive:
        true,

      threshold:
        0.3

    },


    ISM_MANUFACTURING:{

      higherUsdPositive:
        true,

      threshold:
        1

    },


    ISM_SERVICES:{

      higherUsdPositive:
        true,

      threshold:
        1

    },


    JOLTS:{

      higherUsdPositive:
        true,

      threshold:
        250_000

    },


    JOBLESS_CLAIMS:{

      higherUsdPositive:
        false,

      threshold:
        15_000

    },


    ADP:{

      higherUsdPositive:
        true,

      threshold:
        30_000

    },


    FOMC:{

      higherUsdPositive:
        null,

      threshold:
        null

    },


    OTHER:{

      higherUsdPositive:
        null,

      threshold:
        null

    }

  };


  return (
    rules[type] ||
    rules.OTHER
  );

}


/* =========================================================
   TIMING
========================================================= */


function minutesUntil(
  date,
  now = new Date()
){

  return Math.round(
    (
      date.getTime() -
      now.getTime()
    ) /
    60_000
  );

}


function eventPhase(
  minutes
){

  if(
    minutes >
    60
  ){

    return "UPCOMING";

  }


  if(
    minutes >
    15
  ){

    return "WATCH";

  }


  if(
    minutes >
    0
  ){

    return "PRE_NEWS_LOCK";

  }


  if(
    minutes >=
    -10
  ){

    return "RELEASE_WINDOW";

  }


  if(
    minutes >=
    -30
  ){

    return "POST_NEWS";

  }


  return "PAST";

}


/* =========================================================
   NUMERIC VALUES
========================================================= */


function numericFields(
  event
){

  const actual =
    Number.isFinite(
      Number(
        event.ActualValue
      )
    )

    ?

    Number(
      event.ActualValue
    )

    :

    parseNumeric(
      event.Actual
    );


  const forecast =
    Number.isFinite(
      Number(
        event.ForecastValue
      )
    )

    ?

    Number(
      event.ForecastValue
    )

    :

    parseNumeric(
      event.Forecast
    );


  const teForecast =
    Number.isFinite(
      Number(
        event.TEForecastValue
      )
    )

    ?

    Number(
      event.TEForecastValue
    )

    :

    parseNumeric(
      event.TEForecast
    );


  const previous =
    Number.isFinite(
      Number(
        event.PreviousValue
      )
    )

    ?

    Number(
      event.PreviousValue
    )

    :

    parseNumeric(
      event.Previous
    );


  return {

    actual,

    forecast,

    teForecast,

    previous

  };

}


/* =========================================================
   NEWS SURPRISE ENGINE
========================================================= */


function surpriseAnalysis(
  event
){

  const type =
    eventType(
      event
    );


  const rule =
    eventRule(
      type
    );


  const values =
    numericFields(
      event
    );


  const expected =
    values.forecast ??
    values.teForecast;


  /*
    FOMC STATEMENT

    Do not automatically guess hawkish/dovish tone
    without analysing the statement.
  */


  if(
    rule.higherUsdPositive ===
    null
  ){

    return {

      type,

      ready:
        false,

      reason:
        type ===
        "FOMC"

          ?

        "FOMC statement requires qualitative interpretation."

          :

        "No automatic directional rule for this event.",

      ...values

    };

  }


  if(
    !Number.isFinite(
      values.actual
    ) ||
    !Number.isFinite(
      expected
    )
  ){

    return {

      type,

      ready:
        false,

      reason:
        "Waiting for Actual and Forecast values.",

      ...values

    };

  }


  const difference =
    values.actual -
    expected;


  const threshold =
    Math.max(

      Math.abs(
        rule.threshold ||
        1
      ),

      0.0000001

    );


  const magnitude =
    Math.abs(
      difference
    ) /
    threshold;


  let usdBias =
    "NEUTRAL";


  if(
    Math.abs(
      difference
    ) >
    threshold *
    0.15
  ){

    const higher =
      difference >
      0;


    const positive =
      higher ===
      rule.higherUsdPositive;


    usdBias =
      positive
        ?
        "BULLISH"
        :
        "BEARISH";

  }


  const confidence =
    usdBias ===
    "NEUTRAL"

      ?

    clamp(
      Math.round(
        45 +
        magnitude *
        12
      ),
      45,
      62
    )

      :

    clamp(
      Math.round(
        58 +
        magnitude *
        22
      ),
      58,
      95
    );


  /*
     USD BULLISH

     Gold tends to receive bearish pressure.

     USD BEARISH

     Gold tends to receive bullish pressure.

     These are directional news biases,
     not guaranteed market reactions.
  */


  const xauusd =
    usdBias ===
    "BULLISH"

      ?

    "SELL"

      :

    usdBias ===
    "BEARISH"

      ?

    "BUY"

      :

    "WAIT";


  const eurusd =
    usdBias ===
    "BULLISH"

      ?

    "SELL"

      :

    usdBias ===
    "BEARISH"

      ?

    "BUY"

      :

    "WAIT";


  const gbpusd =
    eurusd;


  const usdjpy =
    usdBias ===
    "BULLISH"

      ?

    "BUY"

      :

    usdBias ===
    "BEARISH"

      ?

    "SELL"

      :

    "WAIT";


  const btcusd =
    usdBias ===
    "BULLISH"

      ?

    "SELL"

      :

    usdBias ===
    "BEARISH"

      ?

    "BUY"

      :

    "WAIT";


  return {

    type,

    ready:
      true,

    actual:
      values.actual,

    forecast:
      values.forecast,

    teForecast:
      values.teForecast,

    expected,

    previous:
      values.previous,

    difference:
      round(
        difference,
        4
      ),

    magnitude:
      round(
        magnitude,
        2
      ),

    usdBias,

    confidence,

    signals:{

      "XAU/USD":
        xauusd,

      "EUR/USD":
        eurusd,

      "GBP/USD":
        gbpusd,

      "USD/JPY":
        usdjpy,

      "BTC/USD":
        btcusd

    }

  };

}


/* =========================================================
   NORMALISE EVENT
========================================================= */


function normalizeEvent(
  event,
  now
){

  const date =
    parseEventDate(
      event.Date
    );


  if(
    !date
  ){

    return null;

  }


  const minutes =
    minutesUntil(
      date,
      now
    );


  return {

    id:
      String(
        event.CalendarId ||
        `${event.Date}-${event.Event}`
      ),

    dateUTC:
      date.toISOString(),

    minutesUntil:
      minutes,

    phase:
      eventPhase(
        minutes
      ),

    country:
      event.Country ||
      "",

    category:
      event.Category ||
      "",

    event:
      event.Event ||
      event.Category ||
      "Economic Event",

    type:
      eventType(
        event
      ),

    importance:
      Number(
        event.Importance ||
        0
      ),

    reference:
      event.Reference ||
      "",

    actual:
      event.Actual ??
      null,

    previous:
      event.Previous ??
      null,

    forecast:
      event.Forecast ??
      null,

    teForecast:
      event.TEForecast ??
      null,

    unit:
      event.Unit ||
      "",

    source:
      event.Source ||
      "",

    sourceURL:
      event.SourceURL ||
      "",

    surprise:
      surpriseAnalysis(
        event
      )

  };

}


/* =========================================================
   CALENDAR REQUEST
========================================================= */


async function fetchCalendar(
  now = new Date()
){

  const from =
    isoDate(
      addDays(
        now,
        -1
      )
    );


  const to =
    isoDate(
      addDays(
        now,
        3
      )
    );


  const cacheKey =
    `${from}-${to}`;


  if(
    cache.data &&
    cache.key ===
      cacheKey &&
    Date.now() -
      cache.time <
      CACHE_MS
  ){

    return {

      events:
        cache.data,

      cacheHit:
        true

    };

  }


  const url =

    `${TE_BASE}` +

    `/calendar/country/united%20states/${from}/${to}` +

    `?c=${encodeURIComponent(
      TE_API_KEY
    )}` +

    `&f=json` +

    `&values=true`;


  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () =>
        controller.abort(),
      15000
    );


  try{

    const response =
      await fetch(
        url,
        {

          headers:{

            Accept:
              "application/json"

          },

          signal:
            controller.signal,

          cache:
            "no-store"

        }
      );


    const data =
      await response
        .json()
        .catch(
          () =>
            null
        );


    if(
      !response.ok ||
      !Array.isArray(
        data
      )
    ){

      throw new Error(
        data?.message ||
        data?.Message ||
        `Economic calendar error ${response.status}`
      );

    }


    cache = {

      key:
        cacheKey,

      time:
        Date.now(),

      data

    };


    return {

      events:
        data,

      cacheHit:
        false

    };

  }
  finally{

    clearTimeout(
      timer
    );

  }

}


/* =========================================================
   FIND ACTIVE / NEXT EVENT
========================================================= */


function choosePrimaryEvent(
  events
){

  /*
     Event currently near release.
  */


  const active =
    events

      .filter(
        event =>
          event.minutesUntil <=
            15 &&
          event.minutesUntil >=
            -30
      )

      .sort(
        (
          a,
          b
        ) =>
          Math.abs(
            a.minutesUntil
          ) -
          Math.abs(
            b.minutesUntil
          )
      );


  if(
    active.length
  ){

    return active[0];

  }


  /*
     Otherwise choose next event.
  */


  const upcoming =
    events

      .filter(
        event =>
          event.minutesUntil >
          0
      )

      .sort(
        (
          a,
          b
        ) =>
          a.minutesUntil -
          b.minutesUntil
      );


  return (
    upcoming[0] ||
    null
  );

}


/* =========================================================
   ROBOT DECISION
========================================================= */


function buildRobotDecision(
  primary
){

  if(
    !primary
  ){

    return {

      mode:
        "IDLE",

      action:
        "WAIT",

      confidence:
        0,

      reason:
        "No major USD event found."

    };

  }


  /*
     BEFORE NEWS

     Never predict the release.
  */


  if(
    [
      "UPCOMING",
      "WATCH",
      "PRE_NEWS_LOCK"
    ]
    .includes(
      primary.phase
    )
  ){

    return {

      mode:
        primary.phase,

      action:
        "WAIT",

      confidence:
        0,

      event:
        primary.event,

      minutesUntil:
        primary.minutesUntil,

      reason:
        "News has not been released yet. Waiting for the actual value."

    };

  }


  /*
     RELEASE HAPPENED
  */


  if(
    !primary
      .surprise
      ?.ready
  ){

    return {

      mode:
        primary.phase,

      action:
        "WAIT",

      confidence:
        0,

      event:
        primary.event,

      reason:
        primary
          .surprise
          ?.reason ||
        "Waiting for reliable release data."

    };

  }


  const goldSignal =
    primary
      .surprise
      .signals[
        "XAU/USD"
      ];


  if(
    goldSignal ===
    "WAIT"
  ){

    return {

      mode:
        primary.phase,

      action:
        "WAIT",

      confidence:
        primary
          .surprise
          .confidence,

      event:
        primary.event,

      reason:
        "Actual data was too close to consensus."

    };

  }


  return {

    mode:
      primary.phase,

    market:
      "XAU/USD",

    action:
      goldSignal,

    confidence:
      primary
        .surprise
        .confidence,

    event:
      primary.event,

    usdBias:
      primary
        .surprise
        .usdBias,

    surpriseMagnitude:
      primary
        .surprise
        .magnitude,

    signals:
      primary
        .surprise
        .signals,

    reason:
      `${
        primary.event
      }: Actual ${
        primary.actual
      } vs Forecast ${
        primary.forecast
      }. USD ${
        primary
          .surprise
          .usdBias
      }. XAU/USD ${
        goldSignal
      } news bias.`

  };

}


/* =========================================================
   API
========================================================= */


export default async function handler(
  req,
  res
){

  res.setHeader(
    "Cache-Control",
    "no-store"
  );


  res.setHeader(
    "Allow",
    "GET, OPTIONS"
  );


  if(
    req.method ===
    "OPTIONS"
  ){

    return res
      .status(
        204
      )
      .end();

  }


  if(
    req.method !==
    "GET"
  ){

    return send(
      res,
      405,
      {

        success:
          false,

        error:
          "Use GET."

      }
    );

  }


  try{

    const now =
      new Date();


    const {
      events:
        rawEvents,
      cacheHit
    } =
      await fetchCalendar(
        now
      );


    const events =
      rawEvents

        .filter(
          isImportantEvent
        )

        .map(
          event =>
            normalizeEvent(
              event,
              now
            )
        )

        .filter(
          Boolean
        )

        .filter(
          event =>
            event.minutesUntil >=
              -1440 &&
            event.minutesUntil <=
              4320
        )

        .sort(
          (
            a,
            b
          ) =>
            new Date(
              a.dateUTC
            ) -
            new Date(
              b.dateUTC
            )
        );


    const primaryEvent =
      choosePrimaryEvent(
        events
      );


    const decision =
      buildRobotDecision(
        primaryEvent
      );


    /*
       LOCK NORMAL ROBOT

       15 minutes before
       to
       10 minutes after
    */


    const newsLock =
      events.some(
        event =>
          event.minutesUntil <=
            15 &&
          event.minutesUntil >=
            -10
      );


    return send(
      res,
      200,
      {

        success:
          true,

        robot:
          "MKAYFX NEWS EVENTS ROBOT V1",

        timestamp:
          now.toISOString(),

        provider:
          TE_API_KEY ===
          "guest:guest"

            ?

          "Trading Economics Guest"

            :

          "Trading Economics API",

        providerMode:
          TE_API_KEY ===
          "guest:guest"

            ?

          "FREE_LIMITED"

            :

          "API_KEY",

        cacheHit,

        newsLock,

        primaryEvent,

        decision,

        events,

        guardrails:{

          preNewsTrading:
            false,

          preNewsLockMinutes:
            15,

          postNewsLockMinutes:
            10,

          actualRequired:
            true,

          forecastRequired:
            true,

          fomcStatementAutoTrade:
            false

        }

      }
    );

  }
  catch(
    error
  ){

    console.error(
      "MKAYFX NEWS ROBOT ERROR:",
      error
    );


    return send(
      res,
      500,
      {

        success:
          false,

        error:
          error?.name ===
          "AbortError"

            ?

          "Economic calendar request timed out."

            :

          error?.message ||
          "Unknown news robot error."

      }
    );

  }

}