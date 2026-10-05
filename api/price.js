export default async function handler(req, res) {
  // Pulls securely from Vercel Environment Variables
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  const symbol = "XAU/USD";
  const interval = "1h"; 
  
  if (!apiKey) {
    return res.status(500).json({ error: "TWELVE_DATA_API_KEY environment variable is not configured on Vercel." });
  }

  try {
    const apiResponse = await fetch(`https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${interval}&outputsize=10&apikey=${apiKey}`);
    const data = await apiResponse.json();

    if (data.status === "error") {
      return res.status(400).json({ error: data.message });
    }

    res.setHeader('Content-Type', 'application/json');
    res.status(200).json({
      symbol: data.meta.symbol,
      interval: data.meta.interval,
      values: data.values // Array containing open, high, low, close data
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to communicate with Twelve Data API." });
  }
}
