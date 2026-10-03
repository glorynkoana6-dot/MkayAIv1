import {
  SYMBOL,
  fetchPrice
} from "../lib/core.js";


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

    const price =
      await fetchPrice(
        SYMBOL
      );


    return res
      .status(200)
      .json({
        success:
          true,

        symbol:
          SYMBOL,

        price,

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
          "Price unavailable."
      });

  }
}