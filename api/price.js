/* =========================================================
   MKAYFX XAU LIVE PRICE FEED
   /api/price.js

   PURPOSE
   -------
   Lightweight XAU/USD price endpoint.

   This endpoint is deliberately separate from /api/xau.

   /api/xau
   --------
   Heavy analysis:
   - Liquidity pools
   - Sweep projections
   - MTF structure
   - Footprint proxy
   - Sessions
   - Macro
   - Historical sweep statistics

   /api/price
   ----------
   Lightweight:
   - Current XAU/USD price
   - Updated frequently
   - Used for live sweep-stage tracking

   ENVIRONMENT VARIABLE
   --------------------
   TWELVE_DATA_API_KEY
========================================================= */


const API_KEY =
  process.env.TWELVE_DATA_API_KEY;


const BASE_URL =
  "https://api.twelvedata.com";


const SYMBOL =
  "XAU/USD";


const CACHE_MS =
  4_000;


let memoryCache = {

  at:
    0,

  payload:
    null

};


/* =========================================================
   HANDLER
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

        ok:
          false,

        error:
          "GET only"

      });

  }


  if (
    !API_KEY
  ) {

    return res
      .status(500)
      .json({

        ok:
          false,

        error:
          "Missing TWELVE_DATA_API_KEY"

      });

  }


  try {

    const now =
      Date.now();


    /* =====================================================
       SHORT MEMORY CACHE
    ===================================================== */

    if (

      memoryCache.payload

      &&

      now -
      memoryCache.at <
      CACHE_MS

    ) {

      return res
        .status(200)
        .json({

          ...memoryCache.payload,

          cache:
            true,

          servedAt:
            new Date()
              .toISOString()

        });

    }


    /* =====================================================
       TRY TWELVE DATA /price FIRST
    ===================================================== */

    let result =
      await fetchDirectPrice();


    /* =====================================================
       FALLBACK TO 1-MIN CANDLE
    ===================================================== */

    if (
      !result
    ) {

      result =
        await fetchFallbackPrice();

    }


    if (
      !result
      ||
      !Number.isFinite(
        result.price
      )
    ) {

      throw new Error(
        "Unable to obtain XAU/USD price"
      );

    }


    const payload = {

      ok:
        true,

      symbol:
        SYMBOL,

      price:
        round(
          result.price,
          3
        ),

      source:
        result.source,

      quoteTime:
        result.quoteTime
        ||
        new Date()
          .toISOString(),

      generatedAt:
        new Date()
          .toISOString(),

      servedAt:
        new Date()
          .toISOString(),

      cache:
        false

    };


    memoryCache = {

      at:
        now,

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
      "Live XAU price error:",
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
          "Unknown price error"

      });

  }

}


/* =========================================================
   DIRECT PRICE
========================================================= */

async function fetchDirectPrice() {

  try {

    const url =
      new URL(
        `${BASE_URL}/price`
      );


    url.searchParams.set(
      "symbol",
      SYMBOL
    );


    url.searchParams.set(
      "apikey",
      API_KEY
    );


    const response =
      await fetch(
        url,
        {

          headers: {

            "User-Agent":
              "MKAYFX-Live-Price/1.0"

          }

        }
      );


    if (
      !response.ok
    ) {

      return null;

    }


    const data =
      await response.json();


    if (
      data.status ===
      "error"
    ) {

      return null;

    }


    const price =
      Number(
        data.price
      );


    if (
      !Number.isFinite(
        price
      )
    ) {

      return null;

    }


    return {

      price,

      source:
        "Twelve Data /price",

      quoteTime:
        new Date()
          .toISOString()

    };


  } catch (
    error
  ) {

    return null;

  }

}


/* =========================================================
   FALLBACK
========================================================= */

async function fetchFallbackPrice() {

  const url =
    new URL(
      `${BASE_URL}/time_series`
    );


  url.searchParams.set(
    "symbol",
    SYMBOL
  );


  url.searchParams.set(
    "interval",
    "1min"
  );


  url.searchParams.set(
    "outputsize",
    "1"
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
    API_KEY
  );


  const response =
    await fetch(
      url,
      {

        headers: {

          "User-Agent":
            "MKAYFX-Live-Price-Fallback/1.0"

        }

      }
    );


  if (
    !response.ok
  ) {

    throw new Error(

      `Twelve Data fallback HTTP ${response.status}`

    );

  }


  const data =
    await response.json();


  if (
    data.status ===
    "error"
  ) {

    throw new Error(

      data.message
      ||
      "Twelve Data fallback error"

    );

  }


  if (
    !Array.isArray(
      data.values
    )
    ||
    !data.values.length
  ) {

    throw new Error(
      "Fallback returned no values"
    );

  }


  const candle =
    data.values[0];


  const price =
    Number(
      candle.close
    );


  if (
    !Number.isFinite(
      price
    )
  ) {

    throw new Error(
      "Fallback returned invalid price"
    );

  }


  let quoteTime =
    null;


  if (
    candle.datetime
  ) {

    const parsed =
      Date.parse(

        String(
          candle.datetime
        )
          .replace(
            " ",
            "T"
          )

        +

        "Z"

      );


    if (
      Number.isFinite(
        parsed
      )
    ) {

      quoteTime =
        new Date(
          parsed
        )
          .toISOString();

    }

  }


  return {

    price,

    source:
      "Twelve Data 1min fallback",

    quoteTime

  };

}


/* =========================================================
   UTIL
========================================================= */

function round(
  value,
  decimals = 2
) {

  const number =
    Number(
      value
    );


  if (
    !Number.isFinite(
      number
    )
  ) {

    return null;

  }


  const multiplier =
    10 **
    decimals;


  return Math.round(

    number *
    multiplier

  )

  /

  multiplier;

}