const ITEMS = ['Cough detection', 'Air quality', 'On-device AI', 'ESP32', 'Works offline', 'Private by design', 'Medication reminders', 'Made in Uzbekistan']

export function Marquee() {
  const row = [...ITEMS, ...ITEMS]
  return (
    <div className="marquee" aria-hidden>
      <div className="marquee__track">
        {row.map((t, i) => (
          <span key={i}>{t}</span>
        ))}
      </div>
    </div>
  )
}
