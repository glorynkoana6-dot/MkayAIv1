/* =========================================================
   MKAYFX GOLD PRICE MONITOR

   IMPORTANT:
   This endpoint performs ZERO strategy analysis.

   It only returns the latest XAU/USD price.

========================================================= */

const API_KEY =
  process.env.TWELVE_DATA_API_KEY;

const BASE_URL =
  "https://api.twelvedata.com";

const SYMBOL =
  "XAU/USD";


let cache = {
  price: null,
  time: 0
};


const CACHE_MS =
  12_000;


function finite(
  value
) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : null;

}


function round(
  value,
  digits = 2
) {

  const n =
    finite(value);

  return n === null
    ? null
    : Number(
        n.toFixed(
          digits
        )
      );

}


async function getPrice() {

  if (
    cache.price !== null &&
    Date.now() -
      cache.time <
      CACHE_MS
  ) {
    return {
      price:
        cache.price,

      cached:
        true
    };
  }


  if (!API_KEY) {
    throw new Error(
      "TWELVE_DATA_API_KEY is missing."
    );
  }


  const query =
    new URLSearchParams({
      symbol:
        SYMBOL,

      dp:
        "5",

      apikey:
        API_KEY
    });


  const response =
    await fetch(
      `${BASE_URL}/price?${query}`
    );


  const data =
    await response
      .json();


  const price =
    finite(
      data.price
    );


  if (
    !response.ok ||
    data.status ===
      "error" ||
    price === null
  ) {

    throw new Error(
      data.message ||
      "Gold price unavailable."
    );

  }


  cache = {
    price,
    time:
      Date.now()
  };


  return {
    price,
    cached:
      false
  };

}


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


  if (
    req.method !==
      "GET"
  ) {

    return res
      .status(405)
      .json({
        success:
          false,

        error:
          "Use GET."
      });

  }


  try {

    const result =
      await getPrice();


    return res
      .status(200)
      .json({
        success:
          true,

        symbol:
          SYMBOL,

        price:
          round(
            result.price,
            2
          ),

        cached:
          result.cached,

        timestamp:
          new Date()
            .toISOString()
      });

  }
  catch (
    error
  ) {

    return res
      .status(500)
      .json({
        success:
          false,

        error:
          error?.message ||
          "Price monitor failed."
      });

  }

}