export default function handler(req, res) {
  const now = new Date();
  const currentHourUTC = now.getUTCHours();
  const currentMinuteUTC = now.getUTCMinutes();
  const timeStringUTC = `${String(currentHourUTC).padStart(2, '0')}:${String(currentMinuteUTC).padStart(2, '0')} UTC`;

  let activeSession = "Inter-Market / Pre-Asia";
  let sessionPhase = "Consolidation";
  let strategyHint = "Prepare bias, check higher timeframe order blocks.";

  if (currentHourUTC >= 0 && currentHourUTC < 7) {
    activeSession = "Asian Session";
    sessionPhase = "Range Building & Accumulation";
    strategyHint = "Mark Asian High and Low. Low volume drift; expect tight consolidation before European hours.";
  } else if (currentHourUTC >= 7 && currentHourUTC < 12) {
    activeSession = "London Session";
    sessionPhase = "Breakout & Liquidity Sweep Phase";
    strategyHint = "Watch for 10-30 pip overshoot past Asian boundaries. Check Volume Footprint delta divergence for fakeout/reversal entries.";
  } else if (currentHourUTC >= 12 && currentHourUTC < 17) {
    activeSession = "London / New York Overlap";
    sessionPhase = "Peak Volatility & Data Expansion";
    strategyHint = "High institutional volume. US macro data drops here; expect the true daily trend or sweeping of both session extremes.";
  } else if (currentHourUTC >= 17 && currentHourUTC < 21) {
    activeSession = "New York Late Session";
    sessionPhase = "Trend Continuation / Wind-Down";
    strategyHint = "NY High/Low are locked. Watch for late-day retracements or position-squaring before the daily close.";
  } else {
    activeSession = "Late Evening / Roll-over";
    sessionPhase = "Market Close / Prep";
    strategyHint = "Low liquidity window; avoid major intraday setups.";
  }

  res.setHeader('Content-Type', 'application/json');
  res.status(200).json({
    asset: "XAUUSD (Gold)",
    currentTimeUTC: timeStringUTC,
    activeSession: activeSession,
    phase: sessionPhase,
    actionableHint: strategyHint,
    mechanics: {
      asia: "Establishes baseline range & builds resting stop-loss liquidity pools.",
      london: "Engineers fakeouts/sweeps of Asian highs/lows and sets daily directional bias.",
      newYork: "Expands the range, delivers US macro data shocks, and sets the final daily high/low boundaries."
    }
  });
}
