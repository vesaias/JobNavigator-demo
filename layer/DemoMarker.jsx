// The one demo marker: a badge and "Reset demo" in the rail, and the not-affiliated line (Settings colophon).
// Loaded only in the demo build (dynamic import behind __DEMO__).
import React, { useState } from 'react'
import { Button, Helper, Tag } from '../ui'
import ConfirmDialog from '../ConfirmDialog'
import { resetStore } from './store.js'

export const NOT_AFFILIATED = 'Job postings are snapshots for this demo; not affiliated with the companies.'

export default function DemoMarker({ open }) {
  const [asking, setAsking] = useState(false)
  if (!open) return null
  const reset = () => { setAsking(false); resetStore(); window.location.reload() }
  return (
    <div data-demo-marker="" style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 8px', whiteSpace: 'nowrap' }}>
      <Tag tone="accent" title={NOT_AFFILIATED}>Sample data</Tag>
      <Button variant="secondary" size="xs" onClick={() => setAsking(true)}>Reset demo</Button>
      {asking && <ConfirmDialog title="Reset the demo?" body="Your changes in this browser are discarded and the sample data comes back."
        label="Reset" danger onConfirm={reset} onCancel={() => setAsking(false)} />}
    </div>
  )
}

export function DemoNote() {
  return <Helper style={{ padding: '2px 0 6px' }}>{NOT_AFFILIATED}</Helper>
}
