/* =========================================================
   MKAYFX XAU LIVE PRICE
   /api/price.js

   Lightweight live XAU/USD endpoint.

   ENVIRONMENT
   -----------
   TWELVE_DATA_API_KEY
========================================================= */


const API_KEY =
  process.env.TWELVE_DATA_API_KEY;


const BASE_URL =
  "https://api.twelvedata.com";


const SYMBOL =
  "XAU/USD";


/*
  Keep this reasonably high so Twelve Data
  does not get hammered unnecessarily.
*/
const MEMORY_CACHE_MS =
  8_000;


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
       MEMORY CACHE
    ===================================================== */

    if (

      memoryCache.payload

      &&

      now -
      memoryCache.at <
      MEMORY_CACHE_MS

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
       DIRECT PRICE
    ===================================================== */

    let quote =
      await fetchDirectPrice();


    /* =====================================================
       FALLBACK TO 1M
    ===================================================== */

    if (
      !quote
    ) {

      quote =
        await fetchFallbackPrice();

    }


    if (
      !quote
      ||
      !Number.isFinite(
        quote.price
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
          quote.price,
          3
        ),

      source:
        quote.source,

      quoteTime:
        quote.quoteTime
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
      "XAU live price error:",
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
          "Unknown live-price error"

      });

  }

}


/* =========================================================
   DIRECT /price ENDPOINT
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
              "MKAYFX-XAU-Live/2.0"

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
      data.status === "error"
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
   1M FALLBACK
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
      url
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
    data.status === "error"
  ) {

    throw new Error(

      data.message
      ||
      "Twelve Data error"

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
      "No fallback candle returned"
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
      "Invalid fallback price"
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
      "Twelve Data M1 fallback",

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

  const n =
    Number(
      value
    );


  if (
    !Number.isFinite(
      n
    )
  ) {

    return null;

  }


  const multiplier =
    10 **
    decimals;


  return Math.round(

    n *
    multiplier

  )

  /

  multiplier;

}