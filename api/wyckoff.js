export default async function handler(req, res) {

  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate"
  );

  res.setHeader(
    "Content-Type",
    "application/json"
  );

  try {

    const symbol =
      req.query?.symbol ||
      "XAU/USD";

    const tf =
      req.query?.tf ||
      "5m";

    return res
      .status(200)
      .json({

        ok: true,

        engine: "MKAYFX WYCKOFF ROUTE TEST V1",

        message: "WYCKOFF API ROUTE IS WORKING",

        symbol,

        timeframe: tf,

        timestamp:
          new Date().toISOString()

      });

  }

  catch (error) {

    return res
      .status(500)
      .json({

        ok: false,

        engine: "MKAYFX WYCKOFF ROUTE TEST V1",

        error:
          error instanceof Error
            ? error.message
            : String(error)

      });

  }

}