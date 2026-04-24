// ─── Roger AI — AviationStack Flight Tracking ────────────────────────────────
// Live flight status for any IATA flight number via AviationStack free tier.

const AVIATION_KEY = import.meta.env.VITE_AVIATIONSTACK_API_KEY as string;
const BASE = 'http://api.aviationstack.com/v1';

export interface FlightStatus {
  flightNumber:   string;
  airline:        string;
  status:         'scheduled' | 'active' | 'landed' | 'cancelled' | 'incident' | 'diverted' | 'unknown';
  departure: {
    airport:      string;
    iata:         string;
    scheduled:    string | null;
    estimated:    string | null;
    actual:       string | null;
    gate?:        string | null;
    terminal?:    string | null;
  };
  arrival: {
    airport:      string;
    iata:         string;
    scheduled:    string | null;
    estimated:    string | null;
    actual:       string | null;
    gate?:        string | null;
    terminal?:    string | null;
  };
  delayMinutes:   number | null;
  isLive:         boolean;
}

// Common airline voice → IATA code pairs
const AIRLINE_CODES: Record<string, string> = {
  'emirates':     'EK', 'etihad':    'EY', 'qatar':      'QR',
  'saudia':       'SV', 'flydubai':  'FZ', 'air arabia': 'G9',
  'british':      'BA', 'lufthansa': 'LH', 'air france': 'AF',
  'american':     'AA', 'united':    'UA', 'delta':      'DL',
  'turkish':      'TK', 'klm':       'KL', 'ryan':       'FR',
  'easy':         'U2', 'wizz':      'W6', 'ryan air':   'FR',
};

/** Extract IATA flight number from voice transcript.
 *  "Emirates 204" → "EK204", "Flight EK 204" → "EK204"
 */
export function parseFlight(transcript: string): string | null {
  const t = transcript.toLowerCase();

  // Direct IATA pattern: EK204, QR 412, BA-301
  const direct = transcript.match(/\b([A-Z]{2})\s*[-]?\s*(\d{1,4})\b/);
  if (direct) return `${direct[1]}${direct[2]}`;

  // Airline name + number: "Emirates 204", "Qatar four twelve"
  for (const [name, code] of Object.entries(AIRLINE_CODES)) {
    if (t.includes(name)) {
      const numMatch = transcript.match(/\d+/);
      if (numMatch) return `${code}${numMatch[0]}`;
    }
  }

  return null;
}

/** Format arrival/departure time for speech. */
function formatTime(iso: string | null): string {
  if (!iso) return 'unknown';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  } catch {
    return 'unknown';
  }
}

/** Fetch live status for a flight number (e.g. "EK204"). */
export async function fetchFlightStatus(flightNumber: string): Promise<FlightStatus | null> {
  if (!AVIATION_KEY) throw new Error('AviationStack API key not configured');
  try {
    const res = await fetch(
      `${BASE}/flights?access_key=${AVIATION_KEY}&flight_iata=${encodeURIComponent(flightNumber)}&limit=1`
    );
    if (!res.ok) return null;

    const data = await res.json() as {
      data?: {
        flight_status: string;
        airline: { name: string };
        flight: { iata: string };
        departure: { airport: string; iata: string; scheduled: string; estimated: string; actual: string; gate: string; terminal: string };
        arrival:   { airport: string; iata: string; scheduled: string; estimated: string; actual: string; gate: string; terminal: string };
        live?: { is_ground: boolean };
      }[];
    };

    const f = data.data?.[0];
    if (!f) return null;

    const delay = f.departure.estimated && f.departure.scheduled
      ? Math.round((new Date(f.departure.estimated).getTime() - new Date(f.departure.scheduled).getTime()) / 60000)
      : null;

    return {
      flightNumber: f.flight.iata ?? flightNumber,
      airline:      f.airline.name,
      status:       (f.flight_status ?? 'unknown') as FlightStatus['status'],
      departure: {
        airport:   f.departure.airport,
        iata:      f.departure.iata,
        scheduled: f.departure.scheduled,
        estimated: f.departure.estimated,
        actual:    f.departure.actual,
        gate:      f.departure.gate,
        terminal:  f.departure.terminal,
      },
      arrival: {
        airport:   f.arrival.airport,
        iata:      f.arrival.iata,
        scheduled: f.arrival.scheduled,
        estimated: f.arrival.estimated,
        actual:    f.arrival.actual,
        gate:      f.arrival.gate,
        terminal:  f.arrival.terminal,
      },
      delayMinutes: delay && delay > 0 ? delay : null,
      isLive:       f.live !== undefined,
    };
  } catch {
    return null;
  }
}

/** Format a flight status for Roger voice response. */
export function flightToSpeech(f: FlightStatus): string {
  const statusMap: Record<FlightStatus['status'], string> = {
    scheduled: 'scheduled and on time',
    active:    'currently in the air',
    landed:    'landed',
    cancelled: 'cancelled',
    incident:  'has an incident reported',
    diverted:  'diverted',
    unknown:   'status unknown',
  };

  const depTime = f.departure.actual ?? f.departure.estimated ?? f.departure.scheduled;
  const arrTime = f.arrival.actual   ?? f.arrival.estimated   ?? f.arrival.scheduled;
  const delay   = f.delayMinutes ? ` Delayed by ${f.delayMinutes} minutes.` : '';
  const gate    = f.arrival.gate ? ` Arrival gate: ${f.arrival.gate}.` : '';

  return `Flight ${f.flightNumber} by ${f.airline} is ${statusMap[f.status]}.${delay} ` +
    `Departing ${f.departure.airport} at ${formatTime(depTime)}, ` +
    `arriving ${f.arrival.airport} at ${formatTime(arrTime)}.${gate} Over.`;
}
