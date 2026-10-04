const TD_BASE =
  "https://api.twelvedata.com";


export default async function handler(
  req,
  res
) {

  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  res.setHeader(
    "Cache-Control",
    "s-maxage=8, stale-while-revalidate=12"
  );


  const apiKey =
    process.env.TWELVE_DATA_API_KEY;


  if (!apiKey) {

    return res
      .status(500)
      .json({
        ok: false,
        error:
          "Missing TWELVE_DATA_API_KEY in Vercel Environment Variables."
      });

  }


  try {

    const url =
      `${TD_BASE}/price` +
      `?symbol=${encodeURIComponent("XAU/USD")}` +
      `&apikey=${encodeURIComponent(apiKey)}`;


    const response =
      await fetch(
        url,
        {
          headers: {
            Accept:
              "application/json"
          },

          signal:
            AbortSignal.timeout(
              8000
            )
        }
      );


    if (!response.ok) {

      throw new Error(
        `Twelve Data HTTP ${response.status}`
      );

    }


    const data =
      await response.json();


    if (
      data.status === "error" ||
      !Number.isFinite(
        Number(
          data.price
        )
      )
    ) {

      throw new Error(
        data.message ||
        "Twelve Data returned no XAU/USD price."
      );

    }


    return res
      .status(200)
      .json({

        ok: true,

        symbol:
          "XAU/USD",

        price:
          Number(
            data.price
          ),

        timestamp:
          new Date()
            .toISOString(),

        source:
          "Twelve Data"

      });

  }

  catch (error) {

    return res
      .status(502)
      .json({

        ok: false,

        error:
          error?.message ||
          "Price request failed."

      });

  }

}