import {
  fetchPrice,
  finite,
  round
} from "./core.js";


const ASSETS = {

  "XAU/USD": {
    code: "XAUUSD",
    name: "Gold",
    precision: 2
  },

  "BTC/USD": {
    code: "BTCUSD",
    name: "Bitcoin",
    precision: 2
  }

};


function normalizeSymbol(value) {

  const raw =
    String(
      value ||
      "XAU/USD"
    )
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");


  if (
    raw === "XAUUSD" ||
    raw === "XAU/USD" ||
    raw === "GOLD"
  ) {
    return "XAU/USD";
  }


  if (
    raw === "BTCUSD" ||
    raw === "BTC/USD" ||
    raw === "BTC"
  ) {
    return "BTC/USD";
  }


  return null;
}


function queryValue(
  req,
  key
) {

  if (
    req.query &&
    req.query[key] !==
      undefined
  ) {

    const value =
      req.query[key];

    return Array.isArray(
      value
    )
      ? value[0]
      : value;

  }


  try {

    const url =
      new URL(
        req.url,
        "http://localhost"
      );

    return url.searchParams.get(
      key
    );

  }
  catch {

    return null;

  }

}


const CACHE =
  globalThis.__MKAYFX_PRICE_CACHE__ ||
  new Map();


globalThis.__MKAYFX_PRICE_CACHE__ =
  CACHE;


async function cachedPrice(
  symbol
) {

  const now =
    Date.now();


  const existing =
    CACHE.get(
      symbol
    );


  if (
    existing &&
    now -
      existing.time <
      5000
  ) {

    return existing.price;

  }


  const price =
    await fetchPrice(
      symbol
    );


  CACHE.set(
    symbol,
    {
      time:
        now,

      price
    }
  );


  return price;
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


  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,OPTIONS"
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

    const requested =
      queryValue(
        req,
        "symbol"
      ) ||
      "XAU/USD";


    const symbol =
      normalizeSymbol(
        requested
      );


    if (!symbol) {

      return res
        .status(400)
        .json({

          success:
            false,

          error:
            "Unsupported symbol.",

          supportedSymbols: [
            "XAU/USD",
            "BTC/USD"
          ]

        });

    }


    const asset =
      ASSETS[symbol];


    const value =
      await cachedPrice(
        symbol
      );


    const price =
      finite(
        value
      );


    if (
      price ===
      null
    ) {

      throw new Error(
        `${symbol} price unavailable.`
      );

    }


    return res
      .status(200)
      .json({

        success:
          true,

        symbol,

        code:
          asset.code,

        name:
          asset.name,

        price:
          round(
            price,
            asset.precision
          ),

        timestamp:
          new Date()
            .toISOString()

      });

  }
  catch (error) {

    return res
      .status(500)
      .json({

        success:
          false,

        error:
          error?.message ||
          "Price request failed."

      });

  }

}